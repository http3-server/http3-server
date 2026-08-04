import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Vite WebTransport example builds without writing output", async () => {
	const output = await build({
		root: join(projectRoot, "examples/vite-webtransport"),
		logLevel: "silent",
		define: {
			"globalThis.__HTTP3_CONFIG__": JSON.stringify({
				certificateHash: Array.from({ length: 32 }, () => 0),
				url: "https://127.0.0.1:4433/game",
			}),
		},
		build: { write: false },
	});
	assert.ok(output);
});
