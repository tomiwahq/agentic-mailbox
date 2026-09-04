// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { canonicalizeAddress, collectRecipientAddresses } from "./address";
import { resolveMailboxForAddress } from "./mailbox-settings";

export async function resolveInboundMailboxIds(
	bucket: R2Bucket,
	parsed: {
		to?: { address?: string }[] | null;
		cc?: { address?: string }[] | null;
		bcc?: { address?: string }[] | null;
	},
	allowedAddresses: string[],
): Promise<string[]> {
	const { canonical } = collectRecipientAddresses(parsed);
	const allowed = allowedAddresses.map((a) => canonicalizeAddress(a));
	const ids = new Set<string>();

	for (const address of canonical) {
		if (allowed.length > 0 && !allowed.includes(address)) continue;
		const mailboxId = await resolveMailboxForAddress(bucket, address);
		if (mailboxId) ids.add(mailboxId.toLowerCase());
	}

	return [...ids];
}
