import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:http2";
import { request as httpsRequest } from "node:https";
import { test } from "node:test";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";
import { HTTPServer } from "../HTTPServer.js";

const certificateFile = fileURLToPath(new URL("localhost.pem", import.meta.url));
const privateKeyFile = fileURLToPath(new URL("localhost-key.pem", import.meta.url));

test("serves one Fetch handler over HTTP/2 and HTTP/1.1 while advertising HTTP/3", async () => {
	const protocols = [];
	const server = new HTTPServer().handle({
		stream(request) {
			protocols.push(request.protocol);
			return new Response(`${request.protocol} ${new URL(request.url).pathname}`, {
				headers: { "content-type": "text/plain" },
			});
		},
	});
	await server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile,
		privateKeyFile,
	});

	try {
		assert.equal(server.address, "127.0.0.1");
		assert.equal(server.http3.port, server.port);
		const h2 = await requestHTTP2(server.port, "/h2");
		assert.equal(h2.body, "HTTP/2 /h2");
		assert.equal(h2.headers["alt-svc"], `h3=":${server.port}"; ma=3600`);

		const h1 = await requestHTTP1(server.port, "/h1");
		assert.equal(h1.body, "HTTP/1.1 /h1");
		assert.equal(h1.headers["alt-svc"], `h3=":${server.port}"; ma=3600`);
		assert.deepEqual(protocols.sort(), ["HTTP/1.1", "HTTP/2"]);
	} finally {
		await server.stop({ gracePeriodMs: 100 });
	}
});

test("returns 404 without a stream handler and reports TCP handler failures", async () => {
	const errors = [];
	const server = new HTTPServer().handle({
		error(error) {
			errors.push(error);
		},
		stream(request) {
			if (new URL(request.url).pathname === "/failure") throw new Error("boom");
		},
	});
	await server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile,
		privateKeyFile,
	});

	try {
		assert.equal((await requestHTTP1(server.port, "/missing")).status, 404);
		assert.equal((await requestHTTP1(server.port, "/failure")).status, 500);
		assert.equal(errors.length, 1);
		assert.equal(errors[0].code, "ERR_HTTP_HANDLER_FAILURE");
		assert.equal(errors[0].details.protocol, "HTTP/1.1");
	} finally {
		await server.stop({ gracePeriodMs: 100 });
	}
});

test("validates composed server configuration and remains single-use", async () => {
	const invalid = new HTTPServer();
	await assert.rejects(
		invalid.start({ certificateFile, privateKeyFile, altSvcMaxAge: -1 }),
		/altSvcMaxAge/
	);
	await assert.rejects(
		new HTTPServer().start({
			certificateFile,
			privateKeyFile,
			enableHTTP2ConnectProtocol: "yes",
		}),
		/enableHTTP2ConnectProtocol/
	);
	await invalid.start({ address: "127.0.0.1", port: 0, certificateFile, privateKeyFile });
	await invalid.stop({ gracePeriodMs: 0 });

	const server = new HTTPServer();
	await server.start({ address: "127.0.0.1", port: 0, certificateFile, privateKeyFile });
	await assert.rejects(
		server.start({ address: "127.0.0.1", port: 0, certificateFile, privateKeyFile }),
		/only be started once/
	);
	const firstStop = server.stop({ gracePeriodMs: 0 });
	assert.equal(server.stop(), firstStop);
	await firstStop;
});

test("can reserve WebSockets for an attached HTTP/1.1-only integration", async () => {
	const server = new HTTPServer();
	await server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile,
		privateKeyFile,
		enableHTTP2ConnectProtocol: false,
	});
	const client = connect(`https://127.0.0.1:${server.port}`, { rejectUnauthorized: false });

	try {
		const [settings] = await once(client, "remoteSettings");
		assert.equal(settings.enableConnectProtocol, false);
	} finally {
		client.close();
		await server.stop({ gracePeriodMs: 0 });
	}
});

test(
	"uses one WebSocket handler over HTTP/2 Extended CONNECT and HTTP/1.1 Upgrade",
	{ timeout: 15_000 },
	async () => {
		const protocols = [];
		const closed = [];
		const server = new HTTPServer().handle({
			webSocket(socket) {
				protocols.push(socket.httpVersion);
				return socket.offeredProtocols.includes("echo") ? "echo" : undefined;
			},
			async webSocketMessage(socket, data) {
				await socket.send(data);
			},
			webSocketClose(socket, code) {
				closed.push([socket.httpVersion, code]);
			},
		});
		await server.start({
			address: "127.0.0.1",
			port: 0,
			certificateFile,
			privateKeyFile,
		});

		try {
			assert.equal(await webSocketHTTP2(server.port, "over-h2"), "over-h2");
			assert.equal(await webSocketHTTP1(server.port, "over-h1"), "over-h1");
			assert.deepEqual(protocols, ["HTTP/2", "HTTP/1.1"]);
			for (let attempt = 0; closed.length < 2 && attempt < 50; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			assert.deepEqual(closed, [
				["HTTP/2", 1000],
				["HTTP/1.1", 1000],
			]);
		} finally {
			await server.stop({ gracePeriodMs: 0 });
		}
	}
);

test("leaves HTTP/1.1 upgrades to an attached integration without a WebSocket handler", async () => {
	const server = new HTTPServer();
	await server.start({
		address: "127.0.0.1",
		port: 0,
		certificateFile,
		privateKeyFile,
	});
	server.tcpServer.once("upgrade", (_request, socket) => {
		socket.end(
			"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
		);
	});

	try {
		const socket = tlsConnect({
			host: "127.0.0.1",
			port: server.port,
			rejectUnauthorized: false,
		});
		await once(socket, "secureConnect");
		const closed = once(socket, "close");
		socket.write(
			"GET /integration HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
		);
		const [response] = await once(socket, "data");
		assert.match(response.toString(), /^HTTP\/1\.1 101/);
		await closed;
	} finally {
		await server.stop({ gracePeriodMs: 0 });
	}
});

function requestHTTP1(port, path) {
	return new Promise((resolveRequest, reject) => {
		const request = httpsRequest(
			{
				host: "127.0.0.1",
				method: "GET",
				path,
				port,
				rejectUnauthorized: false,
			},
			(response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.once("end", () =>
					resolveRequest({
						body: Buffer.concat(chunks).toString(),
						headers: response.headers,
						status: response.statusCode,
					})
				);
			}
		);
		request.once("error", reject);
		request.end();
	});
}

function requestHTTP2(port, path) {
	return new Promise((resolveRequest, reject) => {
		const client = connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
		client.once("error", reject);
		const request = client.request({ ":method": "GET", ":path": path });
		const chunks = [];
		let headers;
		request.once("response", (value) => {
			headers = value;
		});
		request.on("data", (chunk) => chunks.push(chunk));
		request.once("error", reject);
		request.once("end", () => {
			client.close();
			resolveRequest({ body: Buffer.concat(chunks).toString(), headers });
		});
		request.end();
	});
}

async function webSocketHTTP2(port, message) {
	const client = connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
	try {
		const [settings] = await once(client, "remoteSettings");
		assert.equal(settings.enableConnectProtocol, true);
		const stream = client.request(
			{
				":method": "CONNECT",
				":protocol": "websocket",
				":scheme": "https",
				":authority": `127.0.0.1:${port}`,
				":path": "/socket",
				"sec-websocket-protocol": "echo",
				"sec-websocket-version": "13",
			},
			{ endStream: false }
		);
		const [headers] = await once(stream, "response");
		assert.equal(headers[":status"], 200);
		assert.equal(headers["sec-websocket-protocol"], "echo");
		assert.equal(headers["alt-svc"], `h3=":${port}"; ma=3600`);
		stream.write(maskedFrame(0x1, Buffer.from(message)));
		const [response] = await once(stream, "data");
		assert.equal(decodeServerFrame(response).toString(), message);
		stream.write(maskedFrame(0x8, closePayload(1000)));
		const [closeFrame] = await once(stream, "data");
		assert.equal(closeFrame[0], 0x88);
		await once(stream, "end");
		stream.end();
		return message;
	} finally {
		client.close();
	}
}

async function webSocketHTTP1(port, message) {
	const socket = tlsConnect({ host: "127.0.0.1", port, rejectUnauthorized: false });
	await once(socket, "secureConnect");
	const key = Buffer.alloc(16, 7).toString("base64");
	socket.write(
		[
			"GET /socket HTTP/1.1",
			`Host: 127.0.0.1:${port}`,
			"Connection: Upgrade",
			"Upgrade: websocket",
			`Sec-WebSocket-Key: ${key}`,
			"Sec-WebSocket-Version: 13",
			"Sec-WebSocket-Protocol: echo",
			"",
			"",
		].join("\r\n")
	);
	let pending = Buffer.alloc(0);
	while (!pending.includes("\r\n\r\n")) {
		const [chunk] = await once(socket, "data");
		pending = Buffer.concat([pending, chunk]);
	}
	const split = pending.indexOf("\r\n\r\n") + 4;
	assert.match(pending.subarray(0, split).toString(), /^HTTP\/1\.1 101/);
	assert.match(pending.subarray(0, split).toString(), /Sec-WebSocket-Protocol: echo/i);
	assert.match(pending.subarray(0, split).toString(), new RegExp(`Alt-Svc: h3=":${port}"`));
	socket.write(maskedFrame(0x1, Buffer.from(message)));
	let response = pending.subarray(split);
	if (response.byteLength === 0) [response] = await once(socket, "data");
	assert.equal(decodeServerFrame(response).toString(), message);
	socket.write(maskedFrame(0x8, closePayload(1000)));
	await once(socket, "close");
	return message;
}

function maskedFrame(opcode, payload) {
	const mask = Buffer.from([1, 2, 3, 4]);
	assert.ok(payload.byteLength < 126);
	const frame = Buffer.alloc(6 + payload.byteLength);
	frame[0] = 0x80 | opcode;
	frame[1] = 0x80 | payload.byteLength;
	mask.copy(frame, 2);
	for (let index = 0; index < payload.byteLength; index += 1) {
		frame[6 + index] = payload[index] ^ mask[index % 4];
	}
	return frame;
}

function decodeServerFrame(frame) {
	assert.equal(frame[0] & 0x80, 0x80);
	assert.equal(frame[1] & 0x80, 0);
	const length = frame[1] & 0x7f;
	return frame.subarray(2, 2 + length);
}

function closePayload(code) {
	const payload = Buffer.alloc(2);
	payload.writeUInt16BE(code);
	return payload;
}
