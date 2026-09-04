import { Button, Input, Select, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useConfig } from "~/queries/session";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

export default function AdminMailboxesRoute() {
	const [localPart, setLocalPart] = useState("");
	const [domain, setDomain] = useState("");
	const [password, setPassword] = useState("");
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { data: config } = useConfig();
	const domains = config?.domains ?? [];
	const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.adminListUsers() });
	const mailboxes = useQuery({ queryKey: ["admin-mailboxes"], queryFn: () => api.adminListMailboxes() });

	useEffect(() => {
		if (domains.length > 0 && !domain) setDomain(domains[0]);
	}, [domains, domain]);

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
				<div>
					<h2 className="font-semibold text-kumo-default">Create mailbox user</h2>
					<p className="text-sm text-kumo-subtle mt-1">
						Creates a login and inbox for one configured domain.
					</p>
				</div>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
					<Input
						label="Local part"
						value={localPart}
						onChange={(e) => setLocalPart(e.target.value)}
						placeholder="name"
					/>
					<div>
						<span className="text-sm font-medium text-kumo-default mb-1.5 block">Domain</span>
						{domains.length > 0 ? (
							<Select
								aria-label="Domain"
								value={domain}
								onValueChange={(value) => {
									if (value) setDomain(value);
								}}
							>
								{domains.map((d) => (
									<Select.Option key={d} value={d}>
										{d}
									</Select.Option>
								))}
							</Select>
						) : (
							<Input value={domain} disabled placeholder="No domains configured" />
						)}
					</div>
					<Input
						type="password"
						label="Password (min 8 characters)"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
					<Button
						loading={creating}
						disabled={!localPart || !domain || password.length < 8}
						onClick={async () => {
							setError(null);
							setCreating(true);
							try {
								await api.createUser(localPart, domain, password);
								setLocalPart("");
								setPassword("");
								await Promise.all([users.refetch(), mailboxes.refetch()]);
							} catch (e) {
								setError(e instanceof Error ? e.message : "Failed to create user");
							} finally {
								setCreating(false);
							}
						}}
					>
						Create
					</Button>
				</div>
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
				<h2 className="font-semibold mb-3">Mailbox users</h2>
				{(users.data || []).length === 0 ? (
					<p className="text-sm text-kumo-subtle">No users yet.</p>
				) : (
					(users.data || []).map((u) => (
						<div key={u.id} className="flex items-center justify-between gap-4 py-3 border-b border-kumo-line last:border-0">
							<div className="min-w-0">
								<div className="text-sm font-medium truncate">{u.email}</div>
								<div className="text-xs text-kumo-subtle">{u.is_active ? "Active" : "Locked"}</div>
							</div>
							<div className="flex gap-2 shrink-0">
								{u.is_active ? (
									<Button size="sm" variant="secondary" onClick={async () => { await api.lockUser(u.id); users.refetch(); }}>Lock</Button>
								) : (
									<Button size="sm" variant="secondary" onClick={async () => { await api.unlockUser(u.id); users.refetch(); }}>Unlock</Button>
								)}
							</div>
						</div>
					))
				)}
			</div>

			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
				<h2 className="font-semibold mb-3">All mailboxes</h2>
				{(mailboxes.data || []).length === 0 ? (
					<p className="text-sm text-kumo-subtle">No mailbox files yet.</p>
				) : (
					(mailboxes.data || []).map((m) => (
						<div key={m.id} className="py-2 text-sm border-b border-kumo-line last:border-0">{m.id}</div>
					))
				)}
			</div>
		</div>
	);
}
