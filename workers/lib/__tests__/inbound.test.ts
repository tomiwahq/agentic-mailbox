import { describe, expect, it } from "vitest";
import { resolveInboundMailboxIds } from "../inbound";

function mockBucket(existing: Record<string, unknown>) {
	return {
		head: async (key: string) => (key in existing ? { key } : null),
		get: async (key: string) => {
			if (!(key in existing)) return null;
			return { json: async () => existing[key] };
		},
	} as unknown as R2Bucket;
}

describe("resolveInboundMailboxIds", () => {
	it("delivers to every existing To/Cc mailbox and plus-address", async () => {
		const bucket = mockBucket({
			"mailboxes/you@hacktivlabs.io.json": {},
			"mailboxes/other@hacktivlabs.io.json": {},
			"aliases/hello@hacktivlabs.io.json": { mailboxId: "you@hacktivlabs.io" },
		});
		const ids = await resolveInboundMailboxIds(
			bucket,
			{
				to: [{ address: "you+stripe@hacktivlabs.io" }],
				cc: [{ address: "hello@hacktivlabs.io" }, { address: "other@hacktivlabs.io" }],
			},
			[],
		);
		expect(ids.sort()).toEqual(["other@hacktivlabs.io", "you@hacktivlabs.io"]);
	});

	it("respects EMAIL_ADDRESSES allowlist", async () => {
		const bucket = mockBucket({
			"mailboxes/you@hacktivlabs.io.json": {},
			"mailboxes/other@hacktivlabs.io.json": {},
		});
		const ids = await resolveInboundMailboxIds(
			bucket,
			{ to: [{ address: "you@hacktivlabs.io" }, { address: "other@hacktivlabs.io" }] },
			["you@hacktivlabs.io"],
		);
		expect(ids).toEqual(["you@hacktivlabs.io"]);
	});
});
