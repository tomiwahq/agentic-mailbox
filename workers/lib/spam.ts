// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

type HeaderInput = { key?: string; value?: string }[] | Record<string, string> | null | undefined;

export function normalizeHeaders(headers: HeaderInput): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	if (Array.isArray(headers)) {
		for (const h of headers) {
			if (!h?.key) continue;
			out[h.key.toLowerCase()] = String(h.value ?? "");
		}
		return out;
	}
	for (const [key, value] of Object.entries(headers)) {
		out[key.toLowerCase()] = String(value ?? "");
	}
	return out;
}

export function isAutomatedSender(address: string, subject = ""): boolean {
	const local = (address.split("@")[0] || "").toLowerCase();
	if (
		/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce|automated|donotreply)/i.test(
			local,
		)
	) {
		return true;
	}
	if (/\b(out of office|undeliverable|delivery status|auto[- ]?reply|automatic reply)\b/i.test(subject)) {
		return true;
	}
	return false;
}

export function classifyInboundFolder(input: {
	sender: string;
	subject: string;
	headers?: HeaderInput;
}): "spam" | "inbox" {
	const headers = normalizeHeaders(input.headers);
	const sender = (input.sender || "").toLowerCase();
	const subject = input.subject || "";

	const spamFlag = headers["x-spam-flag"] || headers["x-spam-status"] || "";
	if (/^yes\b/i.test(spamFlag) || /\b(spam|yes)\b/i.test(spamFlag)) return "spam";

	const precedence = headers["precedence"] || "";
	if (/^(bulk|junk)$/i.test(precedence)) return "spam";

	const auth = headers["authentication-results"] || "";
	if (/spf=fail/i.test(auth) && /dkim=fail/i.test(auth)) return "spam";

	if (/mailer-daemon|postmaster@/i.test(sender) || /\bundeliverable\b/i.test(subject)) {
		return "spam";
	}

	if (headers["list-unsubscribe"] && /newsletter|unsubscribe|marketing|promo/i.test(subject)) {
		return "spam";
	}

	return "inbox";
}

export function shouldSkipAutoDraft(input: {
	folder: string;
	sender: string;
	subject: string;
	autoDraftEnabled: boolean;
	hasDraftForThread: boolean;
	hasPriorOutbound: boolean;
}): boolean {
	if (!input.autoDraftEnabled) return true;
	if (input.folder === "spam") return true;
	if (input.hasDraftForThread) return true;
	if (isAutomatedSender(input.sender, input.subject)) return true;
	if (!input.hasPriorOutbound) return true;
	return false;
}
