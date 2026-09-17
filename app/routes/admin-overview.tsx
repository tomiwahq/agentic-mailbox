import { Button, Loader } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, TrayIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { mailboxInboxPath } from "~/lib/tenant";
import api from "~/services/api";

const CARDS = [
	{ key: "totalMailboxes", label: "Mailboxes" },
	{ key: "activeUsers", label: "Users" },
	{ key: "activeUserSessions", label: "Active sessions" },
	{ key: "activeDomains", label: "Domains" },
] as const;

export default function AdminOverviewRoute() {
	const navigate = useNavigate();
	const { data, isLoading } = useQuery({
		queryKey: ["admin-overview"],
		queryFn: () => api.adminOverview(),
	});

	const { data: mailboxes = [] } = useQuery({
		queryKey: ["admin-mailboxes"],
		queryFn: () => api.adminListMailboxes(),
	});

	if (isLoading || !data) {
		return (
			<div className="flex justify-center py-16">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
				{CARDS.map((card) => (
					<div key={card.key} className="rounded-lg border border-kumo-line bg-kumo-base p-4">
						<p className="text-sm text-kumo-subtle">{card.label}</p>
						<p className="text-2xl font-semibold mt-1">{data[card.key]}</p>
					</div>
				))}
			</div>

			{/* Quick Access Inboxes */}
			<div className="rounded-xl border border-kumo-line bg-kumo-base p-5">
				<div className="flex items-center justify-between gap-4 mb-4">
					<div>
						<h2 className="text-base font-semibold text-kumo-default">Quick Access Inboxes</h2>
						<p className="text-xs text-kumo-subtle mt-0.5">Jump directly into any mailbox as super admin.</p>
					</div>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => navigate("/admin/inboxes")}
					>
						View all inboxes
					</Button>
				</div>

				{(!Array.isArray(mailboxes) || mailboxes.length === 0) ? (
					<div className="py-8 text-center">
						<TrayIcon size={32} weight="thin" className="text-kumo-subtle mx-auto mb-2" />
						<p className="text-sm text-kumo-subtle">No mailboxes created yet.</p>
						<Button
							variant="primary"
							size="sm"
							className="mt-3"
							onClick={() => navigate("/admin/mailboxes")}
						>
							Create mailbox
						</Button>
					</div>
				) : (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{mailboxes.slice(0, 6).map((m, idx) => {
							const id = m?.email || m?.id || "";
							if (!id) return null;
							const domainPart = id.includes("@") ? id.split("@")[1] : "";
							return (
								<div
									key={id || idx}
									className="flex items-center justify-between gap-3 p-3 rounded-lg border border-kumo-line bg-kumo-recessed/40 hover:bg-kumo-tint/50 transition-colors"
								>
									<div className="min-w-0 flex-1">
										<div className="text-sm font-medium text-kumo-default truncate">{id}</div>
										{domainPart && <div className="text-xs text-kumo-subtle truncate">@{domainPart}</div>}
									</div>
									<Button
										size="sm"
										variant="secondary"
										icon={<ArrowSquareOutIcon size={14} />}
										onClick={() => navigate(mailboxInboxPath(id))}
									>
										Open
									</Button>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
