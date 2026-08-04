// @ts-check
/// <reference types="./types.d.ts" />

/**
 * Symbol used to indicate the end of a stream.
 */
export const fin = Symbol.for("http3.stream.fin");

/** HTTP/3 stream. */
export class Stream extends Request {
	/** Symbol used to indicate the end of a stream. */
	static fin = fin;

	constructor(
		/**
		 * Connection that owns this stream.
		 * @type {http3.Connection}
		 */
		connection,
		/**
		 * Unique ID for this stream.
		 * @type {http3.Stream.Id}
		 */
		id,
		/**
		 * Headers for this stream.
		 * @type {http3.IncomingHeaders}
		 */
		headers
	) {
		const { readable, writable } = new TransformStream();
		const abortController = new AbortController();

		const scheme = requirePseudoHeader(headers, ":scheme");
		const authority = requirePseudoHeader(headers, ":authority");
		const path = requirePseudoHeader(headers, ":path");
		const method = requirePseudoHeader(headers, ":method");
		const url = `${scheme}://${authority}${path}`;

		// Filter out pseudo-headers for the Request constructor
		const requestHeaders = new Headers();

		for (const [name, value] of Object.entries(headers)) {
			if (!name.startsWith(":")) {
				for (const item of Array.isArray(value) ? value : [value]) {
					requestHeaders.append(name, item);
				}
			}
		}

		super(url, {
			method: method,
			headers: requestHeaders,
			body: method === "GET" || method === "HEAD" ? null : readable,
			duplex: "half",
			signal: abortController.signal,
		});

		this.#connection = connection;
		this.#id = id;
		this.#writer = writable.getWriter();
		this.#abortController = abortController;
	}

	[Symbol.for("nodejs.util.inspect.custom")](
		/** @type {number} */
		depth,

		/** @type {import("node:util").InspectOptionsStylized} */
		options,

		/** @type {import("node:util")["inspect"]} */
		inspect
	) {
		return `HTTP3Stream ${inspect(
			{
				method: this.method,
				url: this.url,
				headers: this.headers,
				destination: this.destination,
				referrer: this.referrer,
				referrerPolicy: this.referrerPolicy,
				mode: this.mode,
				credentials: this.credentials,
				cache: this.cache,
				redirect: this.redirect,
				integrity: this.integrity,
				keepalive: this.keepalive,
				signal: this.signal,
			},
			{
				depth: Number.isNaN(Number(depth)) ? 2 : Number(depth),
				...options,
			}
		)}`;
	}

	/** @type {http3.Connection} */
	#connection;

	/** @type {http3.Stream.Id} */
	#id;

	/** @type {WritableStreamDefaultWriter<Uint8Array>} */
	#writer;

	/** @type {AbortController} */
	#abortController;

	#receiveEnded = false;

	/** Connection that owns this stream. */
	get connection() {
		return this.#connection;
	}

	/** Symbol used to indicate the end of a stream. */
	get fin() {
		return fin;
	}

	/** Unique ID for this stream. */
	get id() {
		return this.#id;
	}

	/** Protocol used for this stream. */
	get protocol() {
		return "HTTP/3";
	}

	/** Server that owns this stream. */
	get server() {
		return this.#connection.server;
	}

	/** Sends headers to this stream. */
	sendHeaders(/** @type {http3.OutgoingHeaders[]} */ ...headers) {
		return this.server.sendHeadersFrame(this.id, Object.assign({}, ...headers));
	}

	/** Sends data to this stream. */
	sendData(/** @type {http3.Data[]} */ ...body) {
		const sends = [];
		for (const data of body) {
			if (typeof data === "symbol") {
				sends.push(this.server.sendDataFrame(this.id, fin));
			} else if (data) {
				sends.push(this.server.sendDataFrame(this.id, data));
			}
		}
		return Promise.all(sends);
	}

	/** @internal Delivers bytes received from the peer into the Request body. */
	receiveData(data) {
		return this.#writer.write(data);
	}

	/** @internal Closes the Request body after the peer finishes sending. */
	receiveEnd(reason = "finished", errorCode) {
		if (this.#receiveEnded) return Promise.resolve();
		this.#receiveEnded = true;
		if (reason === "finished") return this.#writer.close();

		const error = new Error(
			errorCode === undefined
				? "The HTTP/3 peer aborted the request body"
				: `The HTTP/3 peer aborted the request body with error code ${errorCode}`
		);
		error.name = "AbortError";
		this.#abortController.abort(error);
		return this.#writer.abort(error);
	}
}

function requirePseudoHeader(headers, name) {
	const value = headers[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`Request is missing a valid ${name} pseudo-header`);
	}
	return value;
}
