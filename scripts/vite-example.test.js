import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createMiddlewareHandler } from "../examples/vite-webtransport/vite-bridge.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Vite WebTransport example builds without writing output", async () => {
	const output = await build({
		root: join(projectRoot, "examples/vite-webtransport"),
		logLevel: "silent",
		build: { write: false },
	});
	assert.ok(output);
});

test("Vite bridge exposes the request and completion state", async () => {
	let middlewareRequest;
	let middlewareResponse;
	const handle = createMiddlewareHandler((request, response) => {
		middlewareRequest = request;
		middlewareResponse = response;
		assert.equal(response.req, request);
		assert.equal(response.finished, false);
		response.end();
	});

	await handle(new Request("https://example.test/"));

	assert.equal(middlewareResponse.req, middlewareRequest);
	assert.equal(middlewareResponse.finished, true);
});

test("Vite bridge collects repeated headers appended by middleware", async () => {
	const handle = createMiddlewareHandler((_request, response) => {
		response.appendHeader("Vary", "Origin");
		response.appendHeader("Vary", "Accept");
		response.end();
	});
	const response = await handle(new Request("https://example.test/"));

	assert.equal(response.headers.get("vary"), "Origin, Accept");
});
