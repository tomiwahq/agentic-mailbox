import { describe, expect, it } from "vitest";
import { classifyInboundFolder, isAutomatedSender, shouldSkipAutoDraft } from "../spam";

describe("isAutomatedSender", () => {
	it("detects no-reply and bounce addresses", () => {
		expect(isAutomatedSender("noreply@example.com")).toBe(true);
		expect(isAutomatedSender("mailer-daemon@example.com")).toBe(true);
		expect(isAutomatedSender("person@example.com", "Out of office")).toBe(true);
		expect(isAutomatedSender("person@example.com", "Hello")).toBe(false);
	});
});

describe("classifyInboundFolder", () => {
	it("routes failed auth and bulk mail to spam", () => {
		expect(
			classifyInboundFolder({
				sender: "promo@spam.test",
				subject: "Sale",
				headers: { precedence: "bulk" },
			}),
		).toBe("spam");
		expect(
			classifyInboundFolder({
				sender: "evil@example.com",
				subject: "Hi",
				headers: { "authentication-results": "spf=fail dkim=fail" },
			}),
		).toBe("spam");
		expect(
			classifyInboundFolder({
				sender: "friend@example.com",
				subject: "Lunch",
			}),
		).toBe("inbox");
	});
});

describe("shouldSkipAutoDraft", () => {
	it("skips spam, automation, missing history, and existing drafts", () => {
		const base = {
			folder: "inbox",
			sender: "friend@example.com",
			subject: "Hi",
			autoDraftEnabled: true,
			hasDraftForThread: false,
			hasPriorOutbound: true,
		};
		expect(shouldSkipAutoDraft(base)).toBe(false);
		expect(shouldSkipAutoDraft({ ...base, folder: "spam" })).toBe(true);
		expect(shouldSkipAutoDraft({ ...base, autoDraftEnabled: false })).toBe(true);
		expect(shouldSkipAutoDraft({ ...base, hasDraftForThread: true })).toBe(true);
		expect(shouldSkipAutoDraft({ ...base, hasPriorOutbound: false })).toBe(true);
		expect(shouldSkipAutoDraft({ ...base, sender: "noreply@example.com" })).toBe(true);
	});
});
