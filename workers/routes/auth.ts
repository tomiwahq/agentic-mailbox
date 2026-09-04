import { Hono } from "hono";
import { z } from "zod";
import {
	ensureAuthSchema,
	finishAuthentication,
	finishRegistration,
	getAuthPrincipal,
	hashPassword,
	loginAdmin,
	loginUser,
	logout,
	requireAdmin,
	resolveTenant,
	startAuthentication,
	startRegistration,
	verifyPassword,
} from "../lib/auth";
import type { Env } from "../types";
import { checkAuthRateLimit, clientIp } from "../lib/rate-limit";
import { DEFAULT_MAILBOX_SETTINGS, syncAliasPointers } from "../lib/mailbox-settings";

function parseBody<T>(schema: z.ZodType<T>, data: unknown): { ok: true; data: T } | { ok: false; error: string } {
	const parsed = schema.safeParse(data);
	if (parsed.success) return { ok: true, data: parsed.data };
	const message = parsed.error.issues.map((issue) => issue.message).join("; ") || "Invalid request";
	return { ok: false, error: message };
}

const UserPasswordLoginBody = z.object({
	localPart: z.string().min(1),
	password: z.string().min(8),
});
const AdminPasswordLoginBody = z.object({
	email: z.string().email(),
	password: z.string().min(8),
});

const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/auth/session", async (c) => {
	await ensureAuthSchema(c.env);
	const principal = await getAuthPrincipal(c);
	const tenant = resolveTenant(c.req.header("host"), c.env);
	return c.json({
		authenticated: !!principal,
		tenant,
		principal: principal
			? principal.realm === "admin"
				? { realm: "admin", email: principal.email }
				: { realm: "user", email: principal.email, domain: principal.domain }
			: null,
	});
});

app.post("/api/v1/auth/logout", async (c) => {
	await ensureAuthSchema(c.env);
	await logout(c);
	return c.json({ ok: true });
});

app.post("/api/v1/auth/login/password", async (c) => {
	await ensureAuthSchema(c.env);
	const limited = await checkAuthRateLimit(c.env.AUTH_DB, `login:${clientIp(c.req.raw)}`);
	if (limited) return c.json({ error: limited }, 429);
	const tenant = resolveTenant(c.req.header("host"), c.env);
	if (tenant.kind !== "domain") return c.json({ error: "Domain login is unavailable on this host" }, 403);
	const body = UserPasswordLoginBody.parse(await c.req.json());
	const localPart = body.localPart.trim().toLowerCase();
	const email = `${localPart}@${tenant.domain}`;
	const row = await c.env.AUTH_DB.prepare("SELECT * FROM user_accounts WHERE email = ? AND is_active = 1")
		.bind(email)
		.first<any>();
	if (!row) return c.json({ error: "Invalid credentials" }, 401);
	const ok = await verifyPassword(body.password, c.env.AUTH_PEPPER, row.password_hash);
	if (!ok) return c.json({ error: "Invalid credentials" }, 401);
	await loginUser(c, row.id, row.email, row.domain);
	return c.json({ ok: true, email: row.email });
});

app.post("/api/v1/admin/auth/login/password", async (c) => {
	await ensureAuthSchema(c.env);
	const limited = await checkAuthRateLimit(c.env.AUTH_DB, `admin-login:${clientIp(c.req.raw)}`);
	if (limited) return c.json({ error: limited }, 429);
	const body = AdminPasswordLoginBody.parse(await c.req.json());
	const row = await c.env.AUTH_DB.prepare("SELECT * FROM admin_accounts WHERE email = ? AND is_active = 1")
		.bind(body.email.toLowerCase())
		.first<any>();
	if (!row) return c.json({ error: "Invalid credentials" }, 401);
	const ok = await verifyPassword(body.password, c.env.AUTH_PEPPER, row.password_hash);
	if (!ok) return c.json({ error: "Invalid credentials" }, 401);
	await loginAdmin(c, row.id, row.email);
	return c.json({ ok: true, email: row.email });
});

app.post("/api/v1/auth/passkey/register/options", async (c) => {
	await ensureAuthSchema(c.env);
	const principal = await getAuthPrincipal(c);
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const accountId = principal.realm === "admin" ? principal.adminId : principal.userId;
	const options = await startRegistration(c, principal.realm, accountId, principal.email);
	return c.json(options);
});

app.post("/api/v1/auth/passkey/register/verify", async (c) => {
	await ensureAuthSchema(c.env);
	const principal = await getAuthPrincipal(c);
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const accountId = principal.realm === "admin" ? principal.adminId : principal.userId;
	const result = await finishRegistration(c, principal.realm, accountId, await c.req.json());
	return result.verified ? c.json({ ok: true }) : c.json({ error: result.reason || "Passkey registration failed" }, 400);
});

app.post("/api/v1/auth/passkey/login/options", async (c) => {
	await ensureAuthSchema(c.env);
	const tenant = resolveTenant(c.req.header("host"), c.env);
	const body = z.object({ localPart: z.string().optional(), adminEmail: z.string().email().optional(), realm: z.enum(["user", "admin"]) }).parse(await c.req.json());
	if (body.realm === "user") {
		if (tenant.kind !== "domain") return c.json({ error: "Domain login unavailable on this host" }, 403);
		if (!body.localPart) return c.json({ error: "Missing localPart" }, 400);
		const email = `${body.localPart.toLowerCase()}@${tenant.domain}`;
		const account = await c.env.AUTH_DB.prepare("SELECT id FROM user_accounts WHERE email = ? AND is_active = 1").bind(email).first<{ id: string }>();
		if (!account) return c.json({ error: "Account not found" }, 404);
		const options = await startAuthentication(c, "user", account.id);
		return c.json({ accountId: account.id, options });
	}
	if (!body.adminEmail) return c.json({ error: "Missing adminEmail" }, 400);
	const account = await c.env.AUTH_DB.prepare("SELECT id FROM admin_accounts WHERE email = ? AND is_active = 1").bind(body.adminEmail.toLowerCase()).first<{ id: string }>();
	if (!account) return c.json({ error: "Account not found" }, 404);
	const options = await startAuthentication(c, "admin", account.id);
	return c.json({ accountId: account.id, options });
});

app.post("/api/v1/auth/passkey/login/verify", async (c) => {
	await ensureAuthSchema(c.env);
	const body = z.object({ realm: z.enum(["user", "admin"]), accountId: z.string().min(1), response: z.any() }).parse(await c.req.json());
	const result = await finishAuthentication(c, body.realm, body.accountId, body.response);
	if (!result.verified) return c.json({ error: result.reason || "Passkey authentication failed" }, 401);
	if (body.realm === "admin") {
		const admin = await c.env.AUTH_DB.prepare("SELECT id, email FROM admin_accounts WHERE id = ? AND is_active = 1").bind(body.accountId).first<any>();
		if (!admin) return c.json({ error: "Admin not found" }, 404);
		await loginAdmin(c, admin.id, admin.email);
		return c.json({ ok: true, email: admin.email });
	}
	const user = await c.env.AUTH_DB.prepare("SELECT id, email, domain FROM user_accounts WHERE id = ? AND is_active = 1").bind(body.accountId).first<any>();
	if (!user) return c.json({ error: "User not found" }, 404);
	await loginUser(c, user.id, user.email, user.domain);
	return c.json({ ok: true, email: user.email });
});

app.post("/api/v1/admin/bootstrap", async (c) => {
	await ensureAuthSchema(c.env);
	const limited = await checkAuthRateLimit(c.env.AUTH_DB, `bootstrap:${clientIp(c.req.raw)}`, 5);
	if (limited) return c.json({ error: limited }, 429);
	if (!c.env.BOOTSTRAP_SECRET) return c.json({ error: "BOOTSTRAP_SECRET is not configured" }, 503);
	const body = z.object({ email: z.string().email(), password: z.string().min(12), secret: z.string().optional() }).parse(await c.req.json());
	const provided = c.req.header("x-bootstrap-secret") || body.secret || "";
	if (provided !== c.env.BOOTSTRAP_SECRET) return c.json({ error: "Invalid bootstrap secret" }, 403);
	const existing = await c.env.AUTH_DB.prepare("SELECT id FROM admin_accounts LIMIT 1").first();
	if (existing) return c.json({ error: "Bootstrap already completed" }, 409);
	const hash = await hashPassword(body.password, c.env.AUTH_PEPPER);
	await c.env.AUTH_DB.prepare(
		"INSERT INTO admin_accounts (id, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 'super_admin', 1, ?, ?)",
	).bind(crypto.randomUUID(), body.email.toLowerCase(), hash, new Date().toISOString(), new Date().toISOString()).run();
	return c.json({ ok: true });
});

app.post("/api/v1/admin/users", async (c) => {
	await ensureAuthSchema(c.env);
	const admin = await requireAdmin(c);
	if (!admin) return c.json({ error: "Unauthorized" }, 401);
	const parsed = parseBody(z.object({
		localPart: z.string().trim().min(1, "Local part is required"),
		domain: z.string().trim().min(1, "Domain is required"),
		password: z.string().min(8, "Password must be at least 8 characters"),
	}), await c.req.json());
	if (!parsed.ok) return c.json({ error: parsed.error }, 400);
	const localPart = parsed.data.localPart.toLowerCase();
	const domain = parsed.data.domain.toLowerCase();
	const email = `${localPart}@${domain}`;
	const existing = await c.env.AUTH_DB.prepare("SELECT id FROM user_accounts WHERE email = ?").bind(email).first();
	if (existing) return c.json({ error: "User already exists" }, 409);
	const hash = await hashPassword(parsed.data.password, c.env.AUTH_PEPPER);
	await c.env.AUTH_DB.prepare(
		"INSERT INTO user_accounts (id, email, local_part, domain, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
	).bind(crypto.randomUUID(), email, localPart, domain, hash, new Date().toISOString(), new Date().toISOString()).run();
	const mailboxKey = `mailboxes/${email}.json`;
	if (!(await c.env.BUCKET.head(mailboxKey))) {
		const settings = { ...DEFAULT_MAILBOX_SETTINGS, fromName: localPart };
		await c.env.BUCKET.put(mailboxKey, JSON.stringify(settings));
		await syncAliasPointers(c.env.BUCKET, email, [], []);
		await c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email)).getFolders();
	}
	return c.json({ ok: true, email }, 201);
});

export default app;
