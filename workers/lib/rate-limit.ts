// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

type RateLimitDb = {
	prepare: (query: string) => {
		bind: (...args: unknown[]) => {
			first: <T>() => Promise<T | null>;
			run: () => Promise<unknown>;
		};
	};
};

export async function checkAuthRateLimit(
	db: RateLimitDb,
	key: string,
	limit = DEFAULT_LIMIT,
	windowMs = DEFAULT_WINDOW_MS,
): Promise<string | null> {
	const now = Date.now();
	const row = await db
		.prepare("SELECT window_start, count FROM auth_rate_limits WHERE limit_key = ?")
		.bind(key)
		.first<{ window_start: number | string; count: number }>();

	const windowStart = Number(row?.window_start || 0);
	if (!row || !windowStart || now - windowStart >= windowMs) {
		await db
			.prepare("INSERT OR REPLACE INTO auth_rate_limits (limit_key, window_start, count) VALUES (?, ?, 1)")
			.bind(key, String(now))
			.run();
		return null;
	}

	if (row.count >= limit) {
		return "Too many attempts. Try again in a few minutes.";
	}

	await db.prepare("UPDATE auth_rate_limits SET count = count + 1 WHERE limit_key = ?").bind(key).run();
	return null;
}

export const consumeAuthRateLimit = async (
	env: { AUTH_DB: RateLimitDb },
	key: string,
	limit?: number,
	windowMs?: number,
) => checkAuthRateLimit(env.AUTH_DB, key, limit, windowMs);

export function clientIp(source: Request | Headers | { get(name: string): string | undefined }): string {
	const headers = source instanceof Request ? source.headers : source;
	return headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
