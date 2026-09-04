import { Button, Input, Text } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";

export default function AdminDomainsRoute() {
	const [domain, setDomain] = useState("");
	const [host, setHost] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { data = [], refetch, isLoading } = useQuery({
		queryKey: ["admin-domains"],
		queryFn: () => api.listAdminDomains(),
	});
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
				<div>
					<h2 className="font-semibold">Add domain</h2>
					<p className="text-sm text-kumo-subtle mt-1">
						Register a tenant domain and its mail host.
					</p>
				</div>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
					<Input label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
					<Input label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" />
					<Button
						loading={saving}
						disabled={!domain || !host}
						onClick={async () => {
							setError(null);
							setSaving(true);
							try {
								await api.createAdminDomain(domain, host);
								setDomain("");
								setHost("");
								refetch();
							} catch (e) {
								setError(e instanceof Error ? e.message : "Failed to add domain");
							} finally {
								setSaving(false);
							}
						}}
					>
						Save
					</Button>
				</div>
			</div>
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
				<h2 className="font-semibold mb-3">Configured domains</h2>
				{isLoading ? (
					<p className="text-sm text-kumo-subtle">Loading…</p>
				) : data.length === 0 ? (
					<p className="text-sm text-kumo-subtle">No domains yet.</p>
				) : (
					data.map((row) => (
						<div key={row.domain} className="flex justify-between gap-4 py-2.5 border-b border-kumo-line last:border-0">
							<span className="text-sm font-medium">{row.domain}</span>
							<span className="text-sm text-kumo-subtle">{row.host}</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
