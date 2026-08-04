import { HTTP3Server } from "../HTTP3Server.js";

const server = new HTTP3Server();

server.handle({
	connection(connection) {
		console.log("connection", connection.id);
	},
	stream(stream) {
		stream.sendHeaders({
			":status": 103,
			link: "</style.css>; rel=preload; as=style",
		});

		stream.sendHeaders({
			":status": 200,
			"content-type": "text/html",
		});

		stream.sendData(
			new TextEncoder().encode("<!doctype html><h1>Hello World</h1>"),
			stream.fin
		);
	},
});

server.start({
	certificateFile: "localhost.pem",
	port: 4433,
	privateKeyFile: "localhost-key.pem",
});

console.log("Server started");
