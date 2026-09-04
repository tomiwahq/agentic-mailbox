import { describe, expect, it } from "vitest";
import { resolvePasskeyRpId } from "../auth";

const env = {
	DOMAINS: "hacktivlabs.io,teraboxx.com",
	ADMIN_HOST: "mailadmin.hacktivlabs.io",
	PASSKEY_RP_ID: "hacktivlabs.io",
} as any;

describe("resolvePasskeyRpId", () => {
	it("uses the tenant domain for mail hosts", () => {
		expect(resolvePasskeyRpId(env, "mail.teraboxx.com")).toBe("teraboxx.com");
		expect(resolvePasskeyRpId(env, "mail.hacktivlabs.io")).toBe("hacktivlabs.io");
	});

	it("uses the admin host's parent domain", () => {
		expect(resolvePasskeyRpId(env, "mailadmin.hacktivlabs.io")).toBe("hacktivlabs.io");
	});
});
