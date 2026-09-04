// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	AUTH_PEPPER: string;
	MCP_ADMIN_TOKEN?: string;
	BOOTSTRAP_SECRET?: string;
}
