// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail } from "./index";
import { EmailMCP } from "./mcp";
import type { Env } from "./types";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import { ensureAuthSchema, getAuthPrincipal, resolveTenant, syncDomainsFromEnv } from "./lib/auth";

export { MailboxDO } from "./durableObject";
export { EmailAgent } from "./agent";
export { EmailMCP } from "./mcp";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env }>();

function isAdminPassthroughPath(path: string) {
	return (
		path === "/admin" ||
		path.startsWith("/admin/") ||
		path.startsWith("/api/") ||
		path.startsWith("/mcp") ||
		path.startsWith("/agents/") ||
		path.startsWith("/assets/") ||
		/\.[a-z0-9]+$/i.test(path)
	);
}

app.use("*", async (c, next) => {
	await ensureAuthSchema(c.env);
	await syncDomainsFromEnv(c.env);
	const tenant = resolveTenant(c.req.header("host"), c.env);
	const path = new URL(c.req.url).pathname;
	if (tenant.kind === "admin" && !isAdminPassthroughPath(path)) {
		return c.redirect("/admin", 302);
	}
	return next();
});

// MCP server endpoint — used by AI coding tools (ProtoAgent, Claude Code, Cursor, etc.)
// Must be before API routes and React Router catch-all
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });
app.all("/mcp", async (c) => {
	const principal = await getAuthPrincipal(c as any);
	const token = c.req.header("x-mcp-token");
	const tokenAllowed = Boolean(c.env.MCP_ADMIN_TOKEN && token && token === c.env.MCP_ADMIN_TOKEN);
	if (principal && principal.realm !== "admin") return c.json({ error: "MCP is admin-only" }, 403);
	if (!principal && !tokenAllowed) return c.json({ error: "Unauthorized" }, 401);
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});
app.all("/mcp/*", async (c) => {
	const principal = await getAuthPrincipal(c as any);
	const token = c.req.header("x-mcp-token");
	const tokenAllowed = Boolean(c.env.MCP_ADMIN_TOKEN && token && token === c.env.MCP_ADMIN_TOKEN);
	if (principal && principal.realm !== "admin") return c.json({ error: "MCP is admin-only" }, 403);
	if (!principal && !tokenAllowed) return c.json({ error: "Unauthorized" }, 401);
	return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});

// Mount the API routes
app.route("/", apiApp);
app.route("/", authRoutes);
app.route("/", adminRoutes);

// Agent WebSocket routing - must be before React Router catch-all
app.all("/agents/*", async (c) => {
	const response = await routeAgentRequest(c.req.raw, c.env);
	if (response) return response;
	return c.text("Agent not found", 404);
});

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

// Export the Hono app as the default export with an email handler
export default {
	fetch: app.fetch,
	async email(
		event: { raw: ReadableStream; rawSize: number },
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
};
