// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

function queryHost() {
	return typeof window !== "undefined" ? window.location.host : "ssr";
}

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	session: () => ["session", queryHost()] as const,
	config: () => ["config", queryHost()] as const,
	mailboxes: {
		all: () => ["mailboxes", queryHost()] as const,
		detail: (id: string) => ["mailboxes", queryHost(), id] as const,
	},
	emails: {
		list: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params] as const,
		detail: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	search: {
		results: (mailboxId: string, query: string, page: number) =>
			["search", mailboxId, query, page] as const,
	},
};
