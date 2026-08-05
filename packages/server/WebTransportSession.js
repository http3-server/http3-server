// @ts-check
/// <reference types="./types.d.ts" />

import { mapOf } from "./internal/mapOf.js";

/** @type {http3.MapConstructor<http3.WebTransportStream>} */
const WebTransportStreams = mapOf("WebTransportStream");

/** A WebTransport session accepted on an extended CONNECT request. */
export class WebTransportSession {
	constructor(connection, id, headers) {
		this.#connection = connection;
		this.#id = id;
		this.#headers = Object.freeze(
			Object.fromEntries(
				Object.entries(headers).map(([name, value]) => [
					name,
					Array.isArray(value) ? Object.freeze([...value]) : value,
				])
			)
		);
		this.#streams = new WebTransportStreams(connection.server);
	}

	/** Connection that owns this session. */
	get connection() {
		return this.#connection;
	}

	/** Extended CONNECT request headers. */
	get headers() {
		return this.#headers;
	}

	/** Unique native session identifier. */
	get id() {
		return this.#id;
	}

	/** Request path used to establish the session. */
	get path() {
		const path = this.#headers[":path"];
		return typeof path === "string" ? path : "/";
	}

	/** Server that owns this session. */
	get server() {
		return this.#connection.server;
	}

	/** Client-created streams belonging to this session. */
	get streams() {
		return this.#streams;
	}

	/** Queues an unreliable WebTransport datagram. */
	sendDatagram(data) {
		return this.server.sendDatagram(this.id, data);
	}

	#connection;
	#headers;
	#id;
	#streams;
}
