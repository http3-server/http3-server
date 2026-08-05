import assert from "node:assert/strict";
import { test } from "node:test";
import { sendHeadersBestEffort } from "../internal/send-headers-best-effort.js";

test("contains synchronous native failures while rejecting an invalid request", async () => {
	const cause = new Error("Stream ID not found");
	const native = {
		sendHeaders() {
			throw cause;
		},
	};

	await assert.doesNotReject(sendHeadersBestEffort(native, "10", 400));
});

test("contains asynchronous native failures while rejecting an invalid request", async () => {
	const cause = new Error("Stream closed");
	const native = {
		sendHeaders() {
			return Promise.reject(cause);
		},
	};

	await assert.doesNotReject(sendHeadersBestEffort(native, "10", 400));
});
