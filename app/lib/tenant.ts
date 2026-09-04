export function tenantDomainFromHost(hostname = typeof window !== "undefined" ? window.location.hostname : "") {
	const host = hostname.split(":")[0].trim().toLowerCase();
	if (host.startsWith("mail.")) return host.slice(5);
	return host;
}

export function mailboxInboxPath(email: string) {
	return `/mailbox/${email}/emails/inbox`;
}
