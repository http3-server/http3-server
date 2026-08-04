// @ts-check

import { existsSync, readFileSync } from "node:fs";

export function netLogDiagnostics(path) {
	if (!existsSync(path)) return "Chrome did not write a NetLog";
	let log;
	try {
		const contents = readFileSync(path, "utf8");
		if (!contents.trim()) return "Chrome wrote an empty NetLog";
		log = JSON.parse(contents);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return `Chrome wrote an unreadable NetLog: ${detail}`;
	}
	const logEvents = Array.isArray(log.events) ? log.events : [];
	const eventNames = new Map(
		Object.entries(log.constants?.logEventTypes ?? {}).map(([name, id]) => [id, name])
	);
	const failedSources = new Set(
		logEvents
			.filter((event) => {
				const name = eventNames.get(event.type) ?? "";
				return (
					/WEBTRANSPORT_CLIENT_STATE_CHANGED/.test(name) &&
					event.params?.next_state === "FAILED"
				);
			})
			.map((event) => event.source?.id)
	);
	const clientHelloStrings = logEvents
		.filter(
			(event) =>
				failedSources.has(event.source?.id) &&
				eventNames.get(event.type) === "QUIC_SESSION_CRYPTO_FRAME_SENT" &&
				event.params?.encryption_level === "ENCRYPTION_INITIAL" &&
				event.params?.bytes
		)
		.flatMap(
			(event) =>
				Buffer.from(event.params.bytes, "base64")
					.toString("latin1")
					.match(/[ -~]{2,}/g) ?? []
		)
		.join(" | ");
	const events = logEvents
		.map((event) => ({
			name: eventNames.get(event.type) ?? String(event.type),
			params: event.params,
			source: event.source?.id,
		}))
		.filter(({ name, params, source }) => {
			const details = JSON.stringify(params ?? {});
			return (
				(failedSources.has(source) &&
					!/(PACKET|FRAME|ACK|CONGESTION|LOSS|WINDOW|MTU)/i.test(name)) ||
				name === "QUIC_SESSION" ||
				(/(QUIC|WEB_TRANSPORT|WEBTRANSPORT)/i.test(name) &&
					!/(CRYPTO_FRAME|PACKET|COALESCED|UNAUTHENTICATED)/i.test(name) &&
					/(created|error|fail|close|transport_parameter|settings|handshake|version)/i.test(
						`${name} ${details}`
					))
			);
		})
		.slice(-120)
		.map(({ name, params, source }) => `[${source}] ${name} ${JSON.stringify(params ?? {})}`)
		.join("\n");
	return `${events}\nClientHello strings: ${clientHelloStrings}`;
}
