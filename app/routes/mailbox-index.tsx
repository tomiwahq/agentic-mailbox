// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Navigate, useParams } from "react-router";
import { mailboxInboxPath } from "~/lib/tenant";

export default function MailboxIndexRoute() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  return <Navigate to={mailboxInboxPath(mailboxId || "")} replace />;
}
