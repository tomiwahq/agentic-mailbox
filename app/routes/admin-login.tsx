import { Button, Input, Text, useKumoToastManager } from "@cloudflare/kumo";
import { useState } from "react";
import { useNavigate } from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminLoginRoute() {
	const navigate = useNavigate();
	const toast = useKumoToastManager();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [bootstrapEmail, setBootstrapEmail] = useState("");
	const [bootstrapPassword, setBootstrapPassword] = useState("");
	const [bootstrapSecret, setBootstrapSecret] = useState("");
	const [loading, setLoading] = useState(false);
	const [bootstrapping, setBootstrapping] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function loginPassword() {
		setLoading(true);
		setError(null);
		try {
			await api.loginAdminPassword(email, password);
			await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
			navigate("/admin", { replace: true });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to login");
		} finally {
			setLoading(false);
		}
	}

	async function loginPasskey() {
		setLoading(true);
		setError(null);
		try {
			const start = await api.startPasskeyLogin({ realm: "admin", adminEmail: email });
			const response = await startAuthentication({ optionsJSON: start.options as any });
			await api.verifyPasskeyLogin({ realm: "admin", accountId: start.accountId, response });
			await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
			navigate("/admin", { replace: true });
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
					<h1 className="text-xl font-semibold">Admin sign in</h1>
					<p className="text-sm text-kumo-subtle mt-1">Manage domains and mailbox users.</p>
				</div>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						void loginPassword();
					}}
				>
					<Input label="Admin email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
					<Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
					<div className="flex flex-col gap-2">
						<Button type="submit" loading={loading} disabled={!email || !password}>Sign in</Button>
						<Button type="button" variant="secondary" loading={loading} disabled={!email} onClick={() => void loginPasskey()}>
							Sign in with passkey
						</Button>
					</div>
				</form>
				<div className="pt-4 border-t border-kumo-line space-y-3">
					<div>
						<h2 className="text-sm font-semibold">First-time setup</h2>
						<Text size="sm">Use the bootstrap secret from your Worker environment.</Text>
					</div>
					<Input label="Bootstrap email" type="email" value={bootstrapEmail} onChange={(e) => setBootstrapEmail(e.target.value)} />
					<Input type="password" label="Bootstrap password (min 12)" value={bootstrapPassword} onChange={(e) => setBootstrapPassword(e.target.value)} />
					<Input type="password" label="Bootstrap secret" value={bootstrapSecret} onChange={(e) => setBootstrapSecret(e.target.value)} />
					<Button
						variant="ghost"
						loading={bootstrapping}
						onClick={async () => {
							setError(null);
							setBootstrapping(true);
							try {
								await api.bootstrapAdmin(bootstrapEmail, bootstrapPassword, bootstrapSecret);
								setEmail(bootstrapEmail);
								setPassword("");
								setBootstrapPassword("");
								setBootstrapSecret("");
								toast.add({ title: "Admin created. Sign in above." });
							} catch (e) {
								setError(e instanceof Error ? e.message : "Bootstrap failed");
							} finally {
								setBootstrapping(false);
							}
						}}
					>
						Create first admin
					</Button>
				</div>
			</div>
		</div>
	);
}
