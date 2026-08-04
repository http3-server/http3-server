import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HTTP3Server } from "./http3.js";

const eventMethods = [
	"handleStart",
	"handleStop",
	"handleConnection",
	"handleConnectionEnd",
	"handleRequest",
	"handleRequestEnd",
	"handleData",
	"handleSession",
	"handleDatagram",
	"handleWebTransportStream",
	"handleWebTransportStreamData",
	"handleWebTransportStreamEnd",
];

test("exports the native HTTP3Server constructor", () => {
	assert.equal(typeof HTTP3Server, "function");
	assert.equal(HTTP3Server.name, "HTTP3Server");
	assert.equal(HTTP3Server.length, 0);
	assert.ok(new HTTP3Server() instanceof HTTP3Server);
});

test("exposes the native request and WebTransport methods", () => {
	const server = new HTTP3Server();
	for (const method of [
		"handleStart",
		"handleStop",
		"handleConnection",
		"handleConnectionEnd",
		"handleRequest",
		"handleRequestEnd",
		"handleData",
		"handleSession",
		"handleDatagram",
		"handleWebTransportStream",
		"handleWebTransportStreamData",
		"handleWebTransportStreamEnd",
		"sendEarlyHints",
		"sendHeaders",
		"sendTrailers",
		"sendData",
		"sendDatagram",
		"sendWebTransportStreamData",
		"completeReceive",
		"getDiagnostics",
		"start",
		"stop",
	]) {
		assert.equal(typeof server[method], "function", method);
	}
});

test("reports an empty native ownership snapshot before start", () => {
	assert.deepEqual(new HTTP3Server().getDiagnostics(), {
		activeConnections: 0,
		activeRequests: 0,
		pendingResponseSends: 0,
		pendingResponseBytes: 0,
		activeResponseSends: 0,
		activeResponseBytes: 0,
		pendingRequestBodyChunks: 0,
		pendingRequestBodyBytes: 0,
		pendingWebTransportReceiveChunks: 0,
		pendingWebTransportReceiveBytes: 0,
		pendingDatagramSends: 0,
		pendingDatagramBytes: 0,
		pendingWebTransportSends: 0,
		pendingWebTransportSendBytes: 0,
		responseSendQueueRejected: 0,
		webTransportSendQueueRejected: 0,
		webTransportSendsAccepted: 0,
		webTransportSendsFailed: 0,
		webTransportSendsCompleted: 0,
		webTransportSendsCanceled: 0,
		datagramsAccepted: 0,
		datagramsRejectedOversize: 0,
		datagramsDroppedOverload: 0,
		datagramsSendFailed: 0,
		datagramsAcknowledged: 0,
		datagramsLost: 0,
		datagramsCanceled: 0,
	});
});

test("rejects invalid synchronous WebTransport send IDs", () => {
	const server = new HTTP3Server();
	assert.equal(server.sendDatagram("not-an-id", new Uint8Array()), false);
	assert.equal(server.sendWebTransportStreamData("not-an-id", new Uint8Array()), false);
});

test("rejects invalid reliable send IDs", async () => {
	const server = new HTTP3Server();
	assert.equal(await server.sendEarlyHints("not-an-id", []), false);
	assert.throws(() => server.sendHeaders("not-an-id", 200, []), /Invalid streamId/);
	assert.equal(await server.sendData("not-an-id", new Uint8Array()), false);
	assert.equal(await server.sendTrailers("not-an-id", []), false);
});

test("rejects invalid receive completions", () => {
	const server = new HTTP3Server();
	assert.equal(server.completeReceive("not-an-id", 1), false);
	assert.equal(server.completeReceive("1", 1), false);
	for (const byteLength of [-1, 1.5, Number.POSITIVE_INFINITY, 2 ** 32]) {
		assert.throws(() => server.completeReceive("1", byteLength), /byteLength must be/);
	}
});

test("validates the graceful-stop deadline", () => {
	for (const gracePeriodMs of [-1, 1.5, Number.POSITIVE_INFINITY, "1000"]) {
		const server = new HTTP3Server();
		assert.throws(
			() => server.stop({ gracePeriodMs }),
			/gracePeriodMs must be a finite nonnegative integer/
		);
	}
	assert.throws(() => new HTTP3Server().stop(null), /stop options must be an object/);
});

test("validates native resource limits", () => {
	const certificateFile = fileURLToPath(new URL("../server/test/localhost.pem", import.meta.url));
	const privateKeyFile = fileURLToPath(
		new URL("../server/test/localhost-key.pem", import.meta.url)
	);
	for (const name of [
		"maxConnections",
		"maxStreamsPerConnection",
		"receiveWindowBytes",
		"connectionReceiveWindowBytes",
		"maxQueuedResponseBytes",
		"maxQueuedWebTransportBytes",
		"maxPendingWebTransportSends",
		"maxDatagramSize",
		"maxPendingDatagrams",
		"maxHeaderFields",
		"maxHeaderBytes",
		"maxUrlLength",
	]) {
		for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY, 2 ** 32, "1"]) {
			const server = new HTTP3Server();
			assert.throws(
				() => server.start({ certificateFile, privateKeyFile, [name]: value }),
				new RegExp(`Configuration '${name}' must be a positive integer`)
			);
		}
	}
});

test("registers one callback for each native event", () => {
	const server = new HTTP3Server();
	for (const method of eventMethods) {
		assert.doesNotThrow(() => server[method](() => undefined), method);
	}
});

test("rejects duplicate native handler registration", () => {
	const server = new HTTP3Server();
	for (const method of eventMethods) {
		server[method](() => undefined);
		assert.throws(() => server[method](() => undefined), /can only be called once/, method);
	}
});

test("rejects native handler registration after start", async () => {
	const server = new HTTP3Server();
	server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile: fileURLToPath(new URL("../server/test/localhost.pem", import.meta.url)),
		privateKeyFile: fileURLToPath(new URL("../server/test/localhost-key.pem", import.meta.url)),
	});
	for (const method of eventMethods) {
		assert.throws(() => server[method](() => undefined), /must be called before start/, method);
	}
	await server.stop();
});
