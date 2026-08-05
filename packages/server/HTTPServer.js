// @ts-check
/// <reference types="./types.d.ts" />

import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createSecureServer } from "node:http2";
import { HTTP3Server } from "./HTTP3Server.js";
import { requestFromNode, writeResponseToNode } from "./internal/fetch-adapter.js";
import { WebSocketConnection, webSocketMetadata } from "./WebSocketConnection.js";

const WEB_SOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Error reported by the TCP side of a composed HTTP server. */
export class HTTPServerError extends Error {
	/**
	 * @param {http.ServerErrorCode} code
	 * @param {string} message
	 * @param {http.ServerErrorDetails} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "HTTPServerError";
		this.code = code;
		this.details = Object.freeze({ ...details });
		if ("cause" in details) this.cause = details.cause;
	}
}

/** HTTPS server composed from HTTP/3 over UDP and HTTP/2 or HTTP/1.1 over TCP. */
export class HTTPServer {
	/** Underlying HTTP/3 and WebTransport server. */
	get http3() {
		return this.#http3;
	}

	/** Underlying Node.js HTTP/2 secure server, available after start begins. */
	get tcpServer() {
		return this.#tcp;
	}

	/** Bound listener address, available after start resolves. */
	get address() {
		return this.#address;
	}

	/** Shared TCP and UDP port, available after start resolves. */
	get port() {
		return this.#port;
	}

	/** Replaces the handlers used by every protocol. */
	handle(handlers) {
		this.#handlers = Object(handlers);
		this.#http3.handle(this.#handlers);
		return this;
	}

	/** Starts TCP HTTPS and UDP HTTP/3 on the same numeric port. */
	async start(config) {
		if (this.#state !== "new") throw new Error("Server can only be started once");
		const {
			allowHTTP1 = true,
			altSvcMaxAge = 3600,
			enableHTTP2ConnectProtocol = true,
			...http3Config
		} = config;
		if (typeof allowHTTP1 !== "boolean") throw new TypeError("allowHTTP1 must be a boolean");
		if (!Number.isInteger(altSvcMaxAge) || altSvcMaxAge < 0) {
			throw new RangeError("altSvcMaxAge must be a non-negative integer");
		}
		if (typeof enableHTTP2ConnectProtocol !== "boolean") {
			throw new TypeError("enableHTTP2ConnectProtocol must be a boolean");
		}
		this.#state = "starting";
		this.#altSvcMaxAge = altSvcMaxAge;
		this.#maxWebSocketMessageBytes = config.maxWebSocketMessageBytes ?? 16 * 1024 * 1024;
		this.#webSocketCloseTimeoutMs = config.webSocketCloseTimeoutMs ?? 5_000;

		try {
			const [certificate, privateKey] = await Promise.all([
				readFile(config.certificateFile),
				readFile(config.privateKeyFile),
			]);
			const tcp = createSecureServer({
				allowHTTP1,
				cert: certificate,
				key: privateKey,
				settings: { enableConnectProtocol: enableHTTP2ConnectProtocol },
			});
			this.#tcp = tcp;
			tcp.on("stream", (stream, headers) => {
				if (headers[":method"] !== "CONNECT" || headers[":protocol"] === undefined) return;
				this.#claimedH2Streams.add(stream);
				if (headers[":protocol"] === "websocket") {
					void this.#handleH2WebSocket(stream, headers);
				} else {
					stream.respond({ ":status": 501 });
					stream.end();
				}
			});
			tcp.on("request", (request, response) => {
				if (request.stream && this.#claimedH2Streams.has(request.stream)) return;
				void this.#handleTCPRequest(request, response);
			});
			tcp.on("connect", (request, responseOrSocket) => {
				if (request.httpVersion === "2.0") {
					// The HTTP/2 compatibility layer otherwise ends every CONNECT with 405,
					// even when the low-level stream handler accepted Extended CONNECT.
					if (this.#claimedH2Streams.has(request.stream)) return;
					responseOrSocket.writeHead(501);
					responseOrSocket.end();
					return;
				}
				writeH1Response(responseOrSocket, 501);
			});
			tcp.on("upgrade", (request, socket, head) => {
				if (
					typeof this.#handlers.webSocket !== "function" &&
					tcp.listenerCount("upgrade") > 1
				) {
					return;
				}
				void this.#handleH1WebSocket(request, socket, head);
			});
			tcp.on("session", (session) => {
				this.#sessions.add(session);
				session.once("close", () => this.#sessions.delete(session));
			});
			tcp.on("connection", (socket) => {
				this.#sockets.add(socket);
				socket.once("close", () => this.#sockets.delete(socket));
			});
			tcp.on("error", (cause) => {
				if (this.#state === "started") {
					this.#reportError(
						new HTTPServerError("ERR_HTTP_TCP_SERVER", "The TCP HTTP server failed", {
							cause,
							operation: "tcp-server",
							protocol: "TCP",
						})
					);
				}
			});

			tcp.listen({ host: config.address, port: config.port ?? 0 });
			await once(tcp, "listening");
			const bound = tcp.address();
			if (bound === null || typeof bound === "string") {
				throw new Error("The TCP server did not expose an IP address and port");
			}
			await this.#http3.start({ ...http3Config, address: bound.address, port: bound.port });
			this.#address = bound.address;
			this.#port = bound.port;
			this.#state = "started";
		} catch (error) {
			this.#state = "stopped";
			await this.#closeTCP(0);
			throw error;
		}
	}

	/** Stops both listeners and drains active work until the grace period expires. */
	stop(options = {}) {
		if (this.#stopPromise) return this.#stopPromise;
		const gracePeriodMs = options.gracePeriodMs ?? 10_000;
		if (!Number.isInteger(gracePeriodMs) || gracePeriodMs < 0) {
			return Promise.reject(new RangeError("gracePeriodMs must be a non-negative integer"));
		}
		this.#state = "stopped";
		this.#address = undefined;
		this.#port = undefined;
		this.#stopPromise = Promise.all([
			this.#http3.stop({ gracePeriodMs }),
			this.#closeTCP(gracePeriodMs),
		]).then(() => undefined);
		return this.#stopPromise;
	}

	async #handleTCPRequest(nodeRequest, nodeResponse) {
		try {
			const request = requestFromNode(nodeRequest);
			const response =
				(await this.#handlers.stream?.(request)) ?? new Response(null, { status: 404 });
			await writeResponseToNode(response, nodeResponse, {
				altSvc: this.#altSvcHeader(),
				method: nodeRequest.method,
			});
		} catch (cause) {
			this.#reportError(
				new HTTPServerError("ERR_HTTP_HANDLER_FAILURE", "HTTP stream handler failed", {
					cause,
					operation: "stream",
					protocol: nodeRequest.httpVersion === "2.0" ? "HTTP/2" : "HTTP/1.1",
				})
			);
			if (!nodeResponse.headersSent) nodeResponse.writeHead(500);
			if (!nodeResponse.destroyed) nodeResponse.end();
		}
	}

	#handleH2WebSocket(stream, headers) {
		const id = randomUUID();
		const transport = streamTransport(stream);
		let socket;
		try {
			socket = this.#createWebSocket(id, "HTTP/2", headers, transport);
			if (!socket) {
				stream.respond({
					":status": typeof this.#handlers.webSocket === "function" ? 403 : 501,
				});
				stream.end();
				return;
			}
			const responseHeaders = { ":status": 200 };
			if (socket.protocol) responseHeaders["sec-websocket-protocol"] = socket.protocol;
			const altSvc = this.#altSvcHeader();
			if (altSvc) responseHeaders["alt-svc"] = altSvc;
			attachWebSocketStream(socket, stream, "aborted", (cause) =>
				this.#reportWebSocketFailure(id, cause, "websocket-receive", "HTTP/2")
			);
			stream.respond(responseHeaders, { endStream: false });
			void socket.accept().catch((cause) => {
				this.#reportWebSocketFailure(id, cause, "websocket-open", "HTTP/2");
				stream.destroy();
			});
		} catch (cause) {
			if (socket) this.#webSockets.delete(socket);
			this.#reportWebSocketFailure(id, cause, "websocket-open", "HTTP/2");
			if (!stream.headersSent) stream.respond({ ":status": 400 });
			stream.end();
		}
	}

	async #handleH1WebSocket(request, rawSocket, head) {
		const id = randomUUID();
		let committed = false;
		let socket;
		try {
			validateH1Handshake(request);
			const headers = {
				...request.headers,
				":scheme": "https",
				":authority": request.headers.host,
				":path": request.url,
			};
			socket = this.#createWebSocket(id, "HTTP/1.1", headers, socketTransport(rawSocket));
			if (!socket) {
				writeH1Response(
					rawSocket,
					typeof this.#handlers.webSocket === "function" ? 403 : 501
				);
				return;
			}
			const key = request.headers["sec-websocket-key"];
			const accept = createHash("sha1").update(`${key}${WEB_SOCKET_GUID}`).digest("base64");
			const responseHeaders = [
				"HTTP/1.1 101 Switching Protocols",
				"Connection: Upgrade",
				"Upgrade: websocket",
				`Sec-WebSocket-Accept: ${accept}`,
			];
			if (socket.protocol) responseHeaders.push(`Sec-WebSocket-Protocol: ${socket.protocol}`);
			const altSvc = this.#altSvcHeader();
			if (altSvc) responseHeaders.push(`Alt-Svc: ${altSvc}`);
			attachWebSocketStream(socket, rawSocket, "close", (cause) =>
				this.#reportWebSocketFailure(id, cause, "websocket-receive", "HTTP/1.1")
			);
			rawSocket.write(`${responseHeaders.join("\r\n")}\r\n\r\n`);
			committed = true;
			await socket.accept();
			if (head.byteLength > 0) await socket.receiveData(head);
		} catch (cause) {
			if (socket) this.#webSockets.delete(socket);
			this.#reportWebSocketFailure(id, cause, "websocket-open", "HTTP/1.1");
			if (committed) rawSocket.destroy();
			else writeH1Response(rawSocket, 400);
		}
	}

	#createWebSocket(id, httpVersion, headers, transport) {
		if (typeof this.#handlers.webSocket !== "function") return undefined;
		const metadata = webSocketMetadata(headers, httpVersion);
		const socket = new WebSocketConnection({
			...metadata,
			id,
			maxMessageBytes: this.#maxWebSocketMessageBytes,
			closeTimeoutMs: this.#webSocketCloseTimeoutMs,
			transport,
			onMessage: (webSocket, data) => this.#handlers.webSocketMessage?.(webSocket, data),
			onClose: async (webSocket, code, reason) => {
				this.#webSockets.delete(webSocket);
				try {
					await this.#handlers.webSocketClose?.(webSocket, code, reason);
				} catch (cause) {
					this.#reportWebSocketFailure(id, cause, "websocket-close");
				}
			},
			onError: (_webSocket, cause) =>
				this.#reportWebSocketFailure(id, cause, "websocket", httpVersion),
		});
		this.#webSockets.add(socket);
		let decision;
		try {
			decision = this.#handlers.webSocket(socket);
		} catch (cause) {
			this.#webSockets.delete(socket);
			throw cause;
		}
		if (decision && typeof decision === "object" && "then" in decision) {
			this.#webSockets.delete(socket);
			throw new TypeError("The WebSocket routing handler must return synchronously");
		}
		if (decision === false) {
			this.#webSockets.delete(socket);
			return undefined;
		}
		const protocol = typeof decision === "string" ? decision : "";
		if (protocol && !socket.offeredProtocols.includes(protocol)) {
			this.#webSockets.delete(socket);
			throw new TypeError(`WebSocket subprotocol was not offered by the client: ${protocol}`);
		}
		socket.selectProtocol(protocol);
		return socket;
	}

	#reportWebSocketFailure(id, cause, operation = "websocket", protocol) {
		this.#reportError(
			new HTTPServerError("ERR_HTTP_HANDLER_FAILURE", "WebSocket handler failed", {
				cause,
				id,
				operation,
				protocol,
			})
		);
	}

	#altSvcHeader() {
		return this.#port === undefined
			? undefined
			: `h3=":${this.#port}"; ma=${this.#altSvcMaxAge}`;
	}

	#reportError(error) {
		const handler = this.#handlers.error;
		if (!handler) return;
		try {
			void Promise.resolve(handler(error)).catch((handlerError) => {
				console.error("HTTP server error handler rejected", handlerError);
			});
		} catch (handlerError) {
			console.error("HTTP server error handler threw", handlerError);
		}
	}

	async #closeTCP(gracePeriodMs) {
		const tcp = this.#tcp;
		if (!tcp) return;
		this.#tcp = undefined;
		const closed = new Promise((resolveClose) => tcp.close(resolveClose));
		for (const session of this.#sessions) session.close();
		if (gracePeriodMs === 0) {
			for (const session of this.#sessions) session.destroy();
			for (const socket of this.#sockets) socket.destroy();
			await closed;
			return;
		}
		let timer;
		const deadline = new Promise((resolveDeadline) => {
			timer = setTimeout(() => {
				for (const session of this.#sessions) session.destroy();
				for (const socket of this.#sockets) socket.destroy();
				resolveDeadline();
			}, gracePeriodMs);
			timer.unref();
		});
		await Promise.race([closed, deadline]);
		clearTimeout(timer);
		await closed;
	}

	#http3 = new HTTP3Server();
	#tcp;
	#handlers = {};
	#address;
	#port;
	#altSvcMaxAge = 3600;
	#maxWebSocketMessageBytes = 16 * 1024 * 1024;
	#webSocketCloseTimeoutMs = 5_000;
	#state = "new";
	#stopPromise;
	#sessions = new Set();
	#sockets = new Set();
	#webSockets = new Set();
	#claimedH2Streams = new WeakSet();
}

function streamTransport(stream) {
	return {
		write: (data) => writeNodeStream(stream, data),
		end: () => endNodeStream(stream),
		abort: () => stream.destroy(),
	};
}

function socketTransport(socket) {
	return {
		write: (data) => writeNodeStream(socket, data),
		end: () => endNodeStream(socket),
		abort: () => socket.destroy(),
	};
}

function attachWebSocketStream(webSocket, stream, abortEvent, onFailure) {
	let delivery = Promise.resolve();
	let failed = false;
	const deliver = (operation) => {
		if (failed) return;
		delivery = delivery.then(operation).catch((cause) => {
			failed = true;
			onFailure(cause);
			stream.destroy();
		});
	};
	stream.on("data", (data) => {
		deliver(() => webSocket.receiveData(data));
	});
	stream.once("end", () => {
		deliver(() => webSocket.receiveEnd("finished"));
	});
	stream.once(abortEvent, () => {
		deliver(() => webSocket.receiveEnd("aborted"));
	});
}

function writeNodeStream(stream, data) {
	return new Promise((resolveWrite, reject) => {
		stream.write(data, (error) => (error ? reject(error) : resolveWrite(true)));
	});
}

function endNodeStream(stream) {
	return new Promise((resolveEnd) => stream.end(resolveEnd));
}

function validateH1Handshake(request) {
	if (request.method !== "GET") throw new TypeError("WebSocket Upgrade requires GET");
	if (!headerIncludes(request.headers.upgrade, "websocket")) {
		throw new TypeError("Missing WebSocket Upgrade header");
	}
	if (!headerIncludes(request.headers.connection, "upgrade")) {
		throw new TypeError("Missing Connection: Upgrade header");
	}
	if (request.headers["sec-websocket-version"] !== "13") {
		throw new TypeError("WebSocket version 13 is required");
	}
	const key = request.headers["sec-websocket-key"];
	if (
		typeof key !== "string" ||
		!/^[A-Za-z0-9+/]{22}==$/.test(key) ||
		Buffer.from(key, "base64").byteLength !== 16
	) {
		throw new TypeError("Invalid Sec-WebSocket-Key header");
	}
}

function headerIncludes(value, token) {
	return (
		typeof value === "string" &&
		value
			.toLowerCase()
			.split(",")
			.some((part) => part.trim() === token)
	);
}

function writeH1Response(socket, status) {
	if (socket.destroyed) return;
	const phrase =
		status === 403 ? "Forbidden" : status === 501 ? "Not Implemented" : "Bad Request";
	socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
