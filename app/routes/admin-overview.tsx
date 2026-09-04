import { Loader } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

const CARDS = [
	{ key: "totalMailboxes", label: "Mailboxes" },
	{ key: "activeUsers", label: "Users" },
	{ key: "activeUserSessions", label: "Active sessions" },
	{ key: "activeDomains", label: "Domains" },
] as const;

export default function AdminOverviewRoute() {
	const { data, isLoading } = useQuery({
		queryKey: ["admin-overview"],
		queryFn: () => api.adminOverview(),
	});
	if (isLoading || !data) {
		return (
			<div className="flex justify-center py-16">
				<Loader size="lg" />
			</div>
		);
	}
	return (
		<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
			{CARDS.map((card) => (
				<div key={card.key} className="rounded-lg border border-kumo-line bg-kumo-base p-4">
					<p className="text-sm text-kumo-subtle">{card.label}</p>
					<p className="text-2xl font-semibold mt-1">{data[card.key]}</p>
				</div>
			))}
		</div>
	);
}
