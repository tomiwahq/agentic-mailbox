import { Button, Input, Text } from "@cloudflare/kumo";
import { useState } from "react";
import { useNavigate } from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import api from "~/services/api";

export default function AdminLoginRoute() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [bootstrapEmail, setBootstrapEmail] = useState("");
	const [bootstrapPassword, setBootstrapPassword] = useState("");
	const [bootstrapSecret, setBootstrapSecret] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function loginPassword() {
		setLoading(true);
		setError(null);
		try {
			await api.loginAdminPassword(email, password);
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
			navigate("/admin", { replace: true });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Passkey login failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-kumo-recessed px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4">
				<h1 className="text-xl font-semibold">Admin sign in</h1>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<Input label="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} />
				<Input type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
				<div className="flex gap-2">
					<Button loading={loading} onClick={loginPassword}>Sign in</Button>
					<Button variant="secondary" loading={loading} onClick={loginPasskey}>Passkey</Button>
				</div>
				<div className="pt-4 border-t border-kumo-line space-y-2">
					<Text size="sm">First-time setup</Text>
					<Input label="Bootstrap email" value={bootstrapEmail} onChange={(e) => setBootstrapEmail(e.target.value)} />
					<Input type="password" label="Bootstrap password" value={bootstrapPassword} onChange={(e) => setBootstrapPassword(e.target.value)} />
					<Input type="password" label="Bootstrap secret" value={bootstrapSecret} onChange={(e) => setBootstrapSecret(e.target.value)} />
					<Button variant="ghost" onClick={async () => {
						setError(null);
						try {
							await api.bootstrapAdmin(bootstrapEmail, bootstrapPassword, bootstrapSecret);
						} catch (e) {
							setError(e instanceof Error ? e.message : "Bootstrap failed");
						}
					}}>Create first admin</Button>
				</div>
			</div>
		</div>
	);
}
