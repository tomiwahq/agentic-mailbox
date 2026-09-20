// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import { rewriteEmailLinks, rewriteRemoteImages } from "~/lib/utils";

interface EmailIframeProps {
	body: string;
	mailboxId?: string;
	loadRemoteImages?: boolean;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`
 *   for auto-sizing. Instead, the injected HTML includes a tiny inline
 *   script that posts its body height to the parent via `postMessage`.
 *   The `allow-scripts` flag is required for this, but scripts inside
 *   the opaque-origin sandbox cannot access anything useful.
 * - A strict CSP meta tag blocks external resource loads inside the
 *   iframe as a defense-in-depth layer.
 */
export default function EmailIframe({ body, mailboxId, loadRemoteImages = true, autoSize }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);

	// Listen for height reports from the sandboxed iframe
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeHeight &&
				typeof event.data.height === "number" &&
				event.data.height > 0
			) {
				setHeight(event.data.height);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	const blobUrlsRef = useRef<string[]>([]);

	useEffect(() => {
		let cancelled = false;
		const iframe = iframeRef.current;
		if (!iframe || !body) return;

		// Clean up any previously created blob URLs
		for (const u of blobUrlsRef.current) {
			URL.revokeObjectURL(u);
		}
		blobUrlsRef.current = [];

		async function renderContent() {
			let prepared = rewriteRemoteImages(body, mailboxId || "", loadRemoteImages);

			const apiMatches = prepared.match(
				/\/api\/v1\/(?:mailboxes\/[^"'\s)]+\/(?:emails\/[^"'\s)]+\/attachments\/[^"'?\s)]+|proxy-image\?url=[^"'\s)]+)|proxy-image\?url=[^"'\s)]+)/g,
			);

			if (apiMatches && apiMatches.length > 0) {
				const uniqueUrls = Array.from(new Set(apiMatches));
				const replacements = await Promise.all(
					uniqueUrls.map(async (url) => {
						try {
							const res = await fetch(url);
							if (res.ok) {
								const blob = await res.blob();
								if (!blob.type.startsWith("image/") && !url.includes("/attachments/")) {
									throw new Error("not an image");
								}
								const blobUrl = URL.createObjectURL(blob);
								if (!cancelled) blobUrlsRef.current.push(blobUrl);
								return { url, next: blobUrl };
							}
						} catch {
							// fall through
						}
						if (url.includes("proxy-image?url=")) {
							try {
								const original = new URL(url, window.location.origin).searchParams.get("url");
								if (original) return { url, next: original };
							} catch {
								// keep proxy url
							}
						}
						return { url, next: url };
					}),
				);

				if (cancelled) return;

				for (const { url, next } of replacements) {
					if (url !== next) prepared = prepared.replaceAll(url, next);
				}
			}

			const cleanBody = rewriteEmailLinks(
				DOMPurify.sanitize(prepared, {
					USE_PROFILES: { html: true },
					ADD_ATTR: ["target", "rel", "srcset"],
					FORCE_BODY: true,
				}),
			);

			const padding = autoSize ? "0" : "24px";
			const origin = typeof window !== "undefined" ? window.location.origin : "";

			const imgSources = loadRemoteImages
				? `data: blob: cid: ${origin} https: http: 'self'`
				: `data: blob: cid: ${origin} 'self'`;

			const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSources}; script-src 'unsafe-inline';`;

			// Height-reporting script: sends body.scrollHeight to the parent.
			// Runs inside the opaque-origin sandbox so it has zero access to
			// the parent page — it can only postMessage.
			const heightScript = `<script>
					document.addEventListener("click", function (event) {
						var link = event.target && event.target.closest ? event.target.closest("a") : null;
						if (!link || !link.href) return;
						link.setAttribute("target", "_blank");
						link.setAttribute("rel", "noopener noreferrer");
					}, true);
					${autoSize ? `function reportHeight() {
						var h = document.body.scrollHeight;
						if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
					}
					reportHeight();
					setTimeout(reportHeight, 50);
					setTimeout(reportHeight, 150);
					setTimeout(reportHeight, 400);
					window.addEventListener("load", reportHeight);` : ""}
				<\/script>`;

			if (iframe && !cancelled) {
				iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
* { box-sizing: border-box; }
html {
	background: #ffffff;
	color-scheme: light;
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.6;
	color: #1a1a1a;
	background: #ffffff;
	padding: ${padding};
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote {
	border-left: 3px solid #d1d5db;
	padding-left: 1em;
	margin-left: 0;
	color: #6b7280;
}
pre {
	background: #f3f4f6;
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
</style>
</head>
<body>${cleanBody}${heightScript}</body>
</html>`;
			}
		}

		void renderContent();

		return () => {
			cancelled = true;
			for (const u of blobUrlsRef.current) {
				URL.revokeObjectURL(u);
			}
			blobUrlsRef.current = [];
		};
	}, [body, autoSize, mailboxId, loadRemoteImages]);

	return (
		<iframe
			ref={iframeRef}
			className="block w-full border-0"
			style={autoSize ? { height: `${height}px` } : { height: "100%" }}
			sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
			title="Email content"
		/>
	);
}
