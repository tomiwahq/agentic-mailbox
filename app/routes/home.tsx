// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader } from "@cloudflare/kumo";
import { EnvelopeIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { mailboxInboxPath } from "~/lib/tenant";
import { useMailboxes } from "~/queries/mailboxes";
import { useSession } from "~/queries/session";

export function meta() {
	return [{ title: "Agentic Mailbox" }];
}

export default function HomeRoute() {
	const navigate = useNavigate();
	const { data: session, isLoading: sessionLoading } = useSession();
	const isAdmin = session?.principal?.realm === "admin";
	const { data: mailboxes = [], isLoading: mailboxesLoading } = useMailboxes({
		enabled: Boolean(session?.authenticated && session.principal?.realm === "admin"),
	});

	useEffect(() => {
		if (sessionLoading || !session) return;
		if (session.tenant.kind === "admin") {
			navigate(session.authenticated ? "/admin/inboxes" : "/admin/login", { replace: true });
			return;
		}
		if (!session.authenticated) {
			navigate("/login", { replace: true });
			return;
		}
		if (session.principal?.realm === "user" && session.principal.email) {
			navigate(mailboxInboxPath(session.principal.email), { replace: true });
		}
	}, [session, sessionLoading, navigate]);

	if (sessionLoading || !session || session.principal?.realm === "user") {
		return (
			<div className="flex justify-center items-center min-h-screen">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8 flex items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1>
						{session.tenant.kind === "domain" && session.tenant.domain && (
							<p className="text-sm text-kumo-subtle mt-1">{session.tenant.domain}</p>
						)}
					</div>
					{isAdmin && (
						<Button variant="secondary" onClick={() => navigate("/admin")}>
							Admin Console
						</Button>
					)}
				</div>

				{mailboxesLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : mailboxes.length > 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						{mailboxes.map((account, idx) => (
							<RouterLink
								key={account.id}
								to={mailboxInboxPath(account.email || account.id)}
								className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
									{(account.name || account.email || "?").charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-kumo-default truncate">
										{account.name || account.email}
									</div>
									<div className="text-sm text-kumo-subtle">{account.email}</div>
								</div>
							</RouterLink>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<EnvelopeIcon size={48} weight="thin" className="text-kumo-subtle mb-4" />
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">
								No mailboxes yet
							</h3>
							<p className="text-sm text-kumo-subtle max-w-sm">
								Create mailbox users from the admin console.
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
