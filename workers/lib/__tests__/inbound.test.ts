import { describe, expect, it } from "vitest";
import { resolveInboundMailboxIds } from "../inbound";

function fakeBucket(existing: Record<string, string>) {
	return {
		head: async (key: string) => (existing[key] ? { key } : null),
		get: async (key: string) => {
			if (!existing[key]) return null;
			return {
				json: async () => JSON.parse(existing[key]),
			};
		},
	} as unknown as R2Bucket;
}

describe("resolveInboundMailboxIds", () => {
	it("matches plus-addresses and aliases", async () => {
		const bucket = fakeBucket({
			"mailboxes/you@hacktivlabs.io.json": "{}",
			"aliases/hello@hacktivlabs.io.json": JSON.stringify({ mailboxId: "you@hacktivlabs.io" }),
		});
		const ids = await resolveInboundMailboxIds(
			bucket,
			{
				to: [{ address: "you+stripe@hacktivlabs.io" }],
				cc: [{ address: "hello@hacktivlabs.io" }],
			},
			[],
		);
		expect(ids).toEqual(["you@hacktivlabs.io"]);
	});
});
