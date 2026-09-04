import { describe, expect, it } from "vitest";
import { extractMessageId, preferredThreadLookupIds, sanitizeFtsQuery } from "../threading";

describe("extractMessageId", () => {
	it("unwraps angle brackets", () => {
		expect(extractMessageId("<abc@example.com>")).toBe("abc@example.com");
		expect(extractMessageId("abc@example.com")).toBe("abc@example.com");
	});
});

describe("preferredThreadLookupIds", () => {
	it("prefers In-Reply-To then newest References", () => {
		expect(preferredThreadLookupIds("parent@x", ["root@x", "mid@x", "parent@x"])).toEqual([
			"parent@x",
			"mid@x",
			"root@x",
		]);
	});
});

describe("sanitizeFtsQuery", () => {
	it("tokenizes and quotes terms", () => {
		expect(sanitizeFtsQuery(`hello "world" invoice`)).toBe(`"hello"* AND "world"* AND "invoice"*`);
	});
});
