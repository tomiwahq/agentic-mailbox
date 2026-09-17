import { Badge, Button, Input, Loader } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, PlusIcon, TrayIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { mailboxInboxPath } from "~/lib/tenant";
import { useConfig } from "~/queries/session";
import api from "~/services/api";

export default function AdminInboxesRoute() {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const [selectedDomain, setSelectedDomain] = useState<string>("all");

	const { data: config } = useConfig();
	const domains = config?.domains ?? [];

	const mailboxesQuery = useQuery({
		queryKey: ["admin-mailboxes"],
		queryFn: () => api.adminListMailboxes(),
	});

	const usersQuery = useQuery({
		queryKey: ["admin-users"],
		queryFn: () => api.adminListUsers(),
	});

	const isLoading = mailboxesQuery.isLoading || usersQuery.isLoading;

	// Merge mailboxes and users to ensure complete list
	const allMailboxes = useMemo(() => {
		const map = new Map<string, { id: string; email: string; name?: string; isActive?: boolean }>();

		const mailboxItems = Array.isArray(mailboxesQuery.data) ? mailboxesQuery.data : [];
		for (const m of mailboxItems) {
			const raw = m?.email || m?.id;
			if (!raw) continue;
			const email = String(raw).toLowerCase();
			map.set(email, { id: email, email, name: m.name || email, isActive: true });
		}

		const userItems = Array.isArray(usersQuery.data) ? usersQuery.data : [];
		for (const u of userItems) {
			if (!u?.email) continue;
			const email = String(u.email).toLowerCase();
			const existing = map.get(email);
			if (existing) {
				existing.isActive = u.is_active;
			} else {
				map.set(email, { id: email, email, name: u.local_part || email, isActive: u.is_active });
			}
		}

		return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
	}, [mailboxesQuery.data, usersQuery.data]);

	const filteredMailboxes = useMemo(() => {
		return allMailboxes.filter((m) => {
			if (!m?.email) return false;
			const matchesDomain =
				selectedDomain === "all" || m.email.endsWith(`@${selectedDomain}`);
			const matchesSearch =
				!search.trim() ||
				m.email.toLowerCase().includes(search.toLowerCase()) ||
				(m.name && m.name.toLowerCase().includes(search.toLowerCase()));
			return matchesDomain && matchesSearch;
		});
	}, [allMailboxes, selectedDomain, search]);

	if (isLoading) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header & Actions */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h2 className="text-xl font-semibold text-kumo-default">All Inboxes</h2>
					<p className="text-sm text-kumo-subtle mt-0.5">
						Access and manage any mailbox in the system with super admin privileges.
					</p>
				</div>
				<Button
					variant="secondary"
					icon={<PlusIcon size={16} />}
					onClick={() => navigate("/admin/mailboxes")}
				>
					Create Mailbox
				</Button>
			</div>

			{/* Filters & Search */}
			<div className="flex flex-col sm:flex-row gap-3">
				<div className="flex-1 relative">
					<Input
						placeholder="Search inboxes by name or email address..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full"
					/>
				</div>

				{domains.length > 1 && (
					<div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
						<button
							type="button"
							onClick={() => setSelectedDomain("all")}
							className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors border ${
								selectedDomain === "all"
									? "bg-kumo-fill text-kumo-default border-kumo-line font-semibold"
									: "bg-kumo-base text-kumo-subtle border-kumo-line hover:text-kumo-default"
							}`}
						>
							All ({allMailboxes.length})
						</button>
						{domains.map((d) => {
							const count = allMailboxes.filter((m) => m.email.endsWith(`@${d}`)).length;
							return (
								<button
									key={d}
									type="button"
									onClick={() => setSelectedDomain(d)}
									className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors border shrink-0 ${
										selectedDomain === d
											? "bg-kumo-fill text-kumo-default border-kumo-line font-semibold"
											: "bg-kumo-base text-kumo-subtle border-kumo-line hover:text-kumo-default"
									}`}
								>
									{d} ({count})
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Inboxes Grid */}
			{filteredMailboxes.length > 0 ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filteredMailboxes.map((mailbox) => {
						const domainPart = mailbox.email.split("@")[1] || "";
						return (
							<div
								key={mailbox.id}
								className="rounded-xl border border-kumo-line bg-kumo-base p-5 flex flex-col justify-between hover:border-kumo-contrast transition-colors shadow-xs"
							>
								<div className="flex items-start gap-3.5 mb-4">
									<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-kumo-fill text-base font-bold text-kumo-default">
										{(mailbox.name || mailbox.email).charAt(0).toUpperCase()}
									</div>
									<div className="min-w-0 flex-1">
										<div className="text-base font-medium text-kumo-default truncate">
											{mailbox.name && mailbox.name !== mailbox.email
												? mailbox.name
												: mailbox.email.split("@")[0]}
										</div>
										<div className="text-sm text-kumo-subtle truncate">{mailbox.email}</div>
										<div className="mt-2 flex items-center gap-2">
											<span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-kumo-recessed text-kumo-subtle border border-kumo-line">
												@{domainPart}
											</span>
											{mailbox.isActive === false && (
												<Badge variant="secondary">Locked</Badge>
											)}
										</div>
									</div>
								</div>

								<Button
									variant="primary"
									icon={<ArrowSquareOutIcon size={16} />}
									className="w-full mt-2"
									onClick={() => navigate(mailboxInboxPath(mailbox.email))}
								>
									Open Inbox
								</Button>
							</div>
						);
					})}
				</div>
			) : (
				<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6 text-center">
					<TrayIcon size={44} weight="thin" className="text-kumo-subtle mx-auto mb-3" />
					<h3 className="text-base font-semibold text-kumo-default mb-1">
						{search ? "No matching mailboxes" : "No mailboxes created yet"}
					</h3>
					<p className="text-sm text-kumo-subtle max-w-sm mx-auto mb-5">
						{search
							? `No mailboxes matched "${search}". Try checking the spelling or resetting filters.`
							: "Create your first mailbox user to start sending and receiving emails."}
					</p>
					{search ? (
						<Button variant="secondary" onClick={() => { setSearch(""); setSelectedDomain("all"); }}>
							Clear search filters
						</Button>
					) : (
						<Button
							variant="primary"
							icon={<PlusIcon size={16} />}
							onClick={() => navigate("/admin/mailboxes")}
						>
							Create mailbox
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
