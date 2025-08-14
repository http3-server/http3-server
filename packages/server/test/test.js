import { HTTP3Server } from "../HTTP3Server.js";

const server = new HTTP3Server();

server.handle({
	connection(connection) {
		console.log(connection);
	},
	stream(stream) {
		stream.sendHeaders({
			':status': '103',
			'link': '</style.css>;rel=preload;as=style',
		});

		return new Response("<h1>Hello World</h1>", {
			headers: {
				'content-type': 'text/html',
			},
		});
	},
});

server.start({
	certificateFile: "cert.pem",
	certificateFileCA: "cert.pem",
	port: 4433,
	privateKeyFile: "key.pem",
});
