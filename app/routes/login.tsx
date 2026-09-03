import { Button, Input, Text, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import api from "~/services/api";

export default function LoginRoute() {
	const [localPart, setLocalPart] = useState("");
	const [password, setPassword] = useState("");
	const [domain, setDomain] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();
	const toast = useKumoToastManager();

	useEffect(() => {
		api.getSession().then((session) => {
			if (session.tenant.kind === "domain" && session.tenant.domain) setDomain(session.tenant.domain);
			if (session.authenticated) navigate("/", { replace: true });
		});
	}, [navigate]);

	async function loginWithPassword() {
		setLoading(true);
		setError(null);
		try {
			await api.loginUserPassword(localPart, password);
			navigate("/", { replace: true });
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
			await api.verifyPasskeyLogin({ realm: "user", accountId: start.accountId, response });
			navigate("/", { replace: true });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Passkey login failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-kumo-recessed px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4">
				<h1 className="text-xl font-semibold">Sign in</h1>
				<Text size="sm">Use your mailbox account for this domain.</Text>
				{error && <Text variant="error" size="sm">{error}</Text>}
				<div className="flex items-center gap-2">
					<Input value={localPart} onChange={(e) => setLocalPart(e.target.value)} placeholder="name" label="Email" />
					<Text>@{domain || "domain"}</Text>
				</div>
				<Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} label="Password" />
				<div className="flex gap-2">
					<Button loading={loading} onClick={loginWithPassword}>Sign in</Button>
					<Button variant="secondary" loading={loading} onClick={loginWithPasskey}>Passkey</Button>
					<Button variant="ghost" onClick={async () => {
						try {
							const options = await api.startPasskeyRegistration();
							const response = await (await import("@simplewebauthn/browser")).startRegistration({ optionsJSON: options as any });
							await api.verifyPasskeyRegistration(response);
							toast.add({ title: "Passkey added" });
						} catch (e) {
							setError(e instanceof Error ? e.message : "Passkey registration failed");
						}
					}}>Enroll passkey</Button>
				</div>
			</div>
		</div>
	);
}
