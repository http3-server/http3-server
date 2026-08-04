#!/usr/bin/env node
// @ts-check

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDevelopmentCertificate } from "@http3-server/dev-certificates/node";
import { HTTP3Server } from "http3-server";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function withTimeout(promise, milliseconds, label) {
	let timeout;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timeout = setTimeout(() => {
				const description = typeof label === "function" ? label() : label;
				reject(new Error(`${description} timed out`));
			}, milliseconds);
		}),
	]).finally(() => clearTimeout(timeout));
}

function chromePath() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const candidates =
		process.platform === "darwin"
			? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
			: process.platform === "win32"
				? [
						`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
						`${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
					]
				: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
	const path = candidates.find((candidate) => candidate && existsSync(candidate));
	if (!path) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable");
	return path;
}

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Test page server has no port");
	return address.port;
}

async function launchChrome(path, userDataDirectory, netLogPath) {
	const ready = deferred();
	const browser = spawn(
		path,
		[
			"--headless=new",
			"--enable-logging=stderr",
			`--log-net-log=${netLogPath}`,
			"--net-log-capture-mode=Everything",
			"--vmodule=*quic*=2,*web_transport*=2,*webtransport*=2",
			"--remote-debugging-port=0",
			`--user-data-dir=${userDataDirectory}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-background-networking",
			...(process.platform === "linux" ? ["--no-sandbox"] : []),
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "pipe"] }
	);
	let stderr = "";
	browser.stderr.setEncoding("utf8");
	browser.stderr.on("data", (chunk) => {
		stderr += chunk;
		const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
		if (match) ready.resolve(match[1]);
	});
	browser.once("error", ready.reject);
	browser.once("exit", (code) => ready.reject(new Error(`Chrome exited ${code}: ${stderr}`)));
	const timeout = setTimeout(
		() => ready.reject(new Error(`Chrome DevTools timeout: ${stderr}`)),
		15_000
	);
	try {
		return { browser, getStderr: () => stderr, webSocketUrl: await ready.promise };
	} finally {
		clearTimeout(timeout);
	}
}

function netLogDiagnostics(path) {
	if (!existsSync(path)) return "Chrome did not write a NetLog";
	const log = JSON.parse(readFileSync(path, "utf8"));
	const eventNames = new Map(
		Object.entries(log.constants?.logEventTypes ?? {}).map(([name, id]) => [id, name])
	);
	const failedSources = new Set(
		log.events
			.filter((event) => {
				const name = eventNames.get(event.type) ?? "";
				return (
					/WEBTRANSPORT_CLIENT_STATE_CHANGED/.test(name) &&
					event.params?.next_state === "FAILED"
				);
			})
			.map((event) => event.source?.id)
	);
	const clientHelloStrings = log.events
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
	const events = log.events
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

async function stopChrome(browser) {
	if (!browser || browser.exitCode !== null) return;
	const exited = new Promise((resolve) => browser.once("exit", resolve));
	browser.kill("SIGTERM");
	const forced = setTimeout(() => browser.kill("SIGKILL"), 5_000);
	try {
		await exited;
	} finally {
		clearTimeout(forced);
	}
}

class DevTools {
	#id = 0;
	#pending = new Map();
	#socket;

	constructor(url) {
		this.#socket = new WebSocket(url);
		this.#socket.addEventListener("message", ({ data }) => {
			const message = JSON.parse(data);
			if (!message.id) return;
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			if (message.error) pending.reject(new Error(message.error.message));
			else pending.resolve(message.result);
		});
	}

	async open() {
		if (this.#socket.readyState === WebSocket.OPEN) return;
		await withTimeout(
			new Promise((resolve, reject) => {
				this.#socket.addEventListener("open", resolve, { once: true });
				this.#socket.addEventListener("error", reject, { once: true });
			}),
			10_000,
			"Chrome DevTools connection"
		);
	}

	call(method, params = {}, sessionId) {
		this.#id += 1;
		const id = this.#id;
		const pending = deferred();
		this.#pending.set(id, pending);
		this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
		return withTimeout(pending.promise, 10_000, `Chrome DevTools ${method}`).finally(() => {
			this.#pending.delete(id);
		});
	}

	close() {
		this.#socket.close();
	}
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "http3-browser-test-"));
const pageServer = createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html" });
	response.end("<!doctype html><title>WebTransport test</title>");
});
const server = new HTTP3Server();
let chrome;
let chromeStderr = () => "";
let devTools;

try {
	const { certificateFile, certificateHash, privateKeyFile } = await ensureDevelopmentCertificate(
		{ directory: join(temporaryDirectory, "certificate") }
	);
	const receivedDatagram = deferred();
	const receivedAbort = deferred();
	const receivedAbortData = deferred();
	const receivedStreamData = deferred();
	let sessions = 0;
	server.handle({
		session(session) {
			if (session.path === "/game/reject") return false;
			sessions += 1;
		},
		datagram(session, data) {
			assert.equal(new TextDecoder().decode(data), "client-datagram");
			receivedDatagram.resolve();
			session.sendDatagram(new TextEncoder().encode("server-datagram"));
		},
		webTransportData(stream, data) {
			const message = new TextDecoder().decode(data);
			if (stream.session.path === "/game/abort") {
				assert.equal(message, "abort");
				receivedAbortData.resolve();
				assert.equal(stream.send(new TextEncoder().encode("abort-received")), true);
			} else {
				assert.equal(message, "ping");
				receivedStreamData.resolve();
				assert.equal(stream.close(new TextEncoder().encode("pong")), true);
			}
		},
		webTransportStreamEnd(stream, reason) {
			if (stream.session.path === "/game/abort") {
				assert.equal(reason, "aborted");
				receivedAbort.resolve();
			}
		},
	});
	await server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile,
		privateKeyFile,
	});
	const pagePort = await listen(pageServer);
	const netLogPath = join(temporaryDirectory, "netlog.json");
	const launched = await launchChrome(
		chromePath(),
		join(temporaryDirectory, "chrome"),
		netLogPath
	);
	chrome = launched.browser;
	chromeStderr = launched.getStderr;
	devTools = new DevTools(launched.webSocketUrl);
	await devTools.open();
	const { targetId } = await devTools.call("Target.createTarget", {
		url: `http://localhost:${pagePort}`,
	});
	const { sessionId } = await devTools.call("Target.attachToTarget", { targetId, flatten: true });
	await devTools.call("Runtime.enable", {}, sessionId);
	await new Promise((resolve) => setTimeout(resolve, 200));

	const expression = `(async () => {
		if (!isSecureContext) throw new Error("browser test page is not a secure context");
		const options = { serverCertificateHashes: [{ algorithm: "sha-256", value: new Uint8Array(${JSON.stringify([...certificateHash])}) }] };
		const connect = async (path) => {
			const transport = new WebTransport("https://127.0.0.1:${server.port}" + path, options);
			await transport.ready;
			return transport;
		};
		let rejected = false;
		try {
			await connect("/game/reject");
		} catch {
			rejected = true;
		}
		const first = await connect("/game/one");
		const datagramReader = first.datagrams.readable.getReader();
		const datagramRead = Promise.race([
			datagramReader.read().then(({ value }) => new TextDecoder().decode(value) === "server-datagram"),
			new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
		]);
		const datagramWriter = first.datagrams.writable.getWriter();
		await datagramWriter.write(new TextEncoder().encode("client-datagram"));
		const bidirectional = await first.createBidirectionalStream();
		const writer = bidirectional.writable.getWriter();
		await writer.write(new TextEncoder().encode("ping"));
		await writer.close();
		const reader = bidirectional.readable.getReader();
		let response = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			response += new TextDecoder().decode(value);
		}
		first.close({ closeCode: 0, reason: "reconnect" });
		await first.closed;
		const aborted = await connect("/game/abort");
		const abortedStream = await aborted.createBidirectionalStream();
		const abortedWriter = abortedStream.writable.getWriter();
		await abortedWriter.write(new TextEncoder().encode("abort"));
		const abortedReader = abortedStream.readable.getReader();
		const acknowledgement = await abortedReader.read();
		if (acknowledgement.done || new TextDecoder().decode(acknowledgement.value) !== "abort-received") {
			throw new Error("server did not acknowledge abort-test data");
		}
		await abortedWriter.abort("browser abort test");
		aborted.close({ closeCode: 0, reason: "abort observed" });
		await aborted.closed;
		const second = await connect("/game/two");
		second.close({ closeCode: 0, reason: "done" });
		await second.closed;
		return { rejected, response, serverDatagramReceived: await datagramRead };
	})()`;
	const evaluated = await withTimeout(
		devTools.call(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			sessionId
		),
		20_000,
		"browser WebTransport scenario"
	);
	if (evaluated.exceptionDetails) {
		throw new Error(
			evaluated.exceptionDetails.exception?.description || "Browser evaluation failed"
		);
	}
	assert.deepEqual(evaluated.result.value.response, "pong");
	assert.equal(evaluated.result.value.rejected, true);
	const nativeEvents = {
		"abort data": receivedAbortData.promise,
		"abort end": receivedAbort.promise,
		datagram: receivedDatagram.promise,
		"stream data": receivedStreamData.promise,
	};
	const pendingNativeEvents = new Set(Object.keys(nativeEvents));
	await withTimeout(
		Promise.all(
			Object.entries(nativeEvents).map(([name, promise]) =>
				promise.finally(() => pendingNativeEvents.delete(name))
			)
		),
		5_000,
		() => `native WebTransport event delivery (${[...pendingNativeEvents].join(", ")} pending)`
	);
	assert.equal(sessions, 3);
	assert.equal(evaluated.result.value.serverDatagramReceived, true);
	console.log(
		"browser WebTransport accept/reject, datagram, stream, abort, close, and reconnect checks passed"
	);
} catch (error) {
	await stopChrome(chrome);
	chrome = undefined;
	if (error instanceof Error) {
		error.message += `\n${chromeStderr()}\n${netLogDiagnostics(join(temporaryDirectory, "netlog.json"))}`;
	}
	throw error;
} finally {
	devTools?.close();
	await stopChrome(chrome);
	await server.stop({ gracePeriodMs: 0 }).catch(() => undefined);
	await new Promise((resolve) => pageServer.close(resolve));
	rmSync(temporaryDirectory, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
}
