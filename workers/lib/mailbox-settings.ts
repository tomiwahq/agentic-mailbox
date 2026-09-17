// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: { enabled: boolean; text: string; html?: string };
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
	aliases?: string[];
	autoDraft?: boolean;
	loadRemoteImages?: boolean;
}

export const DEFAULT_MAILBOX_SETTINGS: MailboxSettings = {
	fromName: "",
	forwarding: { enabled: false, email: "" },
	signature: { enabled: false, text: "" },
	autoReply: { enabled: false, subject: "", message: "" },
	aliases: [],
	autoDraft: true,
	loadRemoteImages: false,
};

export async function getMailboxSettings(
	bucket: R2Bucket,
	mailboxId: string,
): Promise<MailboxSettings | null> {
	const obj = await bucket.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return null;
	try {
		return (await obj.json<MailboxSettings>()) || {};
	} catch {
		return {};
	}
}

export function mailboxAliases(settings: MailboxSettings | null | undefined): string[] {
	return (settings?.aliases || []).map((a) => a.trim().toLowerCase()).filter(Boolean);
}

export async function syncAliasPointers(
	bucket: R2Bucket,
	mailboxId: string,
	previous: string[] | undefined,
	next: string[] | undefined,
): Promise<void> {
	const prev = new Set((previous || []).map((a) => a.toLowerCase()));
	const curr = new Set((next || []).map((a) => a.toLowerCase()));
	for (const alias of prev) {
		if (!curr.has(alias)) await bucket.delete(`aliases/${alias}.json`);
	}
	for (const alias of curr) {
		await bucket.put(`aliases/${alias}.json`, JSON.stringify({ mailboxId }));
	}
}

export async function ensureUserMailbox(
	env: { BUCKET: R2Bucket; MAILBOX: any },
	email: string,
	fromName?: string,
): Promise<string> {
	const mailboxId = email.trim().toLowerCase();
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await env.BUCKET.head(key))) {
		const settings = {
			...DEFAULT_MAILBOX_SETTINGS,
			fromName: fromName || mailboxId.split("@")[0] || mailboxId,
		};
		await env.BUCKET.put(key, JSON.stringify(settings));
		const mailboxNs: any = env.MAILBOX;
		await mailboxNs.get(mailboxNs.idFromName(mailboxId)).getFolders();
	}
	return mailboxId;
}

export async function resolveMailboxForAddress(
	bucket: R2Bucket,
	address: string,
): Promise<string | null> {
	if (await bucket.head(`mailboxes/${address}.json`)) return address;
	const alias = await bucket.get(`aliases/${address}.json`);
	if (!alias) return null;
	try {
		const data = await alias.json<{ mailboxId?: string }>();
		return data.mailboxId || null;
	} catch {
		return null;
	}
}
