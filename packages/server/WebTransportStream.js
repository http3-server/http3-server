// @ts-check
/// <reference types="./types.d.ts" />

/** A client-created bidirectional WebTransport stream. */
export class WebTransportStream {
	constructor(session, id) {
		this.#session = session;
		this.#id = id;
	}

	/** Connection that owns this stream. */
	get connection() {
		return this.#session.connection;
	}

	/** Stream direction supported by the initial implementation. */
	get direction() {
		return "bidirectional";
	}

	/** Unique native stream identifier. */
	get id() {
		return this.#id;
	}

	/** WebTransport session that owns this stream. */
	get session() {
		return this.#session;
	}

	/** Queues reliable bytes, optionally closing the local send side. */
	send(data, options = {}) {
		return this.#session.server.sendWebTransportStreamData(
			this.#id,
			data,
			options.fin === true
		);
	}

	/** Gracefully closes the local send side, optionally after final bytes. */
	close(data = new Uint8Array()) {
		return this.send(data, { fin: true });
	}

	#id;
	#session;
}
