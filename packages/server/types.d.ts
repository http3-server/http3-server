// types.d.ts
// @ts-check

namespace http3 {
	type Headers = Record<string, string>;

	type Data = Uint8Array | symbol;

	namespace Connection {
		type Id = string;
	}

	namespace Stream {
		type Id = string;
	}

	interface Handlers {
		/** Callback run when a connection is established. */
		connection?: (connection: Connection) => void | Promise<void>;

		/** Callback run when an incoming request stream is received. */
		stream?: (stream: Stream) => void | Response | Promise<void | Response>;
	}

	interface Configuration {
		/** Path to the certificate file in PEM format. */
		certificateFile: string;

		/** Path to a PEM file containing trusted CA certs. */
		certificateFileCA?: string;

		/** Port to listen on. */
		port: number;

		/** Path to the private key file. */
		privateKeyFile: string;
	}

	type Connection = import("./Connection.js").Connection;
	type Fin = typeof import("./Stream.js")["fin"];
	type HTTP3Server = import("./HTTP3Server.js").HTTP3Server;
	type Stream = import("./Stream.js").Stream;

	type Id = Connection.Id | Stream.Id;

	interface Map<T> {
		clear(): void;
		delete(key: Id): boolean;
		get(key: Id): T;
		has(key: Id): boolean;
		set(key: Id, value: T): this;
		readonly size: number;
	};

	interface MapConstructor<T> {
		new (readonly server: HTTP3Server): Map<T>;
	};
}
