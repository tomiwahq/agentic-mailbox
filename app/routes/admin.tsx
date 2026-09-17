import { Button } from "@cloudflare/kumo";
import { TrayIcon } from "@phosphor-icons/react";
import { Outlet, NavLink, useNavigate } from "react-router";
import api from "~/services/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSession } from "~/queries/session";

const NAV = [
	{ to: "/admin", label: "Overview", end: true },
	{ to: "/admin/inboxes", label: "Inboxes" },
	{ to: "/admin/mailboxes", label: "Mailboxes & Users" },
	{ to: "/admin/domains", label: "Domains" },
];

export default function AdminLayoutRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data, isLoading } = useSession();
	useEffect(() => {
		if (isLoading) return;
		if (!data?.authenticated || data.principal?.realm !== "admin") navigate("/admin/login", { replace: true });
	}, [data, isLoading, navigate]);
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-6">
					<div className="flex flex-wrap items-center gap-6">
						<h1 className="text-xl font-semibold">Admin Console</h1>
						<nav className="flex gap-1 text-sm">
							{NAV.map((item) => (
								<NavLink
									key={item.to}
									to={item.to}
									end={item.end}
									className={({ isActive }) =>
										`px-3 py-1.5 rounded-md no-underline ${
											isActive
												? "bg-kumo-fill font-semibold text-kumo-default"
												: "text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
										}`
									}
								>
									{item.label}
								</NavLink>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							icon={<TrayIcon size={16} />}
							onClick={() => navigate("/admin/inboxes")}
						>
							Open Inboxes
						</Button>
						<Button variant="secondary" onClick={async () => {
							await api.logout();
							queryClient.clear();
							navigate("/admin/login", { replace: true });
						}}>Logout</Button>
					</div>
				</div>
				<Outlet />
			</div>
		</div>
	);
}
