export class HTTP3NativeServer {
	/** Called when a new connection is established. */
	onConnectionReceived(callback: Request.Callbacks.Connection): void;

	/** Called when a HEADERS frame is received. */
	onHeadersFrameReceived(callback: Request.Callbacks.HeadersFrame): void;

	/** Called when a DATA frame is received. */
	onDataFrameReceived(callback: Request.Callbacks.DataFrame): void;

	/** Sends a HEADERs frame to a client. */
	sendHeadersFrame(id: Stream.Id, headers: Headers): void;

	/** Sends a DATA frame to a client. */
	sendDataFrame(id: Stream.Id, data: Uint8Array | undefined, fin: boolean): void;

	/** Starts the server. */
	start(config: Configuration): void;

	/** Stops the server. */
	stop(callback: () => void): void;
}

export namespace Request {
	export namespace Callbacks {
		export type Connection = (
			connectionId: Connection.Id,
			version: string,
			alpn: string,
			remoteAddress: string,
			remotePort: string
		) => Awaited<void>;

		export type HeadersFrame = (
			streamId: Stream.Id,
			connectionId: Connection.Id,
			headers: Headers
		) => Awaited<void>;

		export type DataFrame = (
			streamId: Stream.Id,
			connectionId: Connection.Id,
			data: Uint8Array
		) => Awaited<void>;
	}
}

export namespace Connection {
	export type Id = string;
}

export namespace Stream {
	export type Id = string;
}

export interface Configuration {
	/** Path to the certificate file in PEM format. */
	certificateFile: string;

	/** Path to a PEM file containing trusted CA certs. */
	certificateFileCA?: string;

	/** Port to listen on. */
	port: number;

	/** Path to the private key file. */
	privateKeyFile: string;
}

export type Headers = Record<string, string>;