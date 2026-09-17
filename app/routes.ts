// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	index,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("login", "routes/login.tsx"),
	route("admin/login", "routes/admin-login.tsx"),
	route("admin", "routes/admin.tsx", [
		index("routes/admin-overview.tsx"),
		route("inboxes", "routes/admin-inboxes.tsx"),
		route("domains", "routes/admin-domains.tsx"),
		route("mailboxes", "routes/admin-mailboxes.tsx"),
	]),
	route("mailbox/:mailboxId", "routes/mailbox.tsx", [
		index("routes/mailbox-index.tsx"),
		route("emails/:folder", "routes/email-list.tsx"),
		route("settings", "routes/settings.tsx"),
		route("search", "routes/search-results.tsx"),
	]),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
