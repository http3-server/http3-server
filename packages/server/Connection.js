// @ts-check
/// <reference types="./types.d.ts" />

import { mapOf } from "./mapOf.js";

/** HTTP/3 connection. */
export class Connection {
	constructor(
		/** @type {http3.HTTP3Server} */
		server,
		/** @type {http3.Connection.Id} */
		id
	) {
		this.#streams = new Streams(server);
		this.#server = server;
		this.#id = id;
	}

	/** Server that owns this connection. */
	get server() {
		return this.#server;
	}

	/** Streams belonging to this connection indexed by stream ID. */
	get streams() {
		return this.#streams;
	}

	/** Unique ID for this stream. */
	get id() {
		return this.#id;
	}

	/** @type {http3.HTTP3Server} */
	#server;

	/** @type {InstanceType<typeof Streams>} */
	#streams;

	/** @type {http3.Connection.Id} */
	#id;
}

/** @type {http3.MapConstructor<http3.Stream>} */
const Streams = mapOf("Stream");
