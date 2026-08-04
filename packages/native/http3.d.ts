export class HTTP3Server {
	/** Called when the server starts listening. */
	handleStart(callback: HTTP3Server.ServerStartCallback): void;

	/** Called when the server stops listening. */
	handleStop(callback: HTTP3Server.ServerStopCallback): void;

	/** Called when a new connection is established. */
	handleConnection(callback: HTTP3Server.ConnectionCallback): void;

	/** Called when an existing connection is closed. */
	handleConnectionEnd(callback: HTTP3Server.ConnectionEndCallback): void;

	/** Called when a client request starts (when headers including :path are available). */
	handleRequest(callback: HTTP3Server.RequestCallback): void;

	/** Called when a client request ends. */
	handleRequestEnd(callback: HTTP3Server.RequestEndCallback): void;

	/** Called when a DATA frame is received. */
	handleData(callback: HTTP3Server.DataCallback): void;

	/** Called when a WebTransport CONNECT request is ready for application validation. */
	handleSession(callback: HTTP3Server.SessionCallback): void;

	/** Called when a WebTransport datagram is received. */
	handleDatagram(callback: HTTP3Server.DatagramCallback): void;

	/** Called when a client-created bidirectional WebTransport stream opens. */
	handleWebTransportStream(callback: HTTP3Server.WebTransportStreamCallback): void;

	/** Called when data is received on a WebTransport stream. */
	handleWebTransportStreamData(callback: HTTP3Server.WebTransportStreamDataCallback): void;

	/** Called when the peer finishes or aborts a WebTransport stream. */
	handleWebTransportStreamEnd(callback: HTTP3Server.WebTransportStreamEndCallback): void;

	/** Sends a HEADERS frame of 103 Early Hints to the client. */
	sendEarlyHints(
		id: HTTP3Server.Stream.Id,
		headers: HTTP3Server.OutgoingHeaders
	): Promise<boolean>;

	/** Sends a HEADERS frame to a client. */
	sendHeaders(
		id: HTTP3Server.Stream.Id,
		status: number,
		headers: HTTP3Server.OutgoingHeaders,
		fin?: boolean
	): Promise<boolean>;

	/** Sends a DATA frame to a client. */
	sendData(
		id: HTTP3Server.Stream.Id,
		data?: HTTP3Server.Stream.Body,
		fin?: boolean
	): Promise<boolean>;

	/** Queues an unreliable datagram for a WebTransport session. */
	sendDatagram(id: HTTP3Server.Session.Id, data: HTTP3Server.Stream.Body): boolean;

	/** Queues reliable bytes on a client-created bidirectional WebTransport stream. */
	sendWebTransportStreamData(
		id: HTTP3Server.WebTransportStream.Id,
		data: HTTP3Server.Stream.Body,
		fin?: boolean
	): boolean;

	/** Completes one pending request-body or WebTransport delivery after its data callback returns. */
	completeReceive(
		id: HTTP3Server.Stream.Id | HTTP3Server.WebTransportStream.Id,
		byteLength: number,
		accepted?: boolean
	): boolean;

	/** Returns a point-in-time snapshot of native resource ownership. */
	getDiagnostics(): HTTP3Server.Diagnostics;

	/** Sends a HEADERS frame of trailing headers to a client. */
	sendTrailers(id: HTTP3Server.Stream.Id, headers: HTTP3Server.OutgoingHeaders): Promise<boolean>;

	/** Starts the server. */
	start(config: HTTP3Server.Configuration): void;

	/** Stops the server after active work drains or the grace period expires. */
	stop(options?: HTTP3Server.StopOptions): Promise<void>;
}

export namespace HTTP3Server {
	/** Called when the server starts listening. */
	export type ServerStartCallback = (
		id: Server.Id,
		address: string,
		port: number
	) => Awaited<void>;

	/** Called when the server stops listening. */
	export type ServerStopCallback = (id: Server.Id) => Awaited<void>;

	/** Called when a new connection is opens. */
	export type ConnectionCallback = (
		id: Connection.Id,
		version: string,
		alpn: string,
		remoteAddress: string,
		remotePort: number
	) => Awaited<void>;

	/** Called when a new connection closes. */
	export type ConnectionEndCallback =
		| ((
				id: Connection.Id,
				reason: "transport",
				status: number,
				errorCode: number
		  ) => Awaited<void>)
		| ((id: Connection.Id, reason: "peer", errorCode: number) => Awaited<void>);

	/** Called when a request starts (when headers including :path are available). */
	export type RequestCallback = (
		id: Stream.Id,
		connectionId: Connection.Id,
		headers: IncomingHeaders
	) => Awaited<void>;

	export type RequestEndCallback =
		| ((id: Stream.Id, reason: "finished") => Awaited<void>)
		| ((id: Stream.Id, reason: "aborted", errorCode: number) => Awaited<void>);

	/** Called when a DATA frame completes. */
	export type DataCallback = (
		id: Stream.Id,
		connectionId: Connection.Id,
		data: Uint8Array
	) => void;

	export type SessionCallback = (
		id: Session.Id,
		connectionId: Connection.Id,
		headers: IncomingHeaders
	) => Awaited<void>;

	export type DatagramCallback = (id: Session.Id, data: Uint8Array) => void;

	export type WebTransportStreamCallback = (
		id: WebTransportStream.Id,
		sessionId: Session.Id,
		connectionId: Connection.Id,
		direction: "bidirectional"
	) => Awaited<void>;

	export type WebTransportStreamDataCallback = (
		id: WebTransportStream.Id,
		data: Uint8Array
	) => void;

	export type WebTransportStreamEndCallback =
		| ((id: WebTransportStream.Id, reason: "finished") => Awaited<void>)
		| ((id: WebTransportStream.Id, reason: "aborted", errorCode: number) => Awaited<void>);

	export namespace Server {
		export type Id = string;
	}

	export namespace Connection {
		export type Id = string;
	}

	export namespace Stream {
		export type Body = Uint8Array | ArrayBuffer;

		export type Id = string;
	}

	export namespace Session {
		export type Id = string;
	}

	export namespace WebTransportStream {
		export type Id = string;
	}

	export interface Configuration {
		/** Address to listen on. */
		address?: string;

		/** Path to the certificate file in PEM format. */
		certificateFile: string;

		/** Path to a PEM file containing trusted CA certs. */
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

		/** Port to listen on. */
		port?: number;

		/** Enables WebTransport negotiation, datagrams, and client-created bidirectional streams. */
		webTransport?: boolean;

		/** Path to the private key file. */
		privateKeyFile: string;
	}

	export interface StopOptions {
		/** Milliseconds to drain active work before aborting it. Defaults to 10,000. */
		gracePeriodMs?: number;
	}

	export interface Diagnostics {
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
	}

	export type IncomingHeaderValue = string | readonly string[];
	export type IncomingHeaders = Readonly<Record<string, IncomingHeaderValue>>;
	export type HeaderTuple = readonly [name: string, value: string];
	export type OutgoingHeaders = readonly HeaderTuple[];
}
