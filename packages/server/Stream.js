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
		 * @type {http3.Headers}
		 */
		headers
	) {
		const { readable, writable } = new TransformStream()

		// Construct full URL from headers
		const scheme = headers[':scheme'] || 'https';
		const authority = headers[':authority'] || 'localhost:4433';
		const path = headers[':path'] || '/';
		const url = `${scheme}://${authority}${path}`;

		// Filter out pseudo-headers for the Request constructor
		/** @type {Record<string, string>} */
		const requestHeaders = {};

		for (const [name, value] of Object.entries(headers)) {
			if (!name.startsWith(':')) {
				requestHeaders[name] = value;
			}
		}

		const method = headers[':method'] ?? "GET";

		super(url, {
			method: method,
			headers: requestHeaders,
			body: (method === 'GET' || method === 'HEAD') ? null : readable,
		});

		this.#connection = connection;
		this.#id = id;
		this.#writer = writable.getWriter();
	}

	[Symbol.for('nodejs.util.inspect.custom')](
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
				depth: isNaN(depth) ? 2 : Number(depth),
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
		return 'HTTP/3';
	}

	/** Server that owns this stream. */
	get server() {
		return this.#connection.server;
	}

	/** Sends headers to this stream. */
	sendHeaders(/** @type {http3.Headers[]} */ ...headers) {
		this.server.sendHeadersFrame(this.id, Object.assign({}, ...headers));
	}

	/** Sends data to this stream. */
	sendData(/** @type {http3.Data[]} */ ...body) {
		for (const data of body) {
			if (typeof data === "symbol") {
				this.#writer.close();

				this.server.sendDataFrame(this.id, fin);
			} else if (data) {
				this.#writer.write(data);

				this.server.sendDataFrame(this.id, data);
			}
		}
	}
}

