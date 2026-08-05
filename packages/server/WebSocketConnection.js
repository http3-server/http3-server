// @ts-check
/// <reference types="./types.d.ts" />

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

/** A transport-neutral server-side WebSocket. */
export class WebSocketConnection {
	static CONNECTING = 0;
	static OPEN = OPEN;
	static CLOSING = CLOSING;
	static CLOSED = CLOSED;

	/** @internal */
	constructor(options) {
		this.#id = options.id;
		this.#httpVersion = options.httpVersion;
		this.#url = options.url;
		this.#headers = options.headers;
		this.#offeredProtocols = Object.freeze([...options.offeredProtocols]);
		this.#transport = options.transport;
		this.#maxMessageBytes = options.maxMessageBytes;
		this.#closeTimeoutMs = options.closeTimeoutMs;
		this.#onMessage = options.onMessage;
		this.#onClose = options.onClose;
		this.#onError = options.onError;
	}

	get id() {
		return this.#id;
	}

	get httpVersion() {
		return this.#httpVersion;
	}

	get url() {
		return this.#url;
	}

	get path() {
		return new URL(this.#url).pathname;
	}

	get headers() {
		return this.#headers;
	}

	get offeredProtocols() {
		return this.#offeredProtocols;
	}

	get protocol() {
		return this.#protocol;
	}

	get extensions() {
		return "";
	}

	get readyState() {
		return this.#readyState;
	}

	/** Sends one text or binary WebSocket message. */
	async send(data) {
		if (this.#readyState !== OPEN) throw new Error("WebSocket is not open");
		const binary = typeof data !== "string";
		const bytes = binary ? toUint8Array(data) : textEncoder.encode(data);
		if (bytes.byteLength > this.#maxMessageBytes) {
			throw new RangeError(
				`WebSocket message exceeds the ${this.#maxMessageBytes}-byte limit`
			);
		}
		return this.#writeFrame(binary ? 0x2 : 0x1, bytes);
	}

	/** Starts an orderly WebSocket close handshake. */
	async close(code = 1000, reason = "") {
		if (this.#readyState === CLOSED || this.#sentClose) return false;
		validateCloseCode(code);
		if (typeof reason !== "string")
			throw new TypeError("WebSocket close reason must be a string");
		const reasonBytes = textEncoder.encode(reason);
		if (reasonBytes.byteLength > 123) {
			throw new RangeError("WebSocket close reason cannot exceed 123 UTF-8 bytes");
		}
		const payload = new Uint8Array(2 + reasonBytes.byteLength);
		new DataView(payload.buffer).setUint16(0, code);
		payload.set(reasonBytes, 2);
		this.#sentClose = true;
		this.#readyState = CLOSING;
		const sent = await this.#writeFrame(0x8, payload);
		if (this.#receivedClose) await this.#finishTransport();
		else this.#armCloseTimer();
		return sent;
	}

	/** @internal Completes the opening handshake. */
	async accept(protocol = this.#protocol) {
		if (this.#readyState !== WebSocketConnection.CONNECTING) return;
		this.selectProtocol(protocol);
		this.#readyState = OPEN;
		if (this.#pendingInput.byteLength > 0) {
			const pending = this.#pendingInput;
			this.#pendingInput = new Uint8Array();
			await this.receiveData(pending);
		}
	}

	/** @internal Selects a subprotocol before the opening response is sent. */
	selectProtocol(protocol = "") {
		if (protocol && !this.#offeredProtocols.includes(protocol)) {
			throw new TypeError(`WebSocket subprotocol was not offered by the client: ${protocol}`);
		}
		this.#protocol = protocol;
	}

	/** @internal Delivers WebSocket wire bytes from a transport. */
	async receiveData(data) {
		if (this.#readyState === CLOSED) return;
		const bytes = toUint8Array(data);
		if (this.#readyState === WebSocketConnection.CONNECTING) {
			this.#pendingInput = concat(this.#pendingInput, bytes);
			if (this.#pendingInput.byteLength > this.#maxMessageBytes + 14) {
				await this.#protocolFailure(
					new RangeError("WebSocket input exceeded its limit"),
					1009
				);
			}
			return;
		}
		this.#buffer = concat(this.#buffer, bytes);
		while (await this.#readFrame()) {
			// Consume every complete frame before releasing transport backpressure.
		}
	}

	/** @internal Delivers transport FIN or abort. */
	async receiveEnd(reason = "finished") {
		if (this.#readyState === CLOSED) return;
		if (this.#buffer.byteLength > 0) {
			await this.#protocolFailure(
				new Error("WebSocket transport ended inside a frame"),
				1002
			);
			return;
		}
		const clean = reason === "finished" && this.#receivedClose;
		if (!clean) this.#transport.abort();
		await this.#finish(clean ? this.#closeCode : 1006, this.#closeReason);
	}

	async #readFrame() {
		if (this.#buffer.byteLength < 2) return false;
		const first = this.#buffer[0];
		const second = this.#buffer[1];
		const fin = (first & 0x80) !== 0;
		const opcode = first & 0x0f;
		if ((first & 0x70) !== 0) {
			await this.#protocolFailure(new Error("Unsupported WebSocket RSV bits"), 1002);
			return false;
		}
		if ((second & 0x80) === 0) {
			await this.#protocolFailure(new Error("Client WebSocket frames must be masked"), 1002);
			return false;
		}

		let offset = 2;
		let payloadLength = second & 0x7f;
		if (payloadLength === 126) {
			if (this.#buffer.byteLength < 4) return false;
			payloadLength = new DataView(
				this.#buffer.buffer,
				this.#buffer.byteOffset + 2,
				2
			).getUint16(0);
			if (payloadLength < 126) {
				await this.#protocolFailure(new Error("Non-minimal WebSocket frame length"), 1002);
				return false;
			}
			offset = 4;
		} else if (payloadLength === 127) {
			if (this.#buffer.byteLength < 10) return false;
			if ((this.#buffer[2] & 0x80) !== 0) {
				await this.#protocolFailure(new Error("Invalid WebSocket frame length"), 1002);
				return false;
			}
			const length = new DataView(
				this.#buffer.buffer,
				this.#buffer.byteOffset + 2,
				8
			).getBigUint64(0);
			if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
				await this.#protocolFailure(
					new RangeError("WebSocket frame length is too large"),
					1009
				);
				return false;
			}
			payloadLength = Number(length);
			if (payloadLength <= 0xffff) {
				await this.#protocolFailure(new Error("Non-minimal WebSocket frame length"), 1002);
				return false;
			}
			offset = 10;
		}

		const control = opcode >= 0x8;
		if ((control && (!fin || payloadLength > 125)) || payloadLength > this.#maxMessageBytes) {
			await this.#protocolFailure(
				new RangeError(
					control ? "Invalid WebSocket control frame" : "WebSocket frame is too large"
				),
				control ? 1002 : 1009
			);
			return false;
		}
		if (this.#buffer.byteLength < offset + 4 + payloadLength) return false;
		const mask = this.#buffer.subarray(offset, offset + 4);
		offset += 4;
		const payload = this.#buffer.slice(offset, offset + payloadLength);
		for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
		this.#buffer = this.#buffer.slice(offset + payloadLength);
		await this.#handleFrame(fin, opcode, payload);
		return this.#readyState !== CLOSED;
	}

	async #handleFrame(fin, opcode, payload) {
		if (opcode === 0x8) {
			await this.#receiveClose(payload);
			return;
		}
		if (opcode === 0x9) {
			await this.#writeFrame(0xa, payload);
			return;
		}
		if (opcode === 0xa) return;
		if (opcode !== 0 && opcode !== 0x1 && opcode !== 0x2) {
			await this.#protocolFailure(new Error(`Unsupported WebSocket opcode: ${opcode}`), 1002);
			return;
		}
		if (opcode === 0 && this.#fragmentOpcode === 0) {
			await this.#protocolFailure(new Error("Unexpected WebSocket continuation frame"), 1002);
			return;
		}
		if (opcode !== 0 && this.#fragmentOpcode !== 0) {
			await this.#protocolFailure(
				new Error("A fragmented WebSocket message is incomplete"),
				1002
			);
			return;
		}

		if (!fin) {
			if (opcode !== 0) this.#fragmentOpcode = opcode;
			this.#fragmentBytes += payload.byteLength;
			if (this.#fragmentBytes > this.#maxMessageBytes) {
				await this.#protocolFailure(new RangeError("WebSocket message is too large"), 1009);
				return;
			}
			this.#fragments.push(payload);
			return;
		}

		const messageOpcode = opcode === 0 ? this.#fragmentOpcode : opcode;
		if (this.#fragmentBytes + payload.byteLength > this.#maxMessageBytes) {
			await this.#protocolFailure(new RangeError("WebSocket message is too large"), 1009);
			return;
		}
		const message =
			this.#fragments.length === 0 ? payload : concat(...this.#fragments, payload);
		this.#fragments = [];
		this.#fragmentOpcode = 0;
		this.#fragmentBytes = 0;
		try {
			await this.#onMessage(
				this,
				messageOpcode === 0x1 ? fatalTextDecoder.decode(message) : message
			);
		} catch (cause) {
			await this.#onError(this, cause);
			await this.close(1011, "Handler failed");
		}
	}

	async #receiveClose(payload) {
		let code = 1005;
		let reason = "";
		try {
			if (payload.byteLength === 1) throw new Error("Invalid WebSocket close payload");
			if (payload.byteLength >= 2) {
				code = new DataView(payload.buffer, payload.byteOffset, 2).getUint16(0);
				validateCloseCode(code);
				reason = fatalTextDecoder.decode(payload.subarray(2));
			}
		} catch (cause) {
			await this.#protocolFailure(cause, 1002);
			return;
		}
		this.#receivedClose = true;
		this.#closeCode = code;
		this.#closeReason = reason;
		if (!this.#sentClose) {
			this.#sentClose = true;
			this.#readyState = CLOSING;
			await this.#writeFrame(0x8, payload);
		}
		await this.#finishTransport();
		await this.#finish(code, reason);
	}

	async #protocolFailure(cause, code) {
		await this.#onError(this, cause);
		if (!this.#sentClose && this.#readyState !== CLOSED) {
			try {
				await this.close(code, code === 1009 ? "Message too large" : "Protocol error");
			} catch {
				// Transport shutdown below is authoritative.
			}
		}
		await this.#finishTransport();
		await this.#finish(1006, "");
	}

	#writeFrame(opcode, payload) {
		const frame = encodeFrame(opcode, payload);
		const write = this.#writeQueue.then(() => this.#transport.write(frame));
		this.#writeQueue = write.then(
			() => undefined,
			() => undefined
		);
		return write;
	}

	async #finishTransport() {
		clearTimeout(this.#closeTimer);
		try {
			await this.#writeQueue;
			await this.#transport.end();
		} catch {
			this.#transport.abort();
		}
	}

	#armCloseTimer() {
		clearTimeout(this.#closeTimer);
		this.#closeTimer = setTimeout(() => {
			this.#transport.abort();
			void this.#finish(1006, "");
		}, this.#closeTimeoutMs);
		this.#closeTimer.unref?.();
	}

	async #finish(code, reason) {
		if (this.#readyState === CLOSED) return;
		clearTimeout(this.#closeTimer);
		this.#readyState = CLOSED;
		await this.#onClose(this, code, reason);
	}

	#id;
	#httpVersion;
	#url;
	#headers;
	#offeredProtocols;
	#transport;
	#maxMessageBytes;
	#closeTimeoutMs;
	#onMessage;
	#onClose;
	#onError;
	#readyState = WebSocketConnection.CONNECTING;
	#protocol = "";
	#buffer = new Uint8Array();
	#pendingInput = new Uint8Array();
	#fragments = [];
	#fragmentOpcode = 0;
	#fragmentBytes = 0;
	#sentClose = false;
	#receivedClose = false;
	#closeCode = 1006;
	#closeReason = "";
	#closeTimer;
	#writeQueue = Promise.resolve();
}

/** @internal */
export function webSocketMetadata(headers, httpVersion) {
	const scheme = header(headers, ":scheme") ?? "https";
	const webSocketScheme = scheme === "https" ? "wss" : scheme === "http" ? "ws" : undefined;
	const authority = header(headers, ":authority") ?? header(headers, "host");
	const path = header(headers, ":path") ?? "/";
	if (!webSocketScheme || !authority || !path.startsWith("/")) {
		throw new TypeError("Invalid WebSocket target");
	}
	const regularHeaders = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (name.startsWith(":")) continue;
		for (const entry of Array.isArray(value) ? value : [value])
			regularHeaders.append(name, entry);
	}
	if (regularHeaders.get("sec-websocket-version") !== "13") {
		throw new TypeError("WebSocket version 13 is required");
	}
	const offeredProtocols = parseProtocols(regularHeaders.get("sec-websocket-protocol"));
	return {
		headers: regularHeaders,
		httpVersion,
		offeredProtocols,
		url: `${webSocketScheme}://${authority}${path}`,
	};
}

function parseProtocols(value) {
	if (!value) return [];
	const protocols = value.split(",").map((entry) => entry.trim());
	if (
		protocols.some((protocol) => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(protocol)) ||
		new Set(protocols).size !== protocols.length
	) {
		throw new TypeError("Invalid Sec-WebSocket-Protocol header");
	}
	return protocols;
}

function header(headers, name) {
	const value = headers[name];
	return Array.isArray(value) ? value[0] : value;
}

function encodeFrame(opcode, payload) {
	let headerLength = 2;
	if (payload.byteLength >= 126 && payload.byteLength <= 0xffff) headerLength = 4;
	else if (payload.byteLength > 0xffff) headerLength = 10;
	const frame = new Uint8Array(headerLength + payload.byteLength);
	frame[0] = 0x80 | opcode;
	if (headerLength === 2) frame[1] = payload.byteLength;
	else if (headerLength === 4) {
		frame[1] = 126;
		new DataView(frame.buffer).setUint16(2, payload.byteLength);
	} else {
		frame[1] = 127;
		new DataView(frame.buffer).setBigUint64(2, BigInt(payload.byteLength));
	}
	frame.set(payload, headerLength);
	return frame;
}

function validateCloseCode(code) {
	if (
		!Number.isInteger(code) ||
		code < 1000 ||
		code >= 5000 ||
		(code >= 1016 && code < 3000) ||
		[1004, 1005, 1006, 1015].includes(code)
	) {
		throw new RangeError(`Invalid WebSocket close code: ${code}`);
	}
}

function toUint8Array(data) {
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	throw new TypeError("WebSocket binary data must be an ArrayBuffer or ArrayBufferView");
}

function concat(...parts) {
	const length = parts.reduce((total, part) => total + part.byteLength, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}
