// @ts-check
/// <reference types="./types.d.ts" />

import { HTTP3NativeServer } from "@http3-server/native"
import { Connection } from "./Connection.js";
import { Stream, fin } from "./Stream.js";
import { mapOf } from "./mapOf.js";

/** HTTP/3 server. */
export class HTTP3Server {
	constructor() {
		this.#native.onConnectionReceived(async (id, version, alpn, remoteAddress, remotePort) => {
			if (this.#connections.has(id)) {
				throw new Error(`Connection ${id} already exists`);
			}

			this.#connections.set(id, new Connection(this, id));
		});

		this.#native.onHeadersFrameReceived(async (id, connectionId, headers) => {
			const connection = this.#connections.get(connectionId);

			await this.#handlers.connection?.(connection);

			if (connection.streams.has(id)) {
				throw new Error(`Stream ${id} already exists`);
			}

			const stream = new Stream(connection, id, headers);

			connection.streams.set(id, stream);

			const response = await this.#handlers.stream?.(stream);

			if (response instanceof Response) {
				// Send headers frame first
				/** @type {http3.Headers} */
				const headers = {};
				headers[':status'] = response.status.toString();

				// Add response headers
				for (const [key, value] of response.headers) {
					headers[key] = value;
				}

				this.sendHeadersFrame(id, headers);

				// Send body data frame with FIN flag
				const responseText = await response.text();
				
				if (responseText) {
					const encoder = new TextEncoder();
					const bodyData = encoder.encode(responseText);
					
					// Send data with FIN flag in a single frame
					this.#native.sendDataFrame(id, bodyData, true);
				} else {
					// Send empty frame with FIN flag if no body
					this.#native.sendDataFrame(id, undefined, true);
				}
			}
		});

		this.#native.onDataFrameReceived(async (id, connectionId, data) => {
			const connection = this.#connections.get(connectionId);
			const stream = connection.streams.get(id);

			stream.sendData(data);
		});
	}

	#native = new HTTP3NativeServer();

	/** @type {http3.Handlers} */
	#handlers = {};

	/** @type {InstanceType<typeof Connections>} */
	#connections = new Connections(this);

	/** Sends a HEADERS frame to the given stream id with the given headers. */
	sendHeadersFrame(/** @type {http3.Stream.Id} */ streamId, /** @type {http3.Headers} */ headers) {
		this.#native.sendHeadersFrame(streamId, headers);
	}

	/** Sends a DATA frame to the given stream id with the given data. */
	sendDataFrame(/** @type {http3.Stream.Id} */ streamId, /** @type {http3.Data} */ data) {
		if (typeof data === "symbol") {
			if (data === fin) {
				this.#native.sendDataFrame(streamId, undefined, true);
			}
		} else {
			this.#native.sendDataFrame(streamId, data, false);
		}
	}

	/** Starts the server. */
	start(/** @type {http3.Configuration} */ config) {
		this.#native.start(config);
	}

	/**
	 * Stops the server gracefully.
	 * @returns {Promise<void>} Promise that resolves when the server has completely stopped
	 */
	stop() {
		return new Promise((resolve, reject) => {
			try {
				this.#native.stop(() => {
					resolve();
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	/** Assigns handlers for server events. */
	handle(/** @type {http3.Handlers} */ handlers) {
		this.#handlers = Object(handlers);
	}

	/** Connections belonging to this server indexed by connection ID. */
	get connections() {
		return this.#connections;
	}
}

/** @type {http3.MapConstructor<http3.Connection>} */
const Connections = mapOf("Connection");
