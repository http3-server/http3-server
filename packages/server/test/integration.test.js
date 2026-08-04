import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HTTP3Server as NativeHTTP3Server } from "@http3-server/native";
import { fin, HTTP3Server } from "http3s";

const execFileAsync = promisify(execFile);
const python = process.env.AIOQUIC_PYTHON;

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const config = () => ({
	address: "127.0.0.1",
	port: 0,
	certificateFile: fileURLToPath(new URL("localhost.pem", import.meta.url)),
	privateKeyFile: fileURLToPath(new URL("localhost-key.pem", import.meta.url)),
});

const runClient = (server, mode) =>
	execFileAsync(
		python,
		[
			fileURLToPath(new URL("h3-smoke.py", import.meta.url)),
			server.address,
			String(server.port),
			"--mode",
			mode,
		],
		{ timeout: 10_000 }
	);

test(
	"serves concurrent HTTP/3 streams and accepts a WebTransport session",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");

		const server = new HTTP3Server().handle({
			stream: () => new Response("baseline"),
			session: () => undefined,
		});

		await server.start(config());

		try {
			const result = await execFileAsync(
				python,
				[
					fileURLToPath(new URL("h3-smoke.py", import.meta.url)),
					server.address,
					String(server.port),
				],
				{ timeout: 10_000 }
			);
			assert.equal(result.stderr, "");
		} finally {
			await server.stop();
		}
	}
);

test(
	"drains accepted work and rejects new streams on an existing connection",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const entered = deferred();
		const release = deferred();
		let handled = 0;
		const server = new HTTP3Server().handle({
			async stream(stream) {
				handled += 1;
				assert.equal(new URL(stream.url).pathname, "/hold");
				entered.resolve();
				await release.promise;
				return new Response("drained");
			},
		});
		await server.start(config());
		const client = runClient(server, "drain");

		try {
			await entered.promise;
			let settled = false;
			const stopped = server.stop({ gracePeriodMs: 2_000 }).then(() => {
				settled = true;
			});
			await delay(75);
			assert.equal(settled, false);
			await delay(350);
			release.resolve();
			const result = await client;
			assert.equal(result.stderr, "");
			await stopped;
			assert.equal(handled, 1);
			assert.equal(server.connections.size, 0);
		} finally {
			release.resolve();
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test("aborts active work when the drain deadline expires", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const entered = deferred();
	const never = deferred();
	const server = new HTTP3Server().handle({
		async stream() {
			entered.resolve();
			await never.promise;
			return new Response("too late");
		},
	});
	await server.start(config());
	const client = runClient(server, "expect-abort");

	try {
		await entered.promise;
		const startedAt = performance.now();
		await server.stop({ gracePeriodMs: 100 });
		assert.ok(performance.now() - startedAt < 1_000);
		const result = await client;
		assert.equal(result.stderr, "");
		assert.equal(server.connections.size, 0);
	} finally {
		await server.stop({ gracePeriodMs: 0 });
		await client.catch(() => undefined);
	}
});

test(
	"settles successful header, data, trailer, and header-FIN sends",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const sends = deferred();
		const results = [];
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleRequest((id, _connectionId, headers) => {
			const path = headers[":path"];
			const pending =
				path === "/empty"
					? [server.sendHeaders(id, 204, [], true)]
					: [
							server.sendHeaders(id, 200, [], false),
							server.sendData(id, new TextEncoder().encode("payload"), false),
							server.sendTrailers(id, [["x-finished", "yes"]]),
						];
			void Promise.all(pending).then((values) => {
				results.push(...values);
				if (results.length === 4) sends.resolve();
			});
		});
		server.start(config());
		const endpoint = await started.promise;
		const client = runClient(endpoint, "reliable-success");

		try {
			await Promise.all([client, sends.promise]);
			assert.deepEqual(results, [true, true, true, true]);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test("serves GET, HEAD, POST, and PUT request semantics", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const server = new HTTP3Server().handle({
		async stream(stream) {
			if (stream.method === "HEAD") return new Response(null, { status: 204 });
			const body = stream.body ? await stream.text() : "";
			return new Response(`${stream.method}:${body}`);
		},
	});
	await server.start(config());
	try {
		const result = await runClient(server, "method-matrix");
		assert.equal(result.stderr, "");
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test("sends 103 early hints before the final response", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const server = new HTTP3Server().handle({
		async stream(stream) {
			assert.equal(
				await server.sendHeadersFrame(stream.id, {
					":status": "103",
					link: "</game.js>; rel=preload",
				}),
				true
			);
			return new Response("final");
		},
	});
	await server.start(config());
	try {
		const result = await runClient(server, "early-hints");
		assert.equal(result.stderr, "");
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test(
	"releases completed response buffers during a long-lived stream",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const completed = deferred();
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleRequest((id) => {
			void (async () => {
				assert.equal(await server.sendHeaders(id, 200, [], false), true);
				const chunk = new Uint8Array(64 * 1_024).fill("x".charCodeAt(0));
				for (let index = 0; index < 64; index += 1) {
					assert.equal(await server.sendData(id, chunk, false), true);
					const diagnostics = server.getDiagnostics();
					assert.equal(diagnostics.pendingResponseSends, 0);
					assert.equal(diagnostics.pendingResponseBytes, 0);
					assert.equal(diagnostics.activeResponseSends, 0);
					assert.equal(diagnostics.activeResponseBytes, 0);
				}
				assert.equal(await server.sendData(id, new Uint8Array(), true), true);
				completed.resolve();
			})().catch(completed.resolve);
		});
		server.start(config());
		const endpoint = await started.promise;
		const client = runClient(endpoint, "streaming-response");

		try {
			const [clientResult, completion] = await Promise.all([client, completed.promise]);
			if (completion instanceof Error) throw completion;
			assert.equal(clientResult.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test(
	"streams public Response bodies and preserves repeated Set-Cookie fields",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		let chunks = 0;
		const headers = new Headers();
		headers.append("set-cookie", "first=1; Secure");
		headers.append("set-cookie", "second=2; Secure");
		const server = new HTTP3Server().handle({
			stream() {
				return new Response(
					new ReadableStream({
						pull(controller) {
							if (chunks === 64) {
								controller.close();
								return;
							}
							chunks += 1;
							controller.enqueue(new Uint8Array(64 * 1_024).fill("x".charCodeAt(0)));
						},
					}),
					{ headers }
				);
			},
		});
		await server.start(config());

		try {
			const result = await runClient(server, "public-streaming-response");
			assert.equal(result.stderr, "");
			assert.equal(chunks, 64);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test("contains request handler failures and sends 500", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const reported = deferred();
	const failure = new Error("handler failed");
	const server = new HTTP3Server().handle({
		error(error) {
			if (error.code === "ERR_HTTP3_HANDLER_FAILURE") reported.resolve(error);
		},
		stream() {
			throw failure;
		},
	});
	await server.start(config());

	try {
		const [result, error] = await Promise.all([
			runClient(server, "handler-failure"),
			reported.promise,
		]);
		assert.equal(result.stderr, "");
		assert.equal(error.details.operation, "request");
		assert.equal(error.details.cause, failure);
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test(
	"rejects WebTransport CONNECT when native has no session handler",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.start({ ...config(), webTransport: true });
		const endpoint = await started.promise;

		try {
			const result = await runClient(endpoint, "webtransport-501");
			assert.equal(result.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test(
	"rejects WebTransport CONNECT when public API has no session handler",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const server = new HTTP3Server();
		await server.start(config());

		try {
			const result = await runClient(server, "webtransport-403");
			assert.equal(result.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test("emits exactly one reasoned terminal event per request", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const started = deferred();
	const ended = deferred();
	const events = [];
	const server = new NativeHTTP3Server();
	server.handleStart((_id, address, port) => started.resolve({ address, port }));
	server.handleRequest((id, _connectionId, headers) => {
		const empty = headers[":path"] === "/empty";
		if (empty) {
			void server.sendHeaders(id, 204, [], true);
			return;
		}
		void (async () => {
			await server.sendHeaders(id, 200, [], false);
			await server.sendData(id, new TextEncoder().encode("payload"), false);
			await server.sendTrailers(id, [["x-finished", "yes"]]);
		})();
	});
	server.handleRequestEnd((id, reason, errorCode) => {
		events.push({ id, reason, errorCode });
		if (events.length === 2) ended.resolve();
	});
	server.start(config());
	const endpoint = await started.promise;

	try {
		await Promise.all([runClient(endpoint, "reliable-success"), ended.promise]);
		await delay(100);
		assert.equal(events.length, 2);
		assert.equal(new Set(events.map(({ id }) => id)).size, 2);
		assert.ok(
			events.every(
				({ reason, errorCode }) => reason === "finished" && errorCode === undefined
			)
		);
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test(
	"preserves repeated request fields and rejects configured header limits",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const repeated = deferred();
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleRequest((id, _connectionId, headers) => {
			if (headers[":path"] === "/repeated") repeated.resolve(headers["x-repeat"]);
			void server.sendHeaders(id, 204, [], true);
		});
		server.start({
			...config(),
			maxHeaderFields: 6,
			maxHeaderBytes: 256,
			maxUrlLength: 64,
		});
		const endpoint = await started.promise;

		try {
			const [result, repeatedValues] = await Promise.all([
				runClient(endpoint, "header-limits"),
				repeated.promise,
			]);
			assert.equal(result.stderr, "");
			assert.deepEqual(repeatedValues, ["a", "b"]);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test(
	"rejects malformed pseudo-headers and releases churned or abrupt peers",
	{ timeout: 30_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const server = new HTTP3Server().handle({
			stream: () => new Response(null, { status: 204 }),
		});
		await server.start({ ...config(), maxConnections: 8, maxStreamsPerConnection: 8 });

		try {
			for (const mode of ["adversarial-headers", "connection-churn"]) {
				const result = await runClient(server, mode);
				assert.equal(result.stderr, "");
			}
			for (
				let attempt = 0;
				server.getDiagnostics().activeConnections > 0 && attempt < 100;
				attempt += 1
			) {
				await delay(10);
			}
			const diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.activeConnections, 0);
			assert.equal(diagnostics.activeRequests, 0);
			assert.equal(diagnostics.pendingRequestBodyBytes, 0);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test(
	"backpressures slow HTTP request bodies until the reader accepts data",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const entered = deferred();
		const read = deferred();
		const server = new HTTP3Server().handle({
			async stream(stream) {
				entered.resolve();
				await read.promise;
				const requestBody = await stream.arrayBuffer();
				return new Response(String(requestBody.byteLength));
			},
		});
		await server.start(config());
		const client = runClient(server, "slow-upload");

		try {
			await entered.promise;
			let diagnostics = server.getDiagnostics();
			for (
				let attempt = 0;
				diagnostics.pendingRequestBodyChunks === 0 && attempt < 100;
				attempt += 1
			) {
				await delay(10);
				diagnostics = server.getDiagnostics();
			}
			assert.equal(diagnostics.pendingRequestBodyChunks, 1);
			assert.ok(diagnostics.pendingRequestBodyBytes > 0);
			const pendingBytes = diagnostics.pendingRequestBodyBytes;
			await delay(100);
			diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.pendingRequestBodyChunks, 1);
			assert.equal(diagnostics.pendingRequestBodyBytes, pendingBytes);
			read.resolve();
			const result = await client;
			assert.equal(result.stderr, "");
		} finally {
			read.resolve();
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test(
	"aborts cleanly while request-body receive completion is pending",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const received = deferred();
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleData((id, _connectionId, data) =>
			received.resolve({ id, byteLength: data.byteLength })
		);
		server.start(config());
		const endpoint = await started.promise;
		const client = runClient(endpoint, "upload-expect-abort");

		try {
			const pending = await received.promise;
			const diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.pendingRequestBodyChunks, 1);
			assert.equal(diagnostics.pendingRequestBodyBytes, pending.byteLength);
			await server.stop({ gracePeriodMs: 0 });
			assert.equal(server.completeReceive(pending.id, pending.byteLength), false);
			assert.equal(server.getDiagnostics().pendingRequestBodyChunks, 0);
			const result = await client;
			assert.equal(result.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test("times out an application-stalled request body", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const timedOut = deferred();
	const never = deferred();
	const server = new HTTP3Server().handle({
		error(error) {
			if (error.code === "ERR_HTTP3_RECEIVE_TIMEOUT") timedOut.resolve(error);
		},
		async stream() {
			await never.promise;
		},
	});
	await server.start({ ...config(), maxIncompleteBodyMs: 50 });
	const client = runClient(server, "upload-expect-abort");

	try {
		const error = await timedOut.promise;
		assert.equal(error.details.operation, "request-body");
		assert.equal(server.getDiagnostics().receiveTimeouts, 1);
		assert.equal(server.getDiagnostics().pendingRequestBodyChunks, 0);
		await server.stop({ gracePeriodMs: 0 });
		const result = await client;
		assert.equal(result.stderr, "");
	} finally {
		await server.stop({ gracePeriodMs: 0 });
		await client.catch(() => undefined);
	}
});

test("rejects response sends beyond the configured byte budget", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const queued = deferred();
	const started = deferred();
	const server = new NativeHTTP3Server();
	let sends;
	server.handleStart((_id, address, port) => started.resolve({ address, port }));
	server.handleRequest((id) => {
		sends = [server.sendHeaders(id, 200, [], false)];
		const chunk = new Uint8Array(64 * 1_024);
		for (let index = 0; index < 512; index += 1) sends.push(server.sendData(id, chunk));
		queued.resolve();
	});
	server.start({ ...config(), maxQueuedResponseBytes: 128 * 1_024 });
	const endpoint = await started.promise;
	const client = runClient(endpoint, "expect-abort");

	try {
		await queued.promise;
		const diagnostics = server.getDiagnostics();
		assert.ok(diagnostics.responseSendQueueRejected > 0);
		assert.ok(
			diagnostics.pendingResponseBytes + diagnostics.activeResponseBytes <= 128 * 1_024
		);
		await server.stop({ gracePeriodMs: 0 });
		const results = await Promise.all(sends);
		assert.ok(results.includes(false));
		const result = await client;
		assert.equal(result.stderr, "");
	} finally {
		await server.stop({ gracePeriodMs: 0 });
		await client.catch(() => undefined);
	}
});

test(
	"backpressures WebTransport stream data until its async handler settles",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const entered = deferred();
		const release = deferred();
		const received = deferred();
		let receivedBytes = 0;
		const server = new HTTP3Server().handle({
			session: () => undefined,
			stream: () => new Response(String(receivedBytes)),
			async webTransportData(_stream, data) {
				if (receivedBytes === 0) {
					entered.resolve();
					await release.promise;
				}
				receivedBytes += data.byteLength;
				if (receivedBytes >= 128 * 1_024) {
					received.resolve();
				}
			},
		});
		await server.start(config());
		const client = runClient(server, "slow-webtransport-stream");

		try {
			await entered.promise;
			const diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.pendingWebTransportReceiveChunks, 1);
			assert.ok(diagnostics.pendingWebTransportReceiveBytes > 0);
			const pendingBytes = diagnostics.pendingWebTransportReceiveBytes;
			await delay(100);
			assert.equal(server.getDiagnostics().pendingWebTransportReceiveBytes, pendingBytes);
			release.resolve();
			await received.promise;
			const result = await client;
			assert.equal(result.stderr, "");
			assert.equal(receivedBytes, 128 * 1_024);
		} finally {
			release.resolve();
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test(
	"settles queued reliable sends when shutdown cancels a request",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const queued = deferred();
		let sends;
		const server = new HTTP3Server().handle({
			stream(stream) {
				const pending = [server.sendHeadersFrame(stream.id, { ":status": "200" })];
				const chunk = new Uint8Array(64 * 1_024);
				for (let index = 0; index < 128; index += 1) {
					pending.push(server.sendDataFrame(stream.id, chunk));
				}
				pending.push(server.sendDataFrame(stream.id, fin));
				sends = Promise.all(pending);
				queued.resolve();
			},
		});
		await server.start(config());
		const client = runClient(server, "expect-abort");

		try {
			await queued.promise;
			await server.stop({ gracePeriodMs: 0 });
			const results = await Promise.race([
				sends,
				delay(2_000).then(() => {
					throw new Error("reliable send promises did not settle after request teardown");
				}),
			]);
			assert.equal(results.length, 130);
			assert.ok(results.every((result) => typeof result === "boolean"));
			assert.ok(results.includes(false));
			const clientResult = await client;
			assert.equal(clientResult.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test("uses monotonic opaque IDs and rejects stale request IDs", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const started = deferred();
	const received = deferred();
	const requestIds = [];
	const sends = [];
	let serverId;
	let connectionId;
	const server = new NativeHTTP3Server();
	server.handleStart((id, address, port) => {
		serverId = id;
		started.resolve({ address, port });
	});
	server.handleConnection((id) => {
		connectionId = id;
	});
	server.handleRequest((id, requestConnectionId) => {
		assert.equal(requestConnectionId, connectionId);
		requestIds.push(id);
		sends.push(server.sendHeaders(id, 204, [], true));
		if (requestIds.length === 2) received.resolve();
	});
	server.start(config());
	const endpoint = await started.promise;
	const client = runClient(endpoint, "opaque-ids");

	try {
		await Promise.all([client, received.promise]);
		assert.deepEqual(await Promise.all(sends), [true, true]);
		await server.stop();
		const ids = [serverId, connectionId, ...requestIds].map(BigInt);
		assert.equal(new Set(ids).size, ids.length);
		assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
		for (const id of requestIds) {
			assert.equal(await server.sendEarlyHints(id, []), false);
			assert.equal(await server.sendData(id, new Uint8Array()), false);
			assert.equal(await server.sendTrailers(id, []), false);
			assert.equal(server.sendDatagram(id, new Uint8Array()), false);
			assert.equal(server.sendWebTransportStreamData(id, new Uint8Array()), false);
			assert.throws(() => server.sendHeaders(id, 204, [], true), /Stream ID not found/);
		}
	} finally {
		await server.stop({ gracePeriodMs: 0 });
		await client.catch(() => undefined);
	}
});

test("rejects streams beyond the per-connection admission limit", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	let handled = 0;
	const server = new HTTP3Server().handle({
		async stream() {
			handled += 1;
			await delay(600);
			return new Response(null, { status: 204 });
		},
	});
	await server.start({ ...config(), maxStreamsPerConnection: 1 });

	try {
		const result = await runClient(server, "stream-limit");
		assert.equal(result.stderr, "");
		assert.equal(handled, 1);
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test("rejects connections beyond the server admission limit", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	let connected = 0;
	let handled = 0;
	const server = new HTTP3Server().handle({
		connection() {
			connected += 1;
		},
		stream() {
			handled += 1;
			return new Response(null, { status: 204 });
		},
	});
	await server.start({ ...config(), maxConnections: 1 });

	try {
		const result = await runClient(server, "connection-limit");
		assert.equal(result.stderr, "");
		assert.equal(connected, 1);
		assert.equal(handled, 1);
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

test(
	"owns queued datagram buffers through terminal connection state",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const sent = deferred();
		const server = new HTTP3Server().handle({
			session(session) {
				setTimeout(() => {
					const payload = new TextEncoder().encode("server-datagram");
					assert.equal(session.sendDatagram(new Uint8Array(33)), false);
					const results = Array.from({ length: 512 }, () =>
						session.sendDatagram(payload)
					);
					assert.ok(results.some(Boolean));
					assert.ok(results.includes(false));
					sent.resolve(results);
				}, 25);
			},
		});
		await server.start({
			...config(),
			webTransport: true,
			maxDatagramSize: 32,
			maxPendingDatagrams: 1,
		});

		try {
			const result = await runClient(server, "server-datagram");
			await sent.promise;
			assert.equal(result.stderr, "");
			await server.stop({ gracePeriodMs: 0 });
			const diagnostics = server.getDiagnostics();
			assert.equal(diagnostics.pendingDatagramSends, 0);
			assert.equal(diagnostics.datagramsRejectedOversize, 1);
			assert.ok(diagnostics.datagramsDroppedOverload > 0);
			assert.equal(
				diagnostics.datagramsAccepted,
				diagnostics.datagramsAcknowledged +
					diagnostics.datagramsLost +
					diagnostics.datagramsCanceled
			);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test("bounds reliable WebTransport sends by bytes and count", { timeout: 15_000 }, async () => {
	assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
	const queued = deferred();
	const server = new HTTP3Server().handle({
		session: () => undefined,
		webTransportStream(stream) {
			const chunk = new Uint8Array(64 * 1_024);
			const results = Array.from({ length: 512 }, () => stream.send(chunk));
			queued.resolve(results);
		},
	});
	await server.start({
		...config(),
		webTransport: true,
		maxQueuedWebTransportBytes: 128 * 1_024,
		maxPendingWebTransportSends: 2,
	});
	const client = runClient(server, "webtransport-expect-abort");

	try {
		const results = await queued.promise;
		assert.ok(results.includes(false));
		const diagnostics = server.getDiagnostics();
		assert.ok(diagnostics.webTransportSendQueueRejected > 0);
		assert.ok(diagnostics.pendingWebTransportSends <= 2);
		assert.ok(diagnostics.pendingWebTransportSendBytes <= 128 * 1_024);
		await server.stop({ gracePeriodMs: 0 });
		const stoppedDiagnostics = server.getDiagnostics();
		assert.equal(stoppedDiagnostics.pendingWebTransportSends, 0);
		assert.equal(
			stoppedDiagnostics.webTransportSendsAccepted,
			stoppedDiagnostics.webTransportSendsCompleted +
				stoppedDiagnostics.webTransportSendsCanceled
		);
		const result = await client;
		assert.equal(result.stderr, "");
	} finally {
		await server.stop({ gracePeriodMs: 0 });
		await client.catch(() => undefined);
	}
});

test(
	"rejects reentrant native sends during WebTransport stream startup",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const started = deferred();
		const sendSafe = deferred();
		const server = new NativeHTTP3Server();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleSession((id) => {
			void server.sendHeaders(id, 200, [["sec-webtransport-http3-draft02", "1"]], false);
		});
		server.handleWebTransportStream((id) => {
			const payload = new Uint8Array([1]);
			assert.equal(server.sendWebTransportStreamData(id, payload), false);
			setImmediate(() => sendSafe.resolve(server.sendWebTransportStreamData(id, payload)));
		});
		server.handleWebTransportStreamData((id, data) => {
			server.completeReceive(id, data.byteLength);
		});
		server.start({ ...config(), webTransport: true });
		const endpoint = await started.promise;
		const client = runClient(endpoint, "webtransport-expect-abort");

		try {
			assert.equal(await sendSafe.promise, true);
			await server.stop({ gracePeriodMs: 0 });
			const result = await client;
			assert.equal(result.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test(
	"aborts pending WebTransport receive work at the drain deadline",
	{ timeout: 15_000 },
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		const entered = deferred();
		const never = deferred();
		const server = new HTTP3Server().handle({
			session: () => undefined,
			async webTransportData() {
				entered.resolve();
				await never.promise;
			},
		});
		await server.start({ ...config(), webTransport: true });
		const client = runClient(server, "webtransport-expect-abort");

		try {
			await entered.promise;
			assert.equal(server.getDiagnostics().pendingWebTransportReceiveChunks, 1);
			const startedAt = performance.now();
			await server.stop({ gracePeriodMs: 100 });
			assert.ok(performance.now() - startedAt < 1_000);
			assert.equal(server.getDiagnostics().pendingWebTransportReceiveChunks, 0);
			const result = await client;
			assert.equal(result.stderr, "");
			assert.equal(server.connections.size, 0);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);

test(
	"aborts hidden native work when TSFN delivery is rejected",
	{
		timeout: 15_000,
		skip: process.env.MSH3_FAULT_TEST !== "tsfn-delivery",
	},
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		assert.equal(process.env.MSH3_TEST_FAIL_TSFN_CALL, "connection");
		let connected = 0;
		const server = new HTTP3Server().handle({
			connection() {
				connected += 1;
			},
			stream() {
				return new Response(null, { status: 204 });
			},
		});

		try {
			await server.start(config());
			const result = await runClient(server, "expect-abort");
			assert.equal(result.stderr, "");
			assert.equal(connected, 0);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test(
	"settles reliable sends when MSH3 submission fails",
	{
		timeout: 15_000,
		skip: process.env.MSH3_FAULT_TEST !== "msh3-submission",
	},
	async () => {
		assert.ok(python, "AIOQUIC_PYTHON must name the pinned integration-client interpreter");
		assert.equal(process.env.MSH3_TEST_FAIL_MSH3_CALL, "request-send");
		const attempted = deferred();
		let sendResult;
		const server = new NativeHTTP3Server();
		const started = deferred();
		server.handleStart((_id, address, port) => started.resolve({ address, port }));
		server.handleRequest((id) => {
			sendResult = server.sendHeaders(id, 204, [], true);
			attempted.resolve();
		});
		server.start(config());
		const endpoint = await started.promise;
		const client = runClient(endpoint, "expect-abort");

		try {
			await attempted.promise;
			assert.equal(await sendResult, false);
			await server.stop({ gracePeriodMs: 0 });
			const result = await client;
			assert.equal(result.stderr, "");
		} finally {
			await server.stop({ gracePeriodMs: 0 });
			await client.catch(() => undefined);
		}
	}
);
