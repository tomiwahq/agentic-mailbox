import { Hono } from "hono";
import { z } from "zod";
import { configuredDomains, ensureAuthSchema, hashPassword, requireAdmin } from "../lib/auth";
import { listMailboxes } from "../lib/email-helpers";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/v1/admin/*", async (c, next) => {
	await ensureAuthSchema(c.env);
	const admin = await requireAdmin(c);
	if (!admin) return c.json({ error: "Unauthorized" }, 401);
	await next();
});

app.get("/api/v1/admin/overview", async (c) => {
	const [{ results: mailboxRows }, { results: userRows }, { results: domainRows }] = await Promise.all([
		c.env.AUTH_DB.prepare("SELECT COUNT(*) as count FROM sessions WHERE realm = 'user'").all<any>(),
		c.env.AUTH_DB.prepare("SELECT COUNT(*) as count FROM user_accounts WHERE is_active = 1").all<any>(),
		c.env.AUTH_DB.prepare("SELECT COUNT(*) as count FROM domains WHERE is_active = 1").all<any>(),
	]);
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json({
		totalMailboxes: allMailboxes.length,
		activeUserSessions: Number(mailboxRows?.[0]?.count || 0),
		activeUsers: Number(userRows?.[0]?.count || 0),
		activeDomains: Number(domainRows?.[0]?.count || 0),
	});
});

app.get("/api/v1/admin/domains", async (c) => {
	const rows = await c.env.AUTH_DB.prepare("SELECT domain, host, is_active, created_at FROM domains ORDER BY domain ASC").all<any>();
	return c.json((rows.results || []).map((d: any) => ({ ...d, is_active: Boolean(d.is_active) })));
});

app.post("/api/v1/admin/domains", async (c) => {
	const body = z.object({ domain: z.string().min(1), host: z.string().min(1) }).parse(await c.req.json());
	const domain = body.domain.toLowerCase();
	if (!configuredDomains(c.env).includes(domain)) {
		return c.json({ error: "Domain must be listed in the Worker DOMAINS binding" }, 400);
	}
	await c.env.AUTH_DB.prepare("INSERT INTO domains (domain, host, is_active, created_at) VALUES (?, ?, 1, ?)")
		.bind(domain, body.host.toLowerCase(), new Date().toISOString())
		.run();
	return c.json({ ok: true }, 201);
});

app.get("/api/v1/admin/mailboxes", async (c) => {
	const all = await listMailboxes(c.env.BUCKET);
	const mailboxMap = new Map<string, { id: string; email: string; name: string }>();
	for (const m of all) {
		mailboxMap.set(m.id.toLowerCase(), { id: m.id, email: m.email, name: m.id });
	}
	try {
		const rows = await c.env.AUTH_DB.prepare("SELECT email FROM user_accounts").all<{ email: string }>();
		for (const r of rows.results || []) {
			const email = r.email.toLowerCase();
			if (!mailboxMap.has(email)) {
				mailboxMap.set(email, { id: email, email, name: email });
			}
		}
	} catch {
		// Ignore if table query fails
	}
	return c.json(Array.from(mailboxMap.values()));
});

app.get("/api/v1/admin/users", async (c) => {
	const rows = await c.env.AUTH_DB.prepare("SELECT id, email, local_part, domain, is_active, created_at FROM user_accounts ORDER BY created_at DESC").all<any>();
	return c.json((rows.results || []).map((u: any) => ({ ...u, is_active: Boolean(u.is_active) })));
});

app.post("/api/v1/admin/users/:id/lock", async (c) => {
	await c.env.AUTH_DB.prepare("UPDATE user_accounts SET is_active = 0, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), c.req.param("id")).run();
	await c.env.AUTH_DB.prepare("DELETE FROM sessions WHERE realm = 'user' AND account_id = ?").bind(c.req.param("id")).run();
	return c.json({ ok: true });
});

app.post("/api/v1/admin/users/:id/unlock", async (c) => {
	await c.env.AUTH_DB.prepare("UPDATE user_accounts SET is_active = 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), c.req.param("id")).run();
	return c.json({ ok: true });
});

app.post("/api/v1/admin/users/:id/reset-password", async (c) => {
	const body = z.object({ password: z.string().min(12) }).parse(await c.req.json());
	const passwordHash = await hashPassword(body.password, c.env.AUTH_PEPPER);
	await c.env.AUTH_DB.prepare("UPDATE user_accounts SET password_hash = ?, updated_at = ? WHERE id = ?")
		.bind(passwordHash, new Date().toISOString(), c.req.param("id"))
		.run();
	await c.env.AUTH_DB.prepare("DELETE FROM sessions WHERE realm = 'user' AND account_id = ?").bind(c.req.param("id")).run();
	return c.json({ ok: true });
});

export default app;
