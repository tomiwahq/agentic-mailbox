import { Loader } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

export default function AdminOverviewRoute() {
	const { data, isLoading } = useQuery({
		queryKey: ["admin-overview"],
		queryFn: () => api.adminOverview(),
	});
	if (isLoading || !data) return <Loader />;
	return (
		<div className="grid gap-4 md:grid-cols-4">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4"><p className="text-sm text-kumo-subtle">Mailboxes</p><p className="text-2xl font-semibold">{data.totalMailboxes}</p></div>
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4"><p className="text-sm text-kumo-subtle">Users</p><p className="text-2xl font-semibold">{data.activeUsers}</p></div>
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4"><p className="text-sm text-kumo-subtle">Active Sessions</p><p className="text-2xl font-semibold">{data.activeUserSessions}</p></div>
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4"><p className="text-sm text-kumo-subtle">Domains</p><p className="text-2xl font-semibold">{data.activeDomains}</p></div>
		</div>
	);
}
