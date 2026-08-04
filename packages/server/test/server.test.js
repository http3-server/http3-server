import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HTTP3Server } from "../HTTP3Server.js";
import { mapOf } from "../mapOf.js";

test("typed maps preserve standard Map#get semantics", () => {
	const Items = mapOf("Item");
	const server = {};
	const items = new Items(server);
	assert.equal(items.get("missing"), undefined);
	assert.throws(() => items.require("missing"), /Item missing does not exist/);
	const item = {};
	items.set("present", item);
	assert.equal(items.get("present"), item);
	assert.equal(items.require("present"), item);
});

test("starts and stops an HTTP/3 and WebTransport listener", async () => {
	const server = new HTTP3Server();
	const config = {
		address: "127.0.0.1",
		port: 0,
		certificateFile: fileURLToPath(new URL("localhost.pem", import.meta.url)),
		privateKeyFile: fileURLToPath(new URL("localhost-key.pem", import.meta.url)),
	};
	assert.equal(server.address, undefined);
	assert.equal(server.port, undefined);
	await server.start(config);
	assert.equal(server.address, "127.0.0.1");
	assert.ok(Number.isInteger(server.port));
	assert.ok(server.port > 0 && server.port <= 65_535);
	assert.equal(server.connections.size, 0);
	await assert.rejects(server.start(config), /only be started once/);
	const firstStop = server.stop();
	assert.equal(server.stop(), firstStop);
	await firstStop;
	assert.equal(server.address, undefined);
	assert.equal(server.port, undefined);
	assert.equal(server.stop(), firstStop);
	await assert.rejects(server.start(config), /only be started once/);
});

test("stopping an idle server permanently closes that instance", async () => {
	const server = new HTTP3Server();
	const stopped = server.stop();
	assert.equal(server.stop(), stopped);
	await stopped;
	await assert.rejects(
		server.start({
			port: 0,
			certificateFile: fileURLToPath(new URL("localhost.pem", import.meta.url)),
			privateKeyFile: fileURLToPath(new URL("localhost-key.pem", import.meta.url)),
		}),
		/only be started once/
	);
});

test("reports locally rejected sends without throwing", () => {
	const errors = [];
	const server = new HTTP3Server().handle({
		error(error) {
			errors.push(error);
		},
	});
	assert.equal(server.sendDatagram("unknown", new Uint8Array([1])), false);
	assert.equal(server.sendWebTransportStreamData("unknown", new Uint8Array([2])), false);
	assert.deepEqual(
		errors.map((error) => error.code),
		["ERR_HTTP3_DATAGRAM_SEND_REJECTED", "ERR_HTTP3_WEBTRANSPORT_SEND_REJECTED"]
	);
	assert.equal(server.getDiagnostics().reportedErrors, 2);
});

test("validates the receive-delivery deadline", async () => {
	for (const maxIncompleteBodyMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 2 ** 32]) {
		const server = new HTTP3Server();
		await assert.rejects(
			server.start({
				port: 0,
				certificateFile: fileURLToPath(new URL("localhost.pem", import.meta.url)),
				privateKeyFile: fileURLToPath(new URL("localhost-key.pem", import.meta.url)),
				maxIncompleteBodyMs,
			}),
			/maxIncompleteBodyMs must be a positive integer/
		);
	}
});
