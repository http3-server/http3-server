import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const hopByHopHeaders = new Set([
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
]);
const nullBodyStatuses = new Set([101, 204, 205, 304]);

export function requestFromNode(nodeRequest) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(nodeRequest.headers)) {
		if (name.startsWith(":") || hopByHopHeaders.has(name) || value === undefined) continue;
		for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
	}

	const authority = nodeRequest.headers[":authority"] ?? nodeRequest.headers.host;
	if (typeof authority !== "string" || authority.length === 0) {
		throw new TypeError("Request is missing a valid authority or host header");
	}
	const method = nodeRequest.method;
	if (typeof method !== "string" || method.length === 0) {
		throw new TypeError("Request is missing a valid method");
	}
	const path = nodeRequest.url;
	if (typeof path !== "string" || !path.startsWith("/")) {
		throw new TypeError("Request is missing a valid path");
	}

	const abortController = new AbortController();
	if (nodeRequest.aborted) abortController.abort(createAbortError());
	else nodeRequest.once("aborted", () => abortController.abort(createAbortError()));
	const init = { headers, method, signal: abortController.signal };
	if (method !== "GET" && method !== "HEAD") {
		init.body = Readable.toWeb(nodeRequest);
		init.duplex = "half";
	}
	const request = new Request(`https://${authority}${path}`, init);
	Object.defineProperty(request, "protocol", {
		enumerable: true,
		value: nodeRequest.httpVersion === "2.0" ? "HTTP/2" : "HTTP/1.1",
	});
	return request;
}

export async function writeResponseToNode(response, nodeResponse, options = {}) {
	if (!(response instanceof Response)) {
		throw new TypeError("The stream handler must return a Response or undefined");
	}
	const headers = {};
	const setCookies =
		typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
	for (const [name, value] of response.headers) {
		if (hopByHopHeaders.has(name) || (name === "set-cookie" && setCookies.length > 0)) continue;
		headers[name] = value;
	}
	if (setCookies.length > 0) headers["set-cookie"] = setCookies;
	if (options.altSvc) headers["alt-svc"] = options.altSvc;

	nodeResponse.writeHead(response.status, headers);
	if (
		response.body === null ||
		options.method === "HEAD" ||
		nullBodyStatuses.has(response.status)
	) {
		await response.body?.cancel();
		nodeResponse.end();
		return;
	}
	await pipeline(Readable.fromWeb(response.body), nodeResponse);
}

function createAbortError() {
	const error = new Error("The HTTP client aborted the request");
	error.name = "AbortError";
	return error;
}
