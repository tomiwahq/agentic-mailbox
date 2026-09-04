import { describe, expect, it, vi } from "vitest";
import { verifyDraft } from "../ai";

describe("verifyDraft", () => {
	it("returns the original body when the AI call fails", async () => {
		const ai = {
			run: vi.fn().mockRejectedValue(new Error("model down")),
		};
		const original = "Thanks for the update. Let's meet Tuesday.";
		await expect(verifyDraft(ai as unknown as Ai, original)).resolves.toBe(original);
	});

	it("returns short bodies unchanged", async () => {
		const ai = { run: vi.fn() };
		await expect(verifyDraft(ai as unknown as Ai, "OK")).resolves.toBe("OK");
		expect(ai.run).not.toHaveBeenCalled();
	});
});
