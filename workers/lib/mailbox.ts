// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks if the mailbox exists in R2, then instantiates the DO stub
 * and attaches it to the Hono context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import { canAccessMailbox, getAuthPrincipal } from "./auth";
import { ensureUserMailbox } from "./mailbox-settings";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxStub: DurableObjectStub<MailboxDO>;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	if (c.req.path.endsWith("/proxy-image")) return next();
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = decodeURIComponent(rawId);
	const allowed = await canAccessMailbox(c as any, mailboxId);
	if (!allowed) {
		return c.json({ error: "Forbidden" }, 403);
	}

	const key = `mailboxes/${mailboxId}.json`;
	let obj = await c.env.BUCKET.head(key);
	if (!obj) {
		const principal = await getAuthPrincipal(c as any);
		if (
			principal?.realm === "admin" ||
			(principal?.realm === "user" && principal.email.toLowerCase() === mailboxId.toLowerCase())
		) {
			await ensureUserMailbox(c.env, mailboxId);
			obj = await c.env.BUCKET.head(key);
		}
		if (!obj) return c.json({ error: "Not found" }, 404);
	}

	// Instantiate DO stub
	const ns = c.env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	const stub = ns.get(id);

	c.set("mailboxStub", stub);
	
	await next();
});
