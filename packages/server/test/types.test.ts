import { HTTP3Server as NativeHTTP3Server } from "@http3-server/native";
import {
	type Connection,
	fin,
	HTTP3Server,
	type HTTP3ServerError,
	HTTPServer,
	type HTTPServerError,
	type Stream,
	type WebSocketConnection,
	type WebTransportSession,
	type WebTransportStream,
} from "@http3-server/server";

const server = new HTTP3Server().handle({
	error(error: HTTP3ServerError) {
		const code: string = error.code;
		void code;
	},
	connection(connection: Connection) {
		const maybeStream: Stream | undefined = connection.streams.get("missing");
		void maybeStream;
	},
	stream(stream: Stream) {
		void stream.sendHeaders({ ":status": "103", link: "</style.css>; rel=preload" });
		void stream.sendData(new Uint8Array([1]), fin);
		return new Response("ok");
	},
	session(session: WebTransportSession) {
		const header: string | readonly string[] | undefined = session.headers["x-example"];
		void header;
		return undefined;
	},
	webTransportStream(stream: WebTransportStream) {
		stream.send(new Uint8Array([1]));
	},
	webSocket(socket: WebSocketConnection) {
		return socket.offeredProtocols.includes("echo") ? "echo" : false;
	},
	async webSocketMessage(socket, data) {
		const protocol: "HTTP/1.1" | "HTTP/2" | "HTTP/3" = socket.httpVersion;
		void protocol;
		await socket.send(data);
	},
});

const started: Promise<void> = server.start({
	certificateFile: "certificate.pem",
	privateKeyFile: "private-key.pem",
	maxHeaderFields: 128,
	maxHeaderBytes: 64 * 1024,
	maxUrlLength: 8 * 1024,
});
void started;

const native = new NativeHTTP3Server();
native.start({
	certificateFile: "certificate.pem",
	privateKeyFile: "private-key.pem",
});
type NativeStartIsVoid = ReturnType<NativeHTTP3Server["start"]> extends void ? true : false;
const nativeStartIsVoid: NativeStartIsVoid = true;
void nativeStartIsVoid;
native.handleRequest((_id, _connectionId, headers) => {
	const value: string | readonly string[] | undefined = headers["x-example"];
	void value;
});
void native.sendHeaders("1", 200, [["content-type", "text/plain"]], true);

const fallback = new HTTPServer().handle({
	error(error: HTTPServerError | HTTP3ServerError) {
		const code: string = error.code;
		void code;
	},
	stream(request) {
		const protocol: "HTTP/1.1" | "HTTP/2" | "HTTP/3" = request.protocol;
		void protocol;
		return new Response(request.url);
	},
	session(session) {
		return session.path === "/game" ? undefined : false;
	},
	webSocket(socket) {
		return socket.path === "/socket";
	},
});
void fallback.start({
	address: "127.0.0.1",
	port: 0,
	certificateFile: "certificate.pem",
	privateKeyFile: "private-key.pem",
	altSvcMaxAge: 3600,
	enableHTTP2ConnectProtocol: false,
	maxWebSocketMessageBytes: 1024 * 1024,
	webSocketCloseTimeoutMs: 1000,
});
