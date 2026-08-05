import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureTrustedDevelopmentCertificate } from "@http3-server/dev-certificates/node/trusted";
import { HTTPServer } from "@http3-server/server";
import { createServer } from "vite";
import { createMiddlewareHandler } from "./vite-bridge.js";

const directory = dirname(fileURLToPath(import.meta.url));
const hostname = "localhost";
const port = 4433;
const origin = `https://${hostname}:${port}`;
const certificate = await ensureTrustedDevelopmentCertificate({
	directory: join(homedir(), ".http3-server"),
	dnsNames: [hostname],
	ipAddresses: ["127.0.0.1", "::1"],
});
const server = new HTTPServer();

await server.start({
	address: "127.0.0.1",
	port,
	certificateFile: certificate.certificateFile,
	enableHTTP2ConnectProtocol: false,
	privateKeyFile: certificate.privateKeyFile,
});

let vite;
try {
	vite = await createServer({
		configFile: false,
		root: directory,
		server: {
			allowedHosts: [hostname],
			middlewareMode: { server: server.tcpServer },
			ws: {
				clientPort: port,
				host: hostname,
				protocol: "wss",
				server: server.tcpServer,
			},
		},
	});
} catch (error) {
	await server.stop({ gracePeriodMs: 0 });
	throw error;
}

server.handle({
	error(error) {
		console.error(error);
	},
	stream: createMiddlewareHandler(vite.middlewares),
	session(session) {
		if (session.path !== "/game" || session.headers.origin !== origin) return false;
	},
	datagram(session, data) {
		session.sendDatagram(data);
	},
	webTransportData(stream, data) {
		stream.send(data);
	},
	webTransportStreamEnd(stream, reason) {
		if (reason === "finished") stream.close();
	},
});

console.log(`App: ${origin}/`);
console.log(`HTTP/2 and HTTP/1.1: 127.0.0.1:${port}/tcp`);
console.log(`HTTP/3 and WebTransport: 127.0.0.1:${port}/udp`);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await Promise.all([vite.close(), server.stop({ gracePeriodMs: 1_000 })]);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
