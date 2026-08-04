// @ts-check
/// <reference types="./types.d.ts" />

import { HTTP3Server as HTTP3NativeServer } from "@http3-server/native";
import { Connection } from "./Connection.js";
import { mapOf } from "./mapOf.js";
import { fin, Stream } from "./Stream.js";
import { WebTransportSession } from "./WebTransportSession.js";
import { WebTransportStream } from "./WebTransportStream.js";

/** @type {http3.MapConstructor<http3.Connection>} */
const Connections = mapOf("Connection");

/** Error reported through the server's non-recursive error hook. */
export class HTTP3ServerError extends Error {
	/**
	 * @param {http3.ServerErrorCode} code
	 * @param {string} message
	 * @param {http3.ServerErrorDetails} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "HTTP3ServerError";
		this.code = code;
		this.details = Object.freeze({ ...details });
		if ("cause" in details) this.cause = details.cause;
	}
}

/** HTTP/3 and WebTransport server. */
export class HTTP3Server {
	constructor() {
		this.#native.handleStart((_id, address, port) => {
			this.#address = address;
			this.#port = port;
			this.#resolveStart?.();
			this.#resolveStart = undefined;
			this.#rejectStart = undefined;
		});

		this.#native.handleStop(() => {
			this.#address = undefined;
			this.#port = undefined;
			for (const connection of this.#connections.values()) {
				connection.streams.clear();
				connection.sessions.clear();
			}
			this.#connections.clear();
			this.#streams.clear();
			this.#sessions.clear();
			this.#webTransportStreams.clear();
			this.#cancelAllResponses(new Error("HTTP/3 server stopped"));
			for (const timer of this.#receiveTimers.values()) clearTimeout(timer);
			this.#receiveTimers.clear();
		});

		this.#native.handleConnection((id, version, alpn, remoteAddress, remotePort) => {
			if (this.#connections.has(id)) {
				this.#reportHandlerFailure(
					"connection",
					id,
					new Error(`Connection ${id} already exists`)
				);
				return;
			}
			const connection = new Connection(this, id);
			this.#connections.set(id, connection);
			this.#invokeHandler("connection", id, () =>
				this.#handlers.connection?.(connection, {
					version,
					alpn,
					remoteAddress,
					remotePort,
				})
			);
		});

		this.#native.handleConnectionEnd((id) => {
			const connection = this.#connections.get(id);
			if (connection) {
				for (const stream of connection.streams.values()) this.#streams.delete(stream.id);
				for (const session of connection.sessions.values()) {
					for (const stream of session.streams.values()) {
						this.#webTransportStreams.delete(stream.id);
					}
					this.#sessions.delete(session.id);
				}
			}
			this.#cancelResponsesForConnection(id, new Error("HTTP/3 connection closed"));
			this.#connections.delete(id);
		});

		this.#native.handleRequest((id, connectionId, headers) => {
			const connection = this.#connections.get(connectionId);
			if (!connection) return;
			if (connection.streams.has(id)) {
				this.#reportHandlerFailure("request", id, new Error(`Stream ${id} already exists`));
				return;
			}

			try {
				const stream = new Stream(connection, id, headers);
				connection.streams.set(id, stream);
				this.#streams.set(id, stream);
				void this.#handleRequest(stream);
			} catch (cause) {
				void this.#native.sendHeaders(id, 400, [], true);
				this.#reportHandlerFailure("request", id, cause);
			}
		});

		this.#native.handleRequestEnd((id, reason, errorCode) => {
			this.#clearReceiveTimer(id);
			const session = this.#sessions.get(id);
			if (session) {
				if (reason === "aborted")
					this.#cancelResponse(id, createAbortError("WebTransport session", errorCode));
				this.#deleteSession(session);
				return;
			}
			const stream = this.#streams.get(id);
			if (stream) {
				void stream.receiveEnd(reason, errorCode).catch(() => {
					// A concurrent body consumer may already have canceled the stream.
				});
				stream.connection.streams.delete(id);
				this.#streams.delete(id);
			}
			if (reason === "aborted")
				this.#cancelResponse(id, createAbortError("HTTP/3 request", errorCode));
		});

		this.#native.handleData((id, connectionId, data) => {
			const stream = this.#streams.get(id);
			if (!stream || stream.connection.id !== connectionId) {
				this.#native.completeReceive(id, data.byteLength, false);
				return;
			}
			this.#deliverReceive(
				id,
				data.byteLength,
				() => stream.receiveData(data),
				"request-body"
			);
		});

		this.#native.handleSession((id, connectionId, headers) => {
			const connection = this.#connections.get(connectionId);
			if (!connection) return;
			if (typeof this.#handlers.session !== "function") {
				void this.#native.sendHeaders(id, 403, [], true);
				return;
			}

			// This first implementation deliberately supports one WebTransport
			// session per QUIC connection, which keeps stream/datagram routing exact.
			if (connection.sessions.size > 0) {
				void this.#native.sendHeaders(id, 429, [], true);
				return;
			}

			const session = new WebTransportSession(connection, id, headers);
			connection.sessions.set(id, session);
			this.#sessions.set(id, session);
			const negotiationHeaders =
				headers["sec-webtransport-http3-draft02"] === "1"
					? [["sec-webtransport-http3-draft02", "1"]]
					: [];

			void this.#handleSession(session, negotiationHeaders);
		});

		this.#native.handleDatagram((sessionId, data) => {
			const session = this.#sessions.get(sessionId);
			if (session) {
				this.#invokeHandler("datagram", sessionId, () =>
					this.#handlers.datagram?.(session, data)
				);
			}
		});

		this.#native.handleWebTransportStream((id, sessionId) => {
			const session = this.#sessions.get(sessionId);
			if (!session) return;
			const stream = new WebTransportStream(session, id);
			session.streams.set(id, stream);
			this.#webTransportStreams.set(id, stream);
			queueMicrotask(() =>
				this.#invokeHandler("webtransport-stream", id, () =>
					this.#handlers.webTransportStream?.(stream)
				)
			);
		});

		this.#native.handleWebTransportStreamData((id, data) => {
			const stream = this.#webTransportStreams.get(id);
			if (!stream) {
				this.#native.completeReceive(id, data.byteLength, false);
				return;
			}
			this.#deliverReceive(
				id,
				data.byteLength,
				() => this.#handlers.webTransportData?.(stream, data),
				"webtransport-receive"
			);
		});

		this.#native.handleWebTransportStreamEnd((id, reason, errorCode) => {
			this.#clearReceiveTimer(id);
			const stream = this.#webTransportStreams.get(id);
			if (!stream) return;
			this.#webTransportStreams.delete(id);
			stream.session.streams.delete(id);
			this.#invokeHandler("webtransport-stream-end", id, () =>
				this.#handlers.webTransportStreamEnd?.(stream, reason, errorCode)
			);
		});
	}

	/** Connections belonging to this server indexed by connection ID. */
	get connections() {
		return this.#connections;
	}

	/** Bound listener address, available after start resolves. */
	get address() {
		return this.#address;
	}

	/** Bound listener port, available after start resolves. */
	get port() {
		return this.#port;
	}

	/** Replaces the event handlers used by this server. */
	handle(handlers) {
		this.#handlers = Object(handlers);
		return this;
	}

	/** Sends a HEADERS frame; retained for the original HTTP/3 API. */
	sendHeadersFrame(streamId, headers) {
		const { ":status": status = "200", ...regularHeaders } = headers;
		return Number(status) === 103
			? this.#native.sendEarlyHints(streamId, Object.entries(regularHeaders))
			: this.#native.sendHeaders(
					streamId,
					Number(status),
					Object.entries(regularHeaders),
					false
				);
	}

	/** Sends a DATA frame; the fin symbol closes the local send side. */
	sendDataFrame(streamId, data) {
		if (data === fin) return this.#native.sendData(streamId, undefined, true);
		if (typeof data === "symbol") return Promise.resolve(false);
		return this.#native.sendData(streamId, data, false);
	}

	/** Queues an unreliable datagram for a WebTransport session. */
	sendDatagram(sessionId, data) {
		const sent = this.#native.sendDatagram(sessionId, data);
		if (!sent) {
			const bytes = data.byteLength;
			const oversize = bytes > this.#maxDatagramSize;
			this.#reportError(
				new HTTP3ServerError(
					oversize ? "ERR_HTTP3_DATAGRAM_OVERSIZE" : "ERR_HTTP3_DATAGRAM_SEND_REJECTED",
					oversize
						? `Datagram payload exceeds the ${this.#maxDatagramSize}-byte limit`
						: "Datagram was rejected because the session is unavailable or the send queue is full",
					{
						operation: "send-datagram",
						id: sessionId,
						bytes,
						limit: this.#maxDatagramSize,
					}
				)
			);
		}
		return sent;
	}

	/** Queues reliable bytes on a client-created bidirectional WebTransport stream. */
	sendWebTransportStreamData(streamId, data, close = false) {
		const sent = this.#native.sendWebTransportStreamData(streamId, data, close);
		if (!sent) {
			this.#reportError(
				new HTTP3ServerError(
					"ERR_HTTP3_WEBTRANSPORT_SEND_REJECTED",
					"Reliable WebTransport send was rejected because the stream is unavailable or its queue limit was reached",
					{ operation: "send-webtransport", id: streamId, bytes: data.byteLength }
				)
			);
		}
		return sent;
	}

	/** Returns a point-in-time snapshot of native resource ownership.
	 * @returns {http3.Diagnostics}
	 */
	getDiagnostics() {
		return {
			...this.#native.getDiagnostics(),
			receiveTimeouts: this.#receiveTimeouts,
			reportedErrors: this.#reportedErrors,
		};
	}

	/** Starts the UDP HTTP/3 listener. WebTransport is enabled by default. */
	start(config) {
		if (this.#resolveStart) return Promise.reject(new Error("Server start is already pending"));

		const started = new Promise((resolve, reject) => {
			this.#resolveStart = resolve;
			this.#rejectStart = reject;
		});

		try {
			const { maxIncompleteBodyMs = 30_000, ...nativeConfig } = config;
			if (
				!Number.isInteger(maxIncompleteBodyMs) ||
				maxIncompleteBodyMs < 1 ||
				maxIncompleteBodyMs > 2 ** 32 - 1
			) {
				throw new TypeError(
					"maxIncompleteBodyMs must be a positive integer no greater than 2^32 - 1"
				);
			}
			this.#maxIncompleteBodyMs = maxIncompleteBodyMs;
			this.#maxDatagramSize = nativeConfig.maxDatagramSize ?? 1200;
			this.#native.start({ webTransport: true, ...nativeConfig });
		} catch (error) {
			this.#rejectStart?.(error);
			this.#resolveStart = undefined;
			this.#rejectStart = undefined;
		}

		return started;
	}

	/** Stops the server after active work drains or the grace period expires.
	 * @param {http3.StopOptions} [options]
	 */
	stop(options) {
		return this.#native.stop(options);
	}

	async #handleRequest(stream) {
		try {
			const response = await this.#handlers.stream?.(stream);
			if (response instanceof Response)
				await this.#sendResponse(stream.id, stream.connection.id, response);
		} catch (cause) {
			this.#reportHandlerFailure("request", stream.id, cause);
			if (!this.#responseCommitted.has(stream.id)) {
				try {
					await this.#native.sendHeaders(stream.id, 500, [], true);
				} catch {
					// The native request may already be closed.
				}
			}
		} finally {
			this.#responseCommitted.delete(stream.id);
		}
	}

	async #sendResponse(id, connectionId, response) {
		const headers = responseHeaderTuples(response.headers);
		if (response.body === null) {
			const accepted = await this.#native.sendHeaders(id, response.status, headers, true);
			if (!accepted) throw new Error("Native HTTP/3 response headers were rejected");
			this.#responseCommitted.add(id);
			return;
		}

		const reader = response.body.getReader();
		this.#responseReaders.set(id, { connectionId, reader });
		try {
			const accepted = await this.#native.sendHeaders(id, response.status, headers, false);
			if (!accepted) throw new Error("Native HTTP/3 response headers were rejected");
			this.#responseCommitted.add(id);

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!(value instanceof Uint8Array)) {
					throw new TypeError("Response body streams must yield Uint8Array chunks");
				}
				if (value.byteLength > 0 && !(await this.#native.sendData(id, value, false))) {
					throw new Error("Native HTTP/3 response data was rejected");
				}
			}
			if (!(await this.#native.sendData(id, undefined, true))) {
				throw new Error("Native HTTP/3 response FIN was rejected");
			}
		} catch (cause) {
			try {
				await reader.cancel(cause);
			} catch {
				// Cancellation is best effort after a transport failure.
			}
			throw cause;
		} finally {
			if (this.#responseReaders.get(id)?.reader === reader) this.#responseReaders.delete(id);
			reader.releaseLock();
		}
	}

	async #handleSession(session, negotiationHeaders) {
		try {
			const decision = await this.#handlers.session(session);
			await this.#applySessionDecision(session, negotiationHeaders, decision);
		} catch (error) {
			await this.#rejectSession(session, error);
		}
	}

	async #applySessionDecision(session, negotiationHeaders, decision) {
		const id = session.id;
		if (decision === false) {
			await this.#native.sendHeaders(id, 403, [], true);
			this.#deleteSession(session);
			return;
		}
		if (decision instanceof Response) {
			if (!decision.ok) {
				await this.#sendResponse(id, session.connection.id, decision);
				this.#deleteSession(session);
				return;
			}
			const accepted = await this.#native.sendHeaders(
				id,
				decision.status,
				[...negotiationHeaders, ...responseHeaderTuples(decision.headers)],
				false
			);
			if (!accepted) throw new Error("Native WebTransport response headers were rejected");
			this.#responseCommitted.add(id);
			return;
		}
		const accepted = await this.#native.sendHeaders(id, 200, negotiationHeaders, false);
		if (!accepted) throw new Error("Native WebTransport response headers were rejected");
		this.#responseCommitted.add(id);
	}

	async #rejectSession(session, error) {
		if (!this.#responseCommitted.has(session.id)) {
			try {
				await this.#native.sendHeaders(session.id, 500, [], true);
			} catch {
				// The native CONNECT request may already be closed.
			}
		}
		this.#deleteSession(session);
		this.#reportHandlerFailure("webtransport-session", session.id, error);
	}

	#deleteSession(session) {
		for (const stream of session.streams.values()) {
			this.#webTransportStreams.delete(stream.id);
		}
		this.#sessions.delete(session.id);
		this.#responseCommitted.delete(session.id);
		session.connection.sessions.delete(session.id);
	}

	#deliverReceive(id, byteLength, deliver, operation) {
		const timer = setTimeout(() => {
			if (this.#receiveTimers.get(id) !== timer) return;
			this.#receiveTimers.delete(id);
			this.#receiveTimeouts += 1;
			this.#native.completeReceive(id, byteLength, false);
			this.#reportError(
				new HTTP3ServerError(
					"ERR_HTTP3_RECEIVE_TIMEOUT",
					`Application delivery did not complete within ${this.#maxIncompleteBodyMs} ms`,
					{ operation, id, bytes: byteLength, limit: this.#maxIncompleteBodyMs }
				)
			);
		}, this.#maxIncompleteBodyMs);
		timer.unref?.();
		this.#receiveTimers.set(id, timer);

		let delivery;
		try {
			delivery = deliver();
		} catch (cause) {
			this.#finishReceive(id, byteLength, timer, false, operation, cause);
			return;
		}
		void Promise.resolve(delivery).then(
			() => this.#finishReceive(id, byteLength, timer, true, operation),
			(cause) => this.#finishReceive(id, byteLength, timer, false, operation, cause)
		);
	}

	#finishReceive(id, byteLength, timer, accepted, operation, cause) {
		if (this.#receiveTimers.get(id) !== timer) return;
		clearTimeout(timer);
		this.#receiveTimers.delete(id);
		this.#native.completeReceive(id, byteLength, accepted);
		if (!accepted) {
			this.#reportError(
				new HTTP3ServerError(
					"ERR_HTTP3_RECEIVE_REJECTED",
					"Application delivery rejected received data",
					{ operation, id, bytes: byteLength, cause }
				)
			);
		}
	}

	#clearReceiveTimer(id) {
		const timer = this.#receiveTimers.get(id);
		if (timer) clearTimeout(timer);
		this.#receiveTimers.delete(id);
	}

	#invokeHandler(operation, id, invoke) {
		let result;
		try {
			result = invoke();
		} catch (cause) {
			this.#reportHandlerFailure(operation, id, cause);
			return;
		}
		void Promise.resolve(result).catch((cause) =>
			this.#reportHandlerFailure(operation, id, cause)
		);
	}

	#cancelResponse(id, reason) {
		const active = this.#responseReaders.get(id);
		if (!active) return;
		this.#responseReaders.delete(id);
		void active.reader.cancel(reason).catch(() => {
			// Cancellation is best effort after the native stream closes.
		});
	}

	#cancelResponsesForConnection(connectionId, reason) {
		for (const [id, active] of this.#responseReaders) {
			if (active.connectionId === connectionId) this.#cancelResponse(id, reason);
		}
	}

	#cancelAllResponses(reason) {
		for (const id of this.#responseReaders.keys()) this.#cancelResponse(id, reason);
	}

	#reportError(error) {
		this.#reportedErrors += 1;
		const handler = this.#handlers.error;
		if (!handler) return;
		try {
			void Promise.resolve(handler(error)).catch((handlerError) => {
				console.error("HTTP3 server error handler rejected", handlerError);
			});
		} catch (handlerError) {
			console.error("HTTP3 server error handler threw", handlerError);
		}
	}

	#reportHandlerFailure(operation, id, cause) {
		this.#reportError(
			new HTTP3ServerError("ERR_HTTP3_HANDLER_FAILURE", "Server event handler failed", {
				operation,
				id,
				cause,
			})
		);
	}

	#native = new HTTP3NativeServer();
	#address;
	#port;
	#resolveStart;
	#rejectStart;
	#handlers = {};
	#maxIncompleteBodyMs = 30_000;
	#maxDatagramSize = 1200;
	#receiveTimers = new Map();
	#receiveTimeouts = 0;
	#reportedErrors = 0;
	#connections = new Connections(this);
	#streams = new Map();
	#sessions = new Map();
	#webTransportStreams = new Map();
	#responseReaders = new Map();
	#responseCommitted = new Set();
}

function responseHeaderTuples(headers) {
	const tuples = [];
	const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
	for (const [name, value] of headers) {
		if (name === "set-cookie" && setCookies.length > 0) continue;
		tuples.push([name, value]);
	}
	for (const value of setCookies) tuples.push(["set-cookie", value]);
	return tuples;
}

function createAbortError(subject, errorCode) {
	const error = new Error(
		errorCode === undefined
			? `${subject} was aborted`
			: `${subject} was aborted with error code ${errorCode}`
	);
	error.name = "AbortError";
	return error;
}

export { Connection, fin, Stream, WebTransportSession, WebTransportStream };
