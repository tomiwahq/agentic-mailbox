import { Button, Input, Text } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";

export default function AdminDomainsRoute() {
	const [domain, setDomain] = useState("");
	const [host, setHost] = useState("");
	const [error, setError] = useState<string | null>(null);
	const { data = [], refetch } = useQuery({
		queryKey: ["admin-domains"],
		queryFn: () => api.listAdminDomains(),
	});
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4 space-y-2">
				<h2 className="font-semibold">Add domain</h2>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<div className="flex gap-2">
					<Input label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
					<Input label="Host" value={host} onChange={(e) => setHost(e.target.value)} />
					<Button onClick={async () => {
						setError(null);
						try {
							await api.createAdminDomain(domain, host);
							setDomain("");
							setHost("");
							refetch();
						} catch (e) {
							setError(e instanceof Error ? e.message : "Failed to add domain");
						}
					}}>Save</Button>
				</div>
			</div>
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4">
				<h2 className="font-semibold mb-2">Configured domains</h2>
				{data.map((row) => (
					<div key={row.domain} className="flex justify-between py-2 border-b border-kumo-line last:border-0">
						<span>{row.domain}</span>
						<span className="text-kumo-subtle">{row.host}</span>
					</div>
				))}
			</div>
		</div>
	);
}
