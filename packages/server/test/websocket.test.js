import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketConnection } from "../WebSocketConnection.js";

const encoder = new TextEncoder();

test("parses fragmented messages, answers ping, and completes close", async () => {
	const messages = [];
	const closes = [];
	const writes = [];
	const socket = createSocket({
		writes,
		onMessage: (_socket, data) => messages.push(data),
		onClose: (_socket, code, reason) => closes.push({ code, reason }),
	});
	await socket.accept("chat");

	await socket.receiveData(maskedFrame(0x1, encoder.encode("hel"), false));
	await socket.receiveData(maskedFrame(0x0, encoder.encode("lo"), true));
	await socket.receiveData(maskedFrame(0x9, encoder.encode("ping"), true));
	await socket.receiveData(maskedFrame(0x8, closePayload(1000, "done"), true));

	assert.deepEqual(messages, ["hello"]);
	assert.equal(writes[0][0], 0x8a);
	assert.equal(new TextDecoder().decode(writes[0].subarray(2)), "ping");
	assert.equal(writes[1][0], 0x88);
	assert.deepEqual(closes, [{ code: 1000, reason: "done" }]);
	assert.equal(socket.readyState, WebSocketConnection.CLOSED);
});

test("writes unmasked text and binary frames and enforces client masking", async () => {
	const writes = [];
	const errors = [];
	const socket = createSocket({ writes, onError: (_socket, error) => errors.push(error) });
	await socket.accept();
	assert.equal(await socket.send("hello"), true);
	assert.equal(await socket.send(new Uint8Array([1, 2, 3])), true);
	assert.deepEqual([...writes[0]], [0x81, 5, ...encoder.encode("hello")]);
	assert.deepEqual([...writes[1]], [0x82, 3, 1, 2, 3]);

	await socket.receiveData(Uint8Array.of(0x81, 1, 0x61));
	assert.match(errors[0].message, /masked/);
	assert.equal(writes[2][0], 0x88);
	assert.equal(socket.readyState, WebSocketConnection.CLOSED);
});

test("rejects non-minimal frame lengths", async () => {
	const writes = [];
	const errors = [];
	const socket = createSocket({ writes, onError: (_socket, error) => errors.push(error) });
	await socket.accept();
	await socket.receiveData(Uint8Array.of(0x81, 0xfe, 0, 1, 1, 2, 3, 4, 0x60));
	assert.match(errors[0].message, /Non-minimal/);
	assert.equal(writes[0][0], 0x88);
	assert.equal(socket.readyState, WebSocketConnection.CLOSED);
});

test("aborts a transport that ends without a close frame", async () => {
	let aborts = 0;
	const closes = [];
	const socket = createSocket({
		onAbort: () => {
			aborts += 1;
		},
		onClose: (_socket, code, reason) => closes.push({ code, reason }),
	});
	await socket.accept();
	await socket.receiveEnd("finished");
	assert.equal(aborts, 1);
	assert.deepEqual(closes, [{ code: 1006, reason: "" }]);
});

test("rejects unoffered subprotocols and oversized messages", async () => {
	const socket = createSocket({ maxMessageBytes: 4 });
	await assert.rejects(socket.accept("missing"), /not offered/);
	await socket.accept("chat");
	await assert.rejects(socket.send("12345"), /4-byte limit/);

	const errors = [];
	const fragmented = createSocket({
		maxMessageBytes: 4,
		onError: (_socket, error) => errors.push(error),
	});
	await fragmented.accept("chat");
	await fragmented.receiveData(maskedFrame(0x1, encoder.encode("123"), false));
	await fragmented.receiveData(maskedFrame(0x0, encoder.encode("45"), true));
	assert.match(errors[0].message, /too large/);
	assert.equal(fragmented.readyState, WebSocketConnection.CLOSED);
});

function createSocket(options = {}) {
	return new WebSocketConnection({
		id: "socket-1",
		httpVersion: "HTTP/3",
		url: "https://localhost/socket",
		headers: new Headers({ "sec-websocket-version": "13" }),
		offeredProtocols: ["chat"],
		maxMessageBytes: options.maxMessageBytes ?? 1024,
		closeTimeoutMs: 100,
		transport: {
			write(data) {
				options.writes?.push(data);
				return Promise.resolve(true);
			},
			end: () => Promise.resolve(true),
			abort: options.onAbort ?? (() => undefined),
		},
		onMessage: options.onMessage ?? (() => undefined),
		onClose: options.onClose ?? (() => undefined),
		onError: options.onError ?? (() => undefined),
	});
}

function maskedFrame(opcode, payload, fin) {
	const mask = Uint8Array.of(1, 2, 3, 4);
	const frame = new Uint8Array(6 + payload.byteLength);
	frame[0] = (fin ? 0x80 : 0) | opcode;
	frame[1] = 0x80 | payload.byteLength;
	frame.set(mask, 2);
	for (let index = 0; index < payload.byteLength; index += 1) {
		frame[6 + index] = payload[index] ^ mask[index % 4];
	}
	return frame;
}

function closePayload(code, reason) {
	const reasonBytes = encoder.encode(reason);
	const payload = new Uint8Array(2 + reasonBytes.byteLength);
	new DataView(payload.buffer).setUint16(0, code);
	payload.set(reasonBytes, 2);
	return payload;
}
