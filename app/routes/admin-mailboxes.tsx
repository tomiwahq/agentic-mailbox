import { Button, Input, Text } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";

export default function AdminMailboxesRoute() {
	const [localPart, setLocalPart] = useState("");
	const [domain, setDomain] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.adminListUsers() });
	const mailboxes = useQuery({ queryKey: ["admin-mailboxes"], queryFn: () => api.adminListMailboxes() });

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4 space-y-2">
				<h2 className="font-semibold">Create mailbox user</h2>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<div className="grid md:grid-cols-4 gap-2">
					<Input label="Local part" value={localPart} onChange={(e) => setLocalPart(e.target.value)} />
					<Input label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
					<Input type="password" label="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
					<Button onClick={async () => {
						setError(null);
						try {
							await api.createUser(localPart, domain, password);
							await users.refetch();
						} catch (e) {
							setError(e instanceof Error ? e.message : "Failed to create user");
						}
					}}>Create</Button>
				</div>
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4">
				<h2 className="font-semibold mb-2">Mailbox users</h2>
				{(users.data || []).map((u) => (
					<div key={u.id} className="flex items-center justify-between py-2 border-b border-kumo-line last:border-0">
						<div>
							<div>{u.email}</div>
							<div className="text-xs text-kumo-subtle">{u.is_active ? "Active" : "Locked"}</div>
						</div>
						<div className="flex gap-2">
							{u.is_active ? (
								<Button size="sm" variant="secondary" onClick={async () => { await api.lockUser(u.id); users.refetch(); }}>Lock</Button>
							) : (
								<Button size="sm" variant="secondary" onClick={async () => { await api.unlockUser(u.id); users.refetch(); }}>Unlock</Button>
							)}
						</div>
					</div>
				))}
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-4">
				<h2 className="font-semibold mb-2">All mailboxes</h2>
				{(mailboxes.data || []).map((m) => (
					<div key={m.id} className="py-2 border-b border-kumo-line last:border-0">{m.id}</div>
				))}
			</div>
		</div>
	);
}
