import { Button } from "@cloudflare/kumo";
import { Outlet, Link, useNavigate } from "react-router";
import api from "~/services/api";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export default function AdminLayoutRoute() {
	const navigate = useNavigate();
	const { data, isLoading } = useQuery({ queryKey: ["session"], queryFn: () => api.getSession() });
	useEffect(() => {
		if (isLoading) return;
		if (!data?.authenticated || data.principal?.realm !== "admin") navigate("/admin/login", { replace: true });
	}, [data, isLoading, navigate]);
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-6xl px-6 py-6">
				<div className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-4">
						<h1 className="text-xl font-semibold">Admin Console</h1>
						<nav className="flex gap-3 text-sm">
							<Link to="/admin">Overview</Link>
							<Link to="/admin/domains">Domains</Link>
							<Link to="/admin/mailboxes">Mailboxes</Link>
						</nav>
					</div>
					<Button variant="secondary" onClick={async () => {
						await api.logout();
						navigate("/admin/login");
					}}>Logout</Button>
				</div>
				<Outlet />
			</div>
		</div>
	);
}
