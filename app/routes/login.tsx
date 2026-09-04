import { Button, Input, Text, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import { mailboxInboxPath, tenantDomainFromHost } from "~/lib/tenant";
import { queryKeys } from "~/queries/keys";
import { useSession } from "~/queries/session";
import api from "~/services/api";
import { useQueryClient } from "@tanstack/react-query";

export default function LoginRoute() {
	const [localPart, setLocalPart] = useState("");
	const [password, setPassword] = useState("");
	const [domain, setDomain] = useState(() => tenantDomainFromHost());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();
	const toast = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: session } = useSession();

	useEffect(() => {
		if (!session) return;
		if (session.tenant.kind === "admin") {
			navigate(session.authenticated ? "/admin" : "/admin/login", { replace: true });
			return;
		}
		if (session.tenant.kind === "domain" && session.tenant.domain) {
			setDomain(session.tenant.domain);
		}
		if (session.authenticated && session.principal?.email) {
			navigate(mailboxInboxPath(session.principal.email), { replace: true });
		}
	}, [session, navigate]);

	async function goToInbox(email?: string) {
		await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
		navigate(mailboxInboxPath(email || `${localPart}@${domain}`), { replace: true });
	}

	async function loginWithPassword() {
		setLoading(true);
		setError(null);
		try {
			const result = await api.loginUserPassword(localPart, password);
			toast.add({ title: "Signed in" });
			await goToInbox(result.email);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to login");
		} finally {
			setLoading(false);
		}
	}

	async function loginWithPasskey() {
		setLoading(true);
		setError(null);
		try {
			const start = await api.startPasskeyLogin({ realm: "user", localPart });
			const response = await startAuthentication({ optionsJSON: start.options as any });
			const result = await api.verifyPasskeyLogin({ realm: "user", accountId: start.accountId, response });
			toast.add({ title: "Signed in" });
			await goToInbox(result.email);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Passkey login failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-kumo-recessed px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-5">
				<div>
					<h1 className="text-xl font-semibold text-kumo-default">Sign in</h1>
					<Text size="sm" className="mt-1">
						Use your mailbox on this domain.
					</Text>
				</div>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						void loginWithPassword();
					}}
				>
					<div>
						<span className="text-sm font-medium text-kumo-default mb-1.5 block">Email</span>
						<div className="flex items-stretch rounded-lg border border-kumo-line bg-kumo-base overflow-hidden focus-within:ring-1 focus-within:ring-kumo-ring">
							<input
								value={localPart}
								onChange={(e) => setLocalPart(e.target.value)}
								placeholder="name"
								autoComplete="username"
								autoCapitalize="none"
								spellCheck={false}
								className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-kumo-default outline-none"
								aria-label="Email local part"
							/>
							<span className="shrink-0 flex items-center px-3 border-l border-kumo-line bg-kumo-recessed text-sm text-kumo-subtle">
								@{domain || "domain"}
							</span>
						</div>
					</div>
					<Input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						label="Password"
						autoComplete="current-password"
					/>
					<div className="flex flex-col gap-2 pt-1">
						<Button type="submit" loading={loading} disabled={!localPart || !password}>
							Sign in
						</Button>
						<Button
							type="button"
							variant="secondary"
							loading={loading}
							disabled={!localPart}
							onClick={() => void loginWithPasskey()}
						>
							Sign in with passkey
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
