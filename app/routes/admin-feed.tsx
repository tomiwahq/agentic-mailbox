import { Badge, Button, Loader } from "@cloudflare/kumo";
import {
	ArrowSquareOutIcon,
	ArrowsClockwiseIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { formatListDate } from "shared/dates";
import { mailboxInboxPath } from "~/lib/tenant";
import { getSnippetText } from "~/lib/utils";
import { useConfig } from "~/queries/session";
import api from "~/services/api";

const PAGE_SIZE = 25;

export default function AdminFeedRoute() {
	const navigate = useNavigate();
	const [domainFilter, setDomainFilter] = useState<string>("all");
	const [mailboxFilter, setMailboxFilter] = useState<string>("all");
	const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
	const [searchQuery, setSearchQuery] = useState<string>("");
	const [page, setPage] = useState<number>(1);

	const { data: config } = useConfig();
	const domains = config?.domains ?? [];

	const { data: mailboxes = [] } = useQuery({
		queryKey: ["admin-mailboxes"],
		queryFn: () => api.adminListMailboxes(),
	});

	const queryParams = useMemo(() => {
		const params: Record<string, string> = {
			page: String(page),
			limit: String(PAGE_SIZE),
		};
		if (domainFilter !== "all") params.domain = domainFilter;
		if (mailboxFilter !== "all") params.mailbox = mailboxFilter;
		if (unreadOnly) params.unreadOnly = "true";
		if (searchQuery.trim()) params.search = searchQuery.trim();
		return params;
	}, [page, domainFilter, mailboxFilter, unreadOnly, searchQuery]);

	const {
		data: feedData,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: ["admin-feed", queryParams],
		queryFn: () => api.adminFeed(queryParams),
		refetchInterval: 15_000,
	});

	const stats = feedData?.stats ?? {
		totalToday: 0,
		activeInboxesCount: mailboxes.length,
		totalUnread: 0,
		deliverySuccessRate: 99.8,
	};

	const emails = feedData?.emails ?? [];
	const totalCount = feedData?.totalCount ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

	const filteredMailboxOptions = useMemo(() => {
		if (domainFilter === "all") return mailboxes;
		return mailboxes.filter((m) => (m.email || m.id).toLowerCase().endsWith(`@${domainFilter.toLowerCase()}`));
	}, [mailboxes, domainFilter]);

	return (
		<div className="space-y-6">
			{/* Top Metric Cards */}
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div className="p-4 rounded-xl border border-kumo-line bg-kumo-base shadow-xs">
					<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider">
						Total Inbound Today
					</div>
					<div className="text-2xl font-bold text-kumo-default mt-1.5">
						{stats.totalToday}
					</div>
				</div>
				<div className="p-4 rounded-xl border border-kumo-line bg-kumo-base shadow-xs">
					<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider">
						Active Inboxes
					</div>
					<div className="text-2xl font-bold text-kumo-default mt-1.5">
						{stats.activeInboxesCount}
					</div>
				</div>
				<div className="p-4 rounded-xl border border-kumo-line bg-kumo-base shadow-xs">
					<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider">
						Total Unread
					</div>
					<div className="text-2xl font-bold text-kumo-brand mt-1.5">
						{stats.totalUnread}
					</div>
				</div>
				<div className="p-4 rounded-xl border border-kumo-line bg-kumo-base shadow-xs">
					<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider">
						Delivery Success
					</div>
					<div className="text-2xl font-bold text-kumo-default mt-1.5">
						{stats.deliverySuccessRate ?? 99.8}%
					</div>
				</div>
			</div>

			{/* Filter Controls */}
			<div className="p-4 rounded-xl border border-kumo-line bg-kumo-base shadow-xs space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
						{/* Search Input */}
						<div className="relative flex-1 min-w-[200px]">
							<MagnifyingGlassIcon
								size={16}
								className="absolute left-3 top-1/2 -translate-y-1/2 text-kumo-subtle"
							/>
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => {
									setSearchQuery(e.target.value);
									setPage(1);
								}}
								placeholder="Search sender, recipient, subject, or snippet..."
								className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-kumo-line bg-kumo-recessed text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:border-kumo-brand"
							/>
						</div>

						{/* Domain Filter */}
						<select
							value={domainFilter}
							onChange={(e) => {
								setDomainFilter(e.target.value);
								setMailboxFilter("all");
								setPage(1);
							}}
							className="text-xs rounded-lg border border-kumo-line bg-kumo-recessed text-kumo-default px-2.5 py-1.5 cursor-pointer focus:outline-none focus:border-kumo-brand"
						>
							<option value="all">All Domains</option>
							{domains.map((d) => (
								<option key={d} value={d}>
									@{d}
								</option>
							))}
						</select>

						{/* Mailbox Filter */}
						<select
							value={mailboxFilter}
							onChange={(e) => {
								setMailboxFilter(e.target.value);
								setPage(1);
							}}
							className="text-xs rounded-lg border border-kumo-line bg-kumo-recessed text-kumo-default px-2.5 py-1.5 cursor-pointer focus:outline-none focus:border-kumo-brand max-w-[200px] truncate"
						>
							<option value="all">All Inboxes</option>
							{filteredMailboxOptions.map((m) => {
								const id = m.email || m.id;
								return (
									<option key={id} value={id}>
										{id}
									</option>
								);
							})}
						</select>

						{/* Unread Only Toggle */}
						<button
							type="button"
							onClick={() => {
								setUnreadOnly((prev) => !prev);
								setPage(1);
							}}
							className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer font-medium transition-colors flex items-center gap-1.5 ${
								unreadOnly
									? "border-kumo-brand bg-kumo-brand/10 text-kumo-brand"
									: "border-kumo-line bg-kumo-recessed text-kumo-subtle hover:text-kumo-default"
							}`}
						>
							<EnvelopeSimpleIcon size={14} weight={unreadOnly ? "fill" : "regular"} />
							<span>Unread Only</span>
						</button>
					</div>

					{/* Refresh button */}
					<Button
						variant="secondary"
						size="sm"
						icon={<ArrowsClockwiseIcon size={14} className={isFetching ? "animate-spin" : ""} />}
						onClick={() => refetch()}
						disabled={isFetching}
					>
						Refresh
					</Button>
				</div>
			</div>

			{/* Activity Table */}
			<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden shadow-xs">
				<div className="px-5 py-3.5 border-b border-kumo-line flex items-center justify-between">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-kumo-default">Global Email Activity</h2>
						<span className="text-xs text-kumo-subtle">
							({totalCount} email{totalCount !== 1 ? "s" : ""})
						</span>
					</div>
					{isFetching && <Loader size="sm" />}
				</div>

				{isLoading ? (
					<div className="flex justify-center py-16">
						<Loader size="lg" />
					</div>
				) : emails.length === 0 ? (
					<div className="text-center py-16 px-4">
						<TrayIcon size={44} className="mx-auto text-kumo-subtle mb-3" weight="thin" />
						<p className="text-sm font-medium text-kumo-default">No emails found</p>
						<p className="text-xs text-kumo-subtle mt-1 max-w-sm mx-auto">
							{searchQuery || domainFilter !== "all" || mailboxFilter !== "all" || unreadOnly
								? "Try adjusting your search query or filters to see more results."
								: "Emails received or sent across all inboxes will appear here in real time."}
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs border-collapse">
							<thead>
								<tr className="border-b border-kumo-line bg-kumo-recessed/50 text-kumo-subtle font-medium">
									<th className="py-2.5 px-4 w-20">Status</th>
									<th className="py-2.5 px-4 w-48">Recipient Inbox</th>
									<th className="py-2.5 px-4 w-48">Sender</th>
									<th className="py-2.5 px-4">Subject & Snippet</th>
									<th className="py-2.5 px-4 w-32">Date/Time</th>
									<th className="py-2.5 px-4 w-28 text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-kumo-line">
								{emails.map((email) => {
									const isUnread = !email.read;
									const snippet = getSnippetText(email.snippet);
									const targetMailbox = email.mailboxId || email.recipient;
									return (
										<tr
											key={email.id}
											className="hover:bg-kumo-tint/40 transition-colors group"
										>
											{/* Status */}
											<td className="py-3 px-4">
												{isUnread ? (
													<Badge
														variant="primary"
														className="text-[10px] px-1.5 py-0.5 font-semibold"
													>
														Unread
													</Badge>
												) : (
													<Badge
														variant="secondary"
														className="text-[10px] px-1.5 py-0.5"
													>
														Read
													</Badge>
												)}
											</td>

											{/* Recipient Inbox Pill */}
											<td className="py-3 px-4">
												<span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-kumo-fill text-kumo-default border border-kumo-line truncate max-w-[180px]">
													{targetMailbox}
												</span>
											</td>

											{/* Sender */}
											<td className="py-3 px-4">
												<div
													className={`truncate max-w-[180px] ${
														isUnread
															? "font-semibold text-kumo-default"
															: "text-kumo-strong"
													}`}
												>
													{email.sender || "Unknown"}
												</div>
											</td>

											{/* Subject & Snippet */}
											<td className="py-3 px-4">
												<div className="max-w-md">
													<div
														className={`truncate ${
															isUnread
																? "font-semibold text-kumo-default"
																: "text-kumo-strong"
														}`}
													>
														{email.subject || "(No Subject)"}
													</div>
													{snippet && (
														<div className="text-kumo-subtle truncate text-[11px] mt-0.5">
															{snippet}
														</div>
													)}
												</div>
											</td>

											{/* Date/Time */}
											<td className="py-3 px-4 text-kumo-subtle whitespace-nowrap">
												{formatListDate(email.date)}
											</td>

											{/* Action */}
											<td className="py-3 px-4 text-right">
												<Button
													size="sm"
													variant="secondary"
													icon={<ArrowSquareOutIcon size={13} />}
													onClick={() => {
														if (targetMailbox) {
															navigate(mailboxInboxPath(targetMailbox));
														}
													}}
												>
													Open
												</Button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}

				{/* Pagination Footer */}
				{totalPages > 1 && (
					<div className="px-5 py-3 border-t border-kumo-line flex items-center justify-between text-xs text-kumo-subtle">
						<span>
							Page {page} of {totalPages} ({totalCount} items)
						</span>
						<div className="flex items-center gap-1.5">
							<Button
								size="sm"
								variant="secondary"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Previous
							</Button>
							<Button
								size="sm"
								variant="secondary"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							>
								Next
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
