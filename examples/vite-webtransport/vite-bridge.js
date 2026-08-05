import { Readable, Writable } from "node:stream";

const nullBodyStatuses = new Set([101, 204, 205, 304]);

// Adapts Vite's Connect middleware stack to the fetch-style stream handler.
export function createMiddlewareHandler(middlewares) {
	return (request) =>
		new Promise((resolve, reject) => {
			const url = new URL(request.url);
			const middlewareRequest = createMiddlewareRequest(request, url);
			const middlewareResponse = new MiddlewareResponse();
			middlewareResponse.req = middlewareRequest;
			let settled = false;
			const settle = (callback) => (value) => {
				if (settled) return;
				settled = true;
				callback(value);
			};
			const finish = settle(resolve);
			const fail = settle(reject);

			middlewareResponse.once("finish", () =>
				finish(middlewareResponse.toResponse(request.method))
			);
			middlewareResponse.once("error", fail);
			middlewareResponse.once("close", () => {
				if (!middlewareResponse.writableFinished) {
					fail(new Error(`The response for ${url.pathname} closed before completing`));
				}
			});

			middlewares(middlewareRequest, middlewareResponse, (error) => {
				if (error) {
					fail(error instanceof Error ? error : new Error(String(error)));
					return;
				}
				middlewareResponse.statusCode = 404;
				middlewareResponse.end();
			});
		});
}

function createMiddlewareRequest(request, url) {
	const path = `${url.pathname}${url.search}`;
	const stream = request.body === null ? Readable.from([]) : Readable.fromWeb(request.body);
	return Object.assign(stream, {
		headers: { ...Object.fromEntries(request.headers), host: url.host },
		httpVersion: "1.1",
		method: request.method,
		originalUrl: path,
		socket: { encrypted: true, remoteAddress: "127.0.0.1" },
		url: path,
	});
}

class MiddlewareResponse extends Writable {
	headersSent = false;
	statusCode = 200;
	statusMessage = "";
	#chunks = [];
	#headers = new Map();

	get finished() {
		return this.writableEnded;
	}

	appendHeader(name, value) {
		const key = String(name).toLowerCase();
		const existing = this.#headers.get(key);

		if (existing === undefined) this.#headers.set(key, value);
		else this.#headers.set(key, [existing, value].flat());
		return this;
	}

	getHeader(name) {
		return this.#headers.get(String(name).toLowerCase());
	}

	getHeaderNames() {
		return [...this.#headers.keys()];
	}

	getHeaders() {
		return Object.fromEntries(this.#headers);
	}

	hasHeader(name) {
		return this.#headers.has(String(name).toLowerCase());
	}

	removeHeader(name) {
		this.#headers.delete(String(name).toLowerCase());
	}

	setHeader(name, value) {
		this.#headers.set(String(name).toLowerCase(), value);
		return this;
	}

	writeHead(statusCode, statusMessage, headers) {
		if (typeof statusMessage === "object" && statusMessage !== null) {
			headers = statusMessage;
			statusMessage = undefined;
		}
		this.statusCode = statusCode;
		this.statusMessage = statusMessage ?? "";
		for (const [name, value] of Object.entries(headers ?? {})) {
			if (value !== undefined) this.setHeader(name, value);
		}
		this.headersSent = true;
		return this;
	}

	_write(chunk, encoding, callback) {
		this.headersSent = true;
		this.#chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
		callback();
	}

	toResponse(method) {
		const headers = new Headers();
		for (const [name, value] of this.#headers) {
			for (const entry of Array.isArray(value) ? value : [value])
				headers.append(name, String(entry));
		}
		const body =
			method === "HEAD" || nullBodyStatuses.has(this.statusCode)
				? null
				: Buffer.concat(this.#chunks);
		return new Response(body, { headers, status: this.statusCode });
	}
}
