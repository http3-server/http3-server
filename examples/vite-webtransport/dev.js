import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDevelopmentCertificate } from "@http3-server/dev-certificates/node";
import { HTTP3Server } from "@http3-server/server";
import { createServer } from "vite";

const directory = dirname(fileURLToPath(import.meta.url));
const pageOrigin = "http://127.0.0.1:5173";
const certificate = await ensureDevelopmentCertificate({
	directory: join(directory, ".http3-server"),
});
const http3 = new HTTP3Server().handle({
	error(error) {
		console.error(error);
	},
	session(session) {
		if (session.path !== "/game" || session.headers.origin !== pageOrigin) return false;
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

await http3.start({
	address: "127.0.0.1",
	port: 4433,
	certificateFile: certificate.certificateFile,
	privateKeyFile: certificate.privateKeyFile,
});

const vite = await createServer({
	root: directory,
	define: {
		"globalThis.__HTTP3_CONFIG__": JSON.stringify({
			certificateHash: [...certificate.certificateHash],
			url: `https://127.0.0.1:${http3.port}/game`,
		}),
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
	},
});

try {
	await vite.listen();
	vite.printUrls();
	console.log(`WebTransport server: https://127.0.0.1:${http3.port}/game`);
} catch (error) {
	await http3.stop({ gracePeriodMs: 0 });
	throw error;
}

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await Promise.all([vite.close(), http3.stop({ gracePeriodMs: 1_000 })]);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
