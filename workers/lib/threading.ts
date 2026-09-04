// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export function extractMessageId(value: string): string {
	const match = value.match(/<([^>]+)>/);
	if (match) return match[1];
	return value.trim().split(/\s+/)[0] || "";
}

export function parseReferences(value?: string | null): string[] {
	if (!value) return [];
	return value.split(/\s+/).filter(Boolean).map(extractMessageId).filter(Boolean);
}

/** Parent first (In-Reply-To), then References from newest to root. */
export function preferredThreadLookupIds(inReplyTo: string | null, references: string[]): string[] {
	const ids: string[] = [];
	if (inReplyTo) ids.push(inReplyTo);
	for (let i = references.length - 1; i >= 0; i--) {
		if (!ids.includes(references[i])) ids.push(references[i]);
	}
	return ids;
}

export function sanitizeFtsQuery(query: string): string {
	const tokens = query
		.replace(/["']/g, " ")
		.split(/\s+/)
		.map((t) => t.replace(/[^\w.@+-]/g, ""))
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return "";
	return tokens.map((t) => `"${t}"*`).join(" AND ");
}
