// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sendEmail, type SendEmailParams } from "../email-sender";
import { Folders } from "../../shared/folders";
import type { StoredAttachment } from "./attachments";

type EmailRecord = {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	delivery_status?: string | null;
};

type DeliveryStub = {
	createEmail: (folder: string, email: EmailRecord, attachments: StoredAttachment[]) => Promise<void>;
	updateDeliveryStatus: (id: string, status: "queued" | "sent" | "failed") => Promise<void>;
};

export async function createQueuedEmail(
	stub: DeliveryStub,
	folder: string,
	email: EmailRecord,
	attachments: StoredAttachment[],
) {
	await stub.createEmail(
		folder || Folders.SENT,
		{ ...email, delivery_status: "queued" },
		attachments,
	);
}

export async function sendAndTrack(
	stub: DeliveryStub,
	binding: SendEmail,
	emailId: string,
	params: SendEmailParams,
): Promise<{ status: "sent" } | { status: "failed"; error: string }> {
	try {
		await sendEmail(binding, params);
		await stub.updateDeliveryStatus(emailId, "sent");
		return { status: "sent" };
	} catch (e) {
		const error = (e as Error).message || "Delivery failed";
		console.error("Outbound delivery failed:", error);
		await stub.updateDeliveryStatus(emailId, "failed");
		return { status: "failed", error };
	}
}
