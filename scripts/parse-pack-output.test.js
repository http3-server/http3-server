import assert from "node:assert/strict";
import test from "node:test";
import { parsePackOutput } from "./parse-pack-output.js";

const packed = {
	id: "@http3-server/server@0.3.2",
	name: "@http3-server/server",
	version: "0.3.2",
};

test("normalizes npm pack array output", () => {
	assert.deepEqual(parsePackOutput(JSON.stringify([packed])), packed);
});

test("normalizes npm pack package-keyed output", () => {
	assert.deepEqual(parsePackOutput(JSON.stringify({ "@http3-server/server": packed })), packed);
});

test("rejects ambiguous npm pack output", () => {
	assert.throws(
		() => parsePackOutput(JSON.stringify({ first: packed, second: packed })),
		/npm pack returned 2 package results/
	);
});
