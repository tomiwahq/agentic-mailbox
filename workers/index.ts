// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { canAccessMailbox, configuredDomains, getAuthPrincipal, mailboxDomain, resolveTenant } from "./lib/auth";
import { collectRecipientAddresses, isSafeImageUrl, parseEmailDate } from "./lib/address";
import { createQueuedEmail, sendAndTrack } from "./lib/delivery";
import { resolveInboundMailboxIds } from "./lib/inbound";
import {
	DEFAULT_MAILBOX_SETTINGS,
	ensureUserMailbox,
	getMailboxSettings,
	mailboxAliases,
	syncAliasPointers,
} from "./lib/mailbox-settings";
import { classifyInboundFolder, shouldSkipAutoDraft } from "./lib/spam";
import { extractMessageId, parseReferences, preferredThreadLookupIds } from "./lib/threading";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);
app.use("/api/v1/*", async (c, next) => {
	if (
		c.req.path === "/api/v1/config" ||
		c.req.path === "/api/v1/proxy-image" ||
		c.req.path.endsWith("/proxy-image") ||
		c.req.path.startsWith("/api/v1/auth/") ||
		c.req.path.startsWith("/api/v1/admin/")
	) {
		return next();
	}
	const principal = await getAuthPrincipal(c as any);
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	return next();
});

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", async (c) => {
	const tenant = resolveTenant(c.req.header("host"), c.env);
	const principal = await getAuthPrincipal(c as any);
	if (tenant.kind === "domain") {
		return c.json({ domains: [tenant.domain], tenantDomain: tenant.domain });
	}
	if (tenant.kind === "admin" && principal?.realm === "admin") {
		return c.json({ domains: configuredDomains(c.env), tenantDomain: null });
	}
	return c.json({ domains: [] as string[], tenantDomain: null });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c: AppContext) => {
	const principal = await getAuthPrincipal(c as any);
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const tenant = resolveTenant(c.req.header("host"), c.env);
	if (principal.realm === "user") {
		const email = await ensureUserMailbox(c.env, principal.email);
		return c.json([{ id: email, email, name: email }]);
	}
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	const mailboxMap = new Map<string, { id: string; email: string; name: string }>();
	for (const m of allMailboxes) {
		mailboxMap.set(m.id.toLowerCase(), { ...m, name: m.id });
	}
	try {
		const rows = await c.env.AUTH_DB.prepare("SELECT email FROM user_accounts WHERE is_active = 1").all<{ email: string }>();
		for (const r of rows.results || []) {
			const email = r.email.toLowerCase();
			if (!mailboxMap.has(email)) {
				mailboxMap.set(email, { id: email, email, name: email });
			}
		}
	} catch {
		// Ignore if table query fails
	}
	const merged = Array.from(mailboxMap.values());
	const visible = tenant.kind === "domain"
		? merged.filter((m) => mailboxDomain(m.id) === tenant.domain)
		: merged;
	return c.json(visible);
});

app.post("/api/v1/mailboxes", async (c: AppContext) => {
	const principal = await getAuthPrincipal(c as any);
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	if (principal.realm !== "admin") {
		return c.json({ error: "Only admins can create mailboxes" }, 403);
	}
	const tenant = resolveTenant(c.req.header("host"), c.env);
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = rawEmail.toLowerCase();
	const domain = mailboxDomain(email);
	if (!configuredDomains(c.env).includes(domain)) {
		return c.json({ error: "Domain is not configured" }, 400);
	}
	if (tenant.kind === "domain" && domain !== tenant.domain) {
		return c.json({ error: "You can only create mailboxes for this domain" }, 403);
	}
	const key = `mailboxes/${email}.json`;
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = { ...DEFAULT_MAILBOX_SETTINGS, fromName: name };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	await syncAliasPointers(c.env.BUCKET, email, [], mailboxAliases(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c: any): Promise<Response> => {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	if (!(await canAccessMailbox(c as any, mailboxId))) return c.json({ error: "Forbidden" }, 403);
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) {
		const principal = await getAuthPrincipal(c as any);
		if (
			principal?.realm === "admin" ||
			(principal?.realm === "user" && principal.email.toLowerCase() === mailboxId.toLowerCase())
		) {
			await ensureUserMailbox(c.env, mailboxId);
			const created = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
			if (created) {
				return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await created.json() });
			}
		}
		return c.json({ error: "Not found" }, 404);
	}
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	if (!(await canAccessMailbox(c as any, mailboxId))) return c.json({ error: "Forbidden" }, 403);
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = `mailboxes/${mailboxId}.json`;
	const existing = await getMailboxSettings(c.env.BUCKET, mailboxId);
	if (existing === null) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	await syncAliasPointers(c.env.BUCKET, mailboxId, mailboxAliases(existing), mailboxAliases(settings as { aliases?: string[] }));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	if (!(await canAccessMailbox(c as any, mailboxId))) return c.json({ error: "Forbidden" }, 403);
	const key = `mailboxes/${mailboxId}.json`;
	const settings = await getMailboxSettings(c.env.BUCKET, mailboxId);
	if (settings === null) return c.json({ error: "Not found" }, 404);
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailboxId)) as any;
	const attachments = await stub.listAllAttachmentKeys();
	const keys = [
		key,
		...mailboxAliases(settings).map((alias) => `aliases/${alias}.json`),
		...attachments.map((att: { email_id: string; id: string; filename: string }) =>
			`attachments/${att.email_id}/${att.id}/${att.filename}`,
		),
	];
	await c.env.BUCKET.delete(keys);
	await stub.destroyStorage();
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	const aliases = mailboxAliases(await getMailboxSettings(c.env.BUCKET, mailboxId));
	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId, aliases));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await createQueuedEmail(stub, Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	const delivery = await sendAndTrack(stub, c.env.EMAIL, messageId, {
		to, cc, bcc, from, subject, html, text,
		attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
		...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
	});
	if (delivery.status === "failed") return c.json({ id: messageId, status: "failed", error: delivery.error }, 502);
	return c.json({ id: messageId, status: "sent" }, 200);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	const dangerous = /^(text\/html|image\/svg\+xml|text\/xml|application\/xhtml\+xml|text\/javascript|application\/javascript)/i.test(attachment.mimetype);
	headers.set("Content-Type", dangerous ? "application/octet-stream" : attachment.mimetype);
	headers.set("X-Content-Type-Options", "nosniff");
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

async function handleProxyImage(c: AppContext) {
	const raw = c.req.query("url");
	if (!raw) return c.json({ error: "url is required" }, 400);
	const target = isSafeImageUrl(raw);
	if (!target) return c.json({ error: "Blocked url" }, 400);

	let currentUrl = target.toString();
	let upstream: Response | null = null;
	for (let i = 0; i < 3; i++) {
		const safeTarget = isSafeImageUrl(currentUrl);
		if (!safeTarget) return c.json({ error: "Blocked redirect url" }, 400);
		const res = await fetch(safeTarget.toString(), {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
				Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
			},
			redirect: "manual",
		});
		if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
			try {
				currentUrl = new URL(res.headers.get("location")!, safeTarget).toString();
				continue;
			} catch {
				break;
			}
		}
		upstream = res;
		break;
	}

	if (!upstream || !upstream.ok) {
		return c.json({ error: "Failed to fetch image" }, upstream ? (upstream.status as any) : 502);
	}

	const contentType = upstream.headers.get("content-type") || "image/jpeg";
	if (contentType.includes("svg") || contentType.includes("html") || contentType.includes("javascript")) {
		return c.json({ error: "Not an image" }, 415);
	}

	return new Response(upstream.body, {
		headers: {
			"Content-Type": contentType,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "public, max-age=86400",
			"Access-Control-Allow-Origin": "*",
		},
	});
}

app.get("/api/v1/mailboxes/:mailboxId/proxy-image", handleProxyImage);
app.get("/api/v1/proxy-image", handleProxyImage);

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(event: { raw: ReadableStream; rawSize: number }, env: Env, ctx: ExecutionContext) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const { raw: rawRecipients } = collectRecipientAddresses(parsedEmail);
	if (rawRecipients.length === 0) throw new Error("received email with empty recipients");

	const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	const mailboxIds = await resolveInboundMailboxIds(env.BUCKET, parsedEmail, allowedAddresses);
	if (mailboxIds.length === 0) {
		console.log("Ignoring email: no matching mailbox for recipients", rawRecipients);
		return;
	}

	const toRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const sender = (parsedEmail.from?.address || "").toLowerCase();
	const subject = parsedEmail.subject || "";
	const folder = classifyInboundFolder({ sender, subject, headers: parsedEmail.headers }) === "spam"
		? Folders.SPAM
		: Folders.INBOX;

	const inReplyTo = parsedEmail.inReplyTo ? extractMessageId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parseReferences(parsedEmail.references) : [];
	const originalMessageId = parsedEmail.messageId ? extractMessageId(parsedEmail.messageId) : null;

	for (const mailboxId of mailboxIds) {
		const messageId = crypto.randomUUID();
		const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId)) as any;

		const attachmentData: StoredAttachment[] = [];
		if (parsedEmail.attachments) {
			for (const att of parsedEmail.attachments) {
				const attId = crypto.randomUUID();
				const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
				await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
				attachmentData.push({
					id: attId, email_id: messageId, filename, mimetype: att.mimeType,
					size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
					content_id: att.contentId || null, disposition: att.disposition || "attachment",
				});
			}
		}

		let threadId = messageId;
		for (const lookupId of preferredThreadLookupIds(inReplyTo, emailReferences)) {
			const existing = await stub.findEmailByMessageId(lookupId);
			if (existing?.thread_id || existing?.id) {
				threadId = existing.thread_id || existing.id;
				break;
			}
		}
		if (threadId === messageId) {
			const subjectThread = await stub.findThreadBySubject(subject, sender);
			if (subjectThread) threadId = subjectThread;
		}

		await stub.createEmail(folder, {
			id: messageId, subject, sender,
			recipient: toRecipients.join(", "),
			cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
			date: parseEmailDate(parsedEmail.date),
			body: parsedEmail.html || parsedEmail.text || "",
			in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
		}, attachmentData);

		const settings = await getMailboxSettings(env.BUCKET, mailboxId);
		const skip = shouldSkipAutoDraft({
			folder,
			sender,
			subject,
			autoDraftEnabled: settings?.autoDraft !== false,
			hasDraftForThread: await stub.hasDraftForThread(threadId),
			hasPriorOutbound: await stub.hasSentTo(sender),
		});
		if (skip) continue;

		const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
		ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mailboxId, emailId: messageId, sender, subject, threadId }),
		})).catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message)));
	}
}

export { app, receiveEmail };
