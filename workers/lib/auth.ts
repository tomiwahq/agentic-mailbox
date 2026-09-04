import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Env } from "../types";

export type Realm = "user" | "admin";

export type AuthPrincipal =
	| { realm: "admin"; adminId: string; email: string }
	| { realm: "user"; userId: string; email: string; domain: string };

const SESSION_COOKIE_USER = "user_session";
const SESSION_COOKIE_ADMIN = "admin_session";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

let schemaReady = false;

function nowIso() {
	return new Date().toISOString();
}

function normalizeHost(hostHeader: string | undefined | null) {
	if (!hostHeader) return "";
	return hostHeader.split(":")[0].trim().toLowerCase();
}

function secureCookie(c: Context<{ Bindings: Env }>) {
	const proto = c.req.header("x-forwarded-proto") || "https";
	return proto === "https";
}

export async function ensureAuthSchema(env: Env) {
	if (schemaReady) return;
	await env.AUTH_DB.exec(`
CREATE TABLE IF NOT EXISTS domains (
  domain TEXT PRIMARY KEY,
  host TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_accounts_domain ON user_accounts(domain);
CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  realm TEXT NOT NULL,
  account_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_realm_account ON passkeys(realm, account_id);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  realm TEXT NOT NULL,
  account_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  host TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_lookup ON auth_challenges(realm, account_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  realm TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_realm_account ON sessions(realm, account_id);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
`);
	schemaReady = true;
}

export async function syncDomainsFromEnv(env: Env) {
	const domains = (env.DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
	for (const domain of domains) {
		await env.AUTH_DB.prepare(
			"INSERT OR IGNORE INTO domains (domain, host, is_active, created_at) VALUES (?, ?, 1, ?)",
		).bind(domain, domain, nowIso()).run();
	}
}

export function resolveTenant(hostHeader: string | undefined, env: Env) {
	const host = normalizeHost(hostHeader);
	const adminHost = normalizeHost(env.ADMIN_HOST || "");
	if (!host) return { kind: "unknown" as const };
	if (adminHost && host === adminHost) return { kind: "admin" as const, host };
	const domains = (env.DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
	for (const domain of domains) {
		if (host === domain || host.endsWith(`.${domain}`)) {
			return { kind: "domain" as const, domain, host };
		}
	}
	return { kind: "unknown" as const, host };
}

export async function hashPassword(password: string, pepper: string) {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey("raw", enc.encode(password + pepper), "PBKDF2", false, ["deriveBits"]);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: 120_000, salt }, baseKey, 256);
	const hash = new Uint8Array(bits);
	return `pbkdf2$120000$${btoa(String.fromCharCode(...salt))}$${btoa(String.fromCharCode(...hash))}`;
}

export async function verifyPassword(password: string, pepper: string, encoded: string) {
	const [algo, iter, saltB64, hashB64] = encoded.split("$");
	if (algo !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey("raw", enc.encode(password + pepper), "PBKDF2", false, ["deriveBits"]);
	const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
	const expected = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: Number(iter), salt }, baseKey, expected.byteLength * 8);
	const actual = new Uint8Array(bits);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

async function createSession(c: Context<{ Bindings: Env }>, principal: AuthPrincipal) {
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
	await c.env.AUTH_DB.prepare(
		"INSERT INTO sessions (id, realm, account_id, email, domain, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	).bind(
		id,
		principal.realm,
		principal.realm === "admin" ? principal.adminId : principal.userId,
		principal.email,
		principal.realm === "user" ? principal.domain : null,
		expiresAt,
		nowIso(),
		nowIso(),
	).run();
	const cookieName = principal.realm === "admin" ? SESSION_COOKIE_ADMIN : SESSION_COOKIE_USER;
	setCookie(c, cookieName, id, { path: "/", httpOnly: true, secure: secureCookie(c), sameSite: "Lax", maxAge: SESSION_TTL_MS / 1000 });
}

export function clearSessionCookies(c: Context<{ Bindings: Env }>) {
	deleteCookie(c, SESSION_COOKIE_USER, { path: "/" });
	deleteCookie(c, SESSION_COOKIE_ADMIN, { path: "/" });
}

export async function logout(c: Context<{ Bindings: Env }>) {
	const userSession = getCookie(c, SESSION_COOKIE_USER);
	const adminSession = getCookie(c, SESSION_COOKIE_ADMIN);
	if (userSession) await c.env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(userSession).run();
	if (adminSession) await c.env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(adminSession).run();
	clearSessionCookies(c);
}

export async function getAuthPrincipal(c: Context<{ Bindings: Env }>): Promise<AuthPrincipal | null> {
	const adminToken = getCookie(c, SESSION_COOKIE_ADMIN);
	if (adminToken) {
		const row = await c.env.AUTH_DB.prepare("SELECT * FROM sessions WHERE id = ? AND realm = 'admin' AND expires_at > ?").bind(adminToken, nowIso()).first<any>();
		if (row) return { realm: "admin", adminId: row.account_id, email: row.email };
	}
	const userToken = getCookie(c, SESSION_COOKIE_USER);
	if (!userToken) return null;
	const row = await c.env.AUTH_DB.prepare("SELECT * FROM sessions WHERE id = ? AND realm = 'user' AND expires_at > ?").bind(userToken, nowIso()).first<any>();
	if (!row) return null;
	return { realm: "user", userId: row.account_id, email: row.email, domain: row.domain };
}

export async function requireAdmin(c: Context<{ Bindings: Env }>) {
	const principal = await getAuthPrincipal(c);
	if (!principal || principal.realm !== "admin") return null;
	return principal;
}

export async function requireUser(c: Context<{ Bindings: Env }>, tenantDomain: string) {
	const principal = await getAuthPrincipal(c);
	if (!principal || principal.realm !== "user") return null;
	if (principal.domain !== tenantDomain) return null;
	return principal;
}

export function mailboxDomain(mailboxId: string) {
	return mailboxId.toLowerCase().split("@")[1] || "";
}

export async function canAccessMailbox(c: Context<{ Bindings: Env }>, mailboxId: string) {
	const principal = await getAuthPrincipal(c);
	if (!principal) return false;
	if (principal.realm === "admin") return true;
	const normalizedMailbox = mailboxId.toLowerCase();
	return principal.email === normalizedMailbox && principal.domain === mailboxDomain(normalizedMailbox);
}

export function resolvePasskeyRpId(env: Env, hostHeader: string | undefined): string | undefined {
	const host = normalizeHost(hostHeader);
	const tenant = resolveTenant(hostHeader, env);
	if (tenant.kind === "domain" && tenant.domain) return tenant.domain;
	if (tenant.kind === "admin") {
		const adminHost = normalizeHost(env.ADMIN_HOST);
		const domains = (env.DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
		for (const domain of domains) {
			if (adminHost === domain || adminHost.endsWith(`.${domain}`)) return domain;
		}
	}
	return (env.PASSKEY_RP_ID || "").trim() || host || undefined;
}

export async function startRegistration(c: Context<{ Bindings: Env }>, realm: Realm, accountId: string, userName: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
	const rpID = resolvePasskeyRpId(c.env, c.req.header("host"));
	if (!rpID) throw new Error("PASSKEY_RP_ID is required for passkeys");
	const host = normalizeHost(c.req.header("host"));
	const options = await generateRegistrationOptions({
		rpName: c.env.PASSKEY_RP_NAME || "Agentic Mailbox",
		rpID,
		userID: new TextEncoder().encode(accountId),
		userName,
		attestationType: "none",
		excludeCredentials: [],
		authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
	});
	await c.env.AUTH_DB.prepare("INSERT INTO auth_challenges (id, realm, account_id, challenge, host, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), realm, accountId, options.challenge, host, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(), nowIso())
		.run();
	return options;
}

export async function finishRegistration(
	c: Context<{ Bindings: Env }>,
	realm: Realm,
	accountId: string,
	response: RegistrationResponseJSON,
) {
	const rpID = resolvePasskeyRpId(c.env, c.req.header("host"));
	if (!rpID) throw new Error("PASSKEY_RP_ID is required for passkeys");
	const host = normalizeHost(c.req.header("host"));
	const challengeRow = await c.env.AUTH_DB.prepare(
		"SELECT challenge FROM auth_challenges WHERE realm = ? AND account_id = ? AND host = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
	).bind(realm, accountId, host, nowIso()).first<{ challenge: string }>();
	if (!challengeRow) return { verified: false, reason: "Missing challenge" };
	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge: challengeRow.challenge,
		expectedOrigin: `${secureCookie(c) ? "https" : "http"}://${host}`,
		expectedRPID: rpID,
	});
	if (!verification.verified || !verification.registrationInfo) return { verified: false, reason: "Verification failed" };
	const { credential } = verification.registrationInfo;
	await c.env.AUTH_DB.prepare(
		"INSERT INTO passkeys (id, realm, account_id, credential_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	).bind(
		crypto.randomUUID(),
		realm,
		accountId,
		credential.id,
		JSON.stringify(Array.from(credential.publicKey)),
		credential.counter,
		JSON.stringify(response.response.transports || []),
		nowIso(),
	).run();
	return { verified: true };
}

export async function startAuthentication(c: Context<{ Bindings: Env }>, realm: Realm, accountId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
	const rpID = resolvePasskeyRpId(c.env, c.req.header("host"));
	if (!rpID) throw new Error("PASSKEY_RP_ID is required for passkeys");
	const credentials = await c.env.AUTH_DB.prepare("SELECT credential_id, transports FROM passkeys WHERE realm = ? AND account_id = ?").bind(realm, accountId).all<any>();
	const options = await generateAuthenticationOptions({
		rpID,
		userVerification: "preferred",
		allowCredentials: (credentials.results || []).map((row: any) => ({
			id: row.credential_id,
			type: "public-key",
			transports: row.transports ? JSON.parse(row.transports) : undefined,
		})),
	});
	const host = normalizeHost(c.req.header("host"));
	await c.env.AUTH_DB.prepare("INSERT INTO auth_challenges (id, realm, account_id, challenge, host, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), realm, accountId, options.challenge, host, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(), nowIso())
		.run();
	return options;
}

export async function finishAuthentication(
	c: Context<{ Bindings: Env }>,
	realm: Realm,
	accountId: string,
	response: AuthenticationResponseJSON,
) {
	const rpID = resolvePasskeyRpId(c.env, c.req.header("host"));
	if (!rpID) throw new Error("PASSKEY_RP_ID is required for passkeys");
	const row = await c.env.AUTH_DB.prepare("SELECT * FROM passkeys WHERE realm = ? AND account_id = ? AND credential_id = ?")
		.bind(realm, accountId, response.id)
		.first<any>();
	if (!row) return { verified: false, reason: "Passkey not found" };
	const challengeRow = await c.env.AUTH_DB.prepare(
		"SELECT challenge FROM auth_challenges WHERE realm = ? AND account_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
	).bind(realm, accountId, nowIso()).first<{ challenge: string }>();
	if (!challengeRow) return { verified: false, reason: "Missing challenge" };
	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge: challengeRow.challenge,
		expectedOrigin: `${secureCookie(c) ? "https" : "http"}://${normalizeHost(c.req.header("host"))}`,
		expectedRPID: rpID,
		credential: {
			id: row.credential_id,
			publicKey: new Uint8Array(JSON.parse(row.public_key)),
			counter: row.counter,
			transports: row.transports ? JSON.parse(row.transports) : undefined,
		},
	});
	if (!verification.verified) return { verified: false, reason: "Verification failed" };
	await c.env.AUTH_DB.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(verification.authenticationInfo.newCounter, row.id).run();
	return { verified: true };
}

export async function loginUser(c: Context<{ Bindings: Env }>, userId: string, email: string, domain: string) {
	await createSession(c, { realm: "user", userId, email, domain });
}

export async function loginAdmin(c: Context<{ Bindings: Env }>, adminId: string, email: string) {
	await createSession(c, { realm: "admin", adminId, email });
}
