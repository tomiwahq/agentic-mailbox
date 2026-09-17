import { describe, expect, it } from "vitest";
import { canonicalizeAddress, collectRecipientAddresses, isSafeImageUrl, parseEmailDate, senderAllowed } from "../address";

describe("canonicalizeAddress", () => {
	it("strips plus tags and lowercases", () => {
		expect(canonicalizeAddress("You+Stripe@Hacktivlabs.IO")).toBe("you@hacktivlabs.io");
	});

	it("leaves untagged addresses intact", () => {
		expect(canonicalizeAddress("you@hacktivlabs.io")).toBe("you@hacktivlabs.io");
	});
});

describe("collectRecipientAddresses", () => {
	it("unions To/Cc/Bcc and de-dupes plus variants", () => {
		const result = collectRecipientAddresses({
			to: [{ address: "you@hacktivlabs.io" }],
			cc: [{ address: "you+news@hacktivlabs.io" }, { address: "other@hacktivlabs.io" }],
			bcc: [],
		});
		expect(result.canonical).toEqual(["you@hacktivlabs.io", "other@hacktivlabs.io"]);
	});
});

describe("parseEmailDate", () => {
	it("uses the Date header when valid", () => {
		expect(parseEmailDate("Wed, 01 Jan 2025 12:00:00 +0000")).toBe("2025-01-01T12:00:00.000Z");
	});

	it("falls back for invalid dates", () => {
		const parsed = parseEmailDate("not-a-date");
		expect(Number.isNaN(new Date(parsed).getTime())).toBe(false);
	});
});

describe("isSafeImageUrl", () => {
	it("allows public https images and blocks private hosts", () => {
		expect(isSafeImageUrl("https://cdn.example.com/pix.png")?.hostname).toBe("cdn.example.com");
		expect(isSafeImageUrl("https://img.example.com/photo.jpg?size=large&w=800")?.hostname).toBe("img.example.com");
		expect(isSafeImageUrl("http://127.0.0.1/x.png")).toBeNull();
		expect(isSafeImageUrl("http://10.0.0.4/x.png")).toBeNull();
		expect(isSafeImageUrl("http://localhost:8080/image.png")).toBeNull();
		expect(isSafeImageUrl("file:///etc/passwd")).toBeNull();
		expect(isSafeImageUrl("javascript:alert(1)")).toBeNull();
	});
});

describe("senderAllowed", () => {
	it("allows mailbox and configured aliases", () => {
		expect(senderAllowed("you@hacktivlabs.io", "you@hacktivlabs.io")).toBe(true);
		expect(senderAllowed("hello@hacktivlabs.io", "you@hacktivlabs.io", ["hello@hacktivlabs.io"])).toBe(true);
		expect(senderAllowed("other@hacktivlabs.io", "you@hacktivlabs.io")).toBe(false);
	});
});
