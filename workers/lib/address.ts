// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Strip plus-tags and lowercase: you+stripe@domain.com → you@domain.com */
export function canonicalizeAddress(address: string): string {
	const trimmed = address.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0) return trimmed;
	let local = trimmed.slice(0, at);
	const domain = trimmed.slice(at + 1);
	const plus = local.indexOf("+");
	if (plus >= 0) local = local.slice(0, plus);
	return `${local}@${domain}`;
}

export function collectRecipientAddresses(parsed: {
	to?: { address?: string }[] | null;
	cc?: { address?: string }[] | null;
	bcc?: { address?: string }[] | null;
}): { raw: string[]; canonical: string[] } {
	const raw: string[] = [];
	const seenRaw = new Set<string>();
	for (const list of [parsed.to, parsed.cc, parsed.bcc]) {
		for (const entry of list || []) {
			const addr = entry.address?.trim().toLowerCase();
			if (!addr || seenRaw.has(addr)) continue;
			seenRaw.add(addr);
			raw.push(addr);
		}
	}
	const canonical: string[] = [];
	const seenCanon = new Set<string>();
	for (const addr of raw) {
		const canon = canonicalizeAddress(addr);
		if (!canon || seenCanon.has(canon)) continue;
		seenCanon.add(canon);
		canonical.push(canon);
	}
	return { raw, canonical };
}

export function parseEmailDate(date: string | Date | undefined | null): string {
	if (!date) return new Date().toISOString();
	const d = date instanceof Date ? date : new Date(date);
	return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function senderAllowed(fromEmail: string, mailboxId: string, aliases: string[] = []): boolean {
	const from = fromEmail.toLowerCase();
	const mailbox = mailboxId.toLowerCase();
	if (from === mailbox) return true;
	return aliases.map((a) => a.toLowerCase()).includes(from);
}

export function isSafeImageUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const host = url.hostname.toLowerCase();
	if (
		host === "localhost" ||
		host === "0.0.0.0" ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host === "[::1]"
	) {
		return null;
	}
	if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
	if (host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) return null;
	return url;
}
