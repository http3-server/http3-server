const config = globalThis.__HTTP3_CONFIG__;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const connectButton = document.querySelector("#connect");
const status = document.querySelector("#status");
const log = document.querySelector("#log");
let transport;

function writeLog(message) {
	log.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${log.textContent}`;
}

function setConnected(connected) {
	status.textContent = connected ? "Connected" : "Not connected";
	status.dataset.state = connected ? "connected" : "idle";
	connectButton.textContent = connected ? "Disconnect" : "Connect";
	for (const button of document.querySelectorAll("form button")) button.disabled = !connected;
}

async function readDatagrams(activeTransport) {
	const reader = activeTransport.datagrams.readable.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			writeLog(`datagram echo: ${decoder.decode(value)}`);
		}
	} finally {
		reader.releaseLock();
	}
}

async function connect() {
	if (transport) {
		transport.close({ closeCode: 0, reason: "user disconnected" });
		return;
	}
	connectButton.disabled = true;
	status.textContent = "Connecting…";
	try {
		const activeTransport = new WebTransport(config.url, {
			serverCertificateHashes: [
				{
					algorithm: "sha-256",
					value: new Uint8Array(config.certificateHash),
				},
			],
		});
		await activeTransport.ready;
		transport = activeTransport;
		setConnected(true);
		writeLog(`connected to ${config.url}`);
		void readDatagrams(activeTransport).catch((error) => {
			if (transport === activeTransport) {
				writeLog(error instanceof Error ? error.message : String(error));
			}
		});
		void activeTransport.closed.then(
			() => {
				if (transport !== activeTransport) return;
				transport = undefined;
				setConnected(false);
				writeLog("connection closed");
			},
			(error) => {
				if (transport !== activeTransport) return;
				transport = undefined;
				setConnected(false);
				writeLog(error instanceof Error ? error.message : String(error));
			}
		);
	} catch (error) {
		status.textContent = "Connection failed";
		writeLog(error instanceof Error ? error.message : String(error));
	} finally {
		connectButton.disabled = false;
	}
}

connectButton.addEventListener("click", connect);

document.querySelector("#datagram").addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!transport) return;
	const message = String(new FormData(event.currentTarget).get("message") ?? "");
	const writer = transport.datagrams.writable.getWriter();
	try {
		await writer.write(encoder.encode(message));
		writeLog(`sent datagram: ${message}`);
	} catch (error) {
		writeLog(error instanceof Error ? error.message : String(error));
	} finally {
		writer.releaseLock();
	}
});

document.querySelector("#stream").addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!transport) return;
	const message = String(new FormData(event.currentTarget).get("message") ?? "");
	try {
		const stream = await transport.createBidirectionalStream();
		const writer = stream.writable.getWriter();
		await writer.write(encoder.encode(message));
		await writer.close();
		const response = await new Response(stream.readable).text();
		writeLog(`stream echo: ${response}`);
	} catch (error) {
		writeLog(error instanceof Error ? error.message : String(error));
	}
});

setConnected(false);
