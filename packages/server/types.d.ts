// @ts-check

export namespace http3 {
	type IncomingHeaderValue = string | readonly string[];
	type IncomingHeaders = Readonly<Record<string, IncomingHeaderValue>>;
	type OutgoingHeaders = Record<string, string>;
	type Data = Uint8Array | ArrayBuffer | symbol;

	type ConnectionId = string;
	type StreamId = string;
	type SessionId = string;
	type WebTransportStreamId = string;

	interface ConnectionMetadata {
		version: string;
		alpn: string;
		remoteAddress: string;
		remotePort: number;
	}

	interface Handlers {
		error?: (error: HTTP3ServerError) => void | Promise<void>;
		connection?: (connection: Connection, metadata: ConnectionMetadata) => void | Promise<void>;
		stream?: (stream: Stream) => void | Response | Promise<void | Response>;
		session?: (
			session: WebTransportSession
		) => void | false | Response | Promise<void | false | Response>;
		datagram?: (session: WebTransportSession, data: Uint8Array) => void | Promise<void>;
		webTransportStream?: (stream: WebTransportStream) => void | Promise<void>;
		webTransportData?: (stream: WebTransportStream, data: Uint8Array) => void | Promise<void>;
		webTransportStreamEnd?: (
			stream: WebTransportStream,
			reason: "finished" | "aborted",
			errorCode?: number
		) => void | Promise<void>;
	}

	interface Configuration {
		address?: string;
		certificateFile: string;
		certificateFileCA?: string;
		/** Maximum simultaneously accepted connections. Defaults to 1,024. */
		maxConnections?: number;
		/** Maximum simultaneously accepted application streams per connection. Defaults to 256. */
		maxStreamsPerConnection?: number;
		/** Per-stream QUIC receive-flow-control window in bytes. Defaults to 1 MiB. */
		receiveWindowBytes?: number;
		/** Aggregate QUIC receive-flow-control window per connection. Defaults to 16 MiB. */
		connectionReceiveWindowBytes?: number;
		/** Maximum response bytes queued per request, including the active send. Defaults to 8 MiB. */
		maxQueuedResponseBytes?: number;
		/** Maximum reliable WebTransport bytes outstanding per stream. Defaults to 4 MiB. */
		maxQueuedWebTransportBytes?: number;
		/** Maximum reliable WebTransport sends outstanding per stream. Defaults to 256. */
		maxPendingWebTransportSends?: number;
		/** Maximum application payload accepted by sendDatagram(). Defaults to 1,200 bytes. */
		maxDatagramSize?: number;
		/** Maximum datagrams outstanding across the server. Defaults to 256. */
		maxPendingDatagrams?: number;
		/** Maximum decoded request header fields, including pseudo-headers. Defaults to 128. */
		maxHeaderFields?: number;
		/** Maximum decoded request header name and value bytes. Defaults to 64 KiB. */
		maxHeaderBytes?: number;
		/** Maximum reconstructed request URL length. Defaults to 8 KiB. */
		maxUrlLength?: number;
		/** Maximum time application delivery may hold a receive pending. Defaults to 30 seconds. */
		maxIncompleteBodyMs?: number;
		port?: number;
		privateKeyFile: string;
		webTransport?: boolean;
	}

	interface StopOptions {
		/** Milliseconds to drain active work before aborting it. Defaults to 10,000. */
		gracePeriodMs?: number;
	}

	interface Diagnostics {
		activeConnections: number;
		activeRequests: number;
		pendingResponseSends: number;
		pendingResponseBytes: number;
		activeResponseSends: number;
		activeResponseBytes: number;
		pendingRequestBodyChunks: number;
		pendingRequestBodyBytes: number;
		pendingWebTransportReceiveChunks: number;
		pendingWebTransportReceiveBytes: number;
		pendingDatagramSends: number;
		pendingDatagramBytes: number;
		pendingWebTransportSends: number;
		pendingWebTransportSendBytes: number;
		responseSendQueueRejected: number;
		webTransportSendQueueRejected: number;
		webTransportSendsAccepted: number;
		webTransportSendsFailed: number;
		webTransportSendsCompleted: number;
		webTransportSendsCanceled: number;
		datagramsAccepted: number;
		datagramsRejectedOversize: number;
		datagramsDroppedOverload: number;
		datagramsSendFailed: number;
		datagramsAcknowledged: number;
		datagramsLost: number;
		datagramsCanceled: number;
		receiveTimeouts: number;
		reportedErrors: number;
	}

	type ServerErrorCode =
		| "ERR_HTTP3_DATAGRAM_OVERSIZE"
		| "ERR_HTTP3_DATAGRAM_SEND_REJECTED"
		| "ERR_HTTP3_WEBTRANSPORT_SEND_REJECTED"
		| "ERR_HTTP3_RECEIVE_TIMEOUT"
		| "ERR_HTTP3_RECEIVE_REJECTED"
		| "ERR_HTTP3_HANDLER_FAILURE";

	interface ServerErrorDetails {
		operation?: string;
		id?: Id;
		bytes?: number;
		limit?: number;
		cause?: unknown;
	}

	type Id = ConnectionId | StreamId | SessionId | WebTransportStreamId;

	interface Map<T> extends Iterable<[Id, T]> {
		clear(): void;
		delete(key: Id): boolean;
		get(key: Id): T | undefined;
		has(key: Id): boolean;
		require(key: Id): T;
		set(key: Id, value: T): this;
		values(): IterableIterator<T>;
		readonly size: number;
	}

	interface MapConstructor<T> {
		new (server: HTTP3Server): Map<T> & { server: HTTP3Server };
	}
}

export const fin: unique symbol;

export class HTTP3ServerError extends Error {
	readonly code: http3.ServerErrorCode;
	readonly details: Readonly<http3.ServerErrorDetails>;
	constructor(code: http3.ServerErrorCode, message: string, details?: http3.ServerErrorDetails);
}

export class HTTP3Server {
	readonly connections: http3.Map<Connection> & { readonly server: HTTP3Server };
	readonly address: string | undefined;
	readonly port: number | undefined;
	handle(handlers: http3.Handlers): this;
	sendHeadersFrame(streamId: http3.StreamId, headers: http3.OutgoingHeaders): Promise<boolean>;
	sendDataFrame(streamId: http3.StreamId, data: http3.Data): Promise<boolean>;
	sendDatagram(sessionId: http3.SessionId, data: Uint8Array): boolean;
	sendWebTransportStreamData(
		streamId: http3.WebTransportStreamId,
		data: Uint8Array,
		close?: boolean
	): boolean;
	getDiagnostics(): http3.Diagnostics;
	start(config: http3.Configuration): Promise<void>;
	stop(options?: http3.StopOptions): Promise<void>;
}

export class Connection {
	readonly server: HTTP3Server;
	readonly streams: http3.Map<Stream> & { readonly server: HTTP3Server };
	readonly sessions: http3.Map<WebTransportSession> & { readonly server: HTTP3Server };
	readonly id: http3.ConnectionId;
}

export class Stream extends Request {
	static readonly fin: typeof fin;
	readonly connection: Connection;
	readonly fin: typeof fin;
	readonly id: http3.StreamId;
	readonly protocol: "HTTP/3";
	readonly server: HTTP3Server;
	sendHeaders(...headers: http3.OutgoingHeaders[]): Promise<boolean>;
	sendData(...body: http3.Data[]): Promise<boolean[]>;
}

export class WebTransportSession {
	readonly connection: Connection;
	readonly headers: http3.IncomingHeaders;
	readonly id: http3.SessionId;
	readonly path: string;
	readonly server: HTTP3Server;
	readonly streams: http3.Map<WebTransportStream> & { readonly server: HTTP3Server };
	sendDatagram(data: Uint8Array): boolean;
}

export class WebTransportStream {
	readonly connection: Connection;
	readonly direction: "bidirectional";
	readonly id: http3.WebTransportStreamId;
	readonly session: WebTransportSession;
	send(data: Uint8Array, options?: { fin?: boolean }): boolean;
	close(data?: Uint8Array): boolean;
}
