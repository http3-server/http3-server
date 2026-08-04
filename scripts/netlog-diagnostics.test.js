import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { netLogDiagnostics } from "./netlog-diagnostics.js";

test("NetLog diagnostics never mask a browser failure", () => {
	const directory = mkdtempSync(join(tmpdir(), "http3-netlog-"));
	try {
		const missing = join(directory, "missing.json");
		const empty = join(directory, "empty.json");
		const malformed = join(directory, "malformed.json");
		writeFileSync(empty, "");
		writeFileSync(malformed, "{");
		assert.equal(netLogDiagnostics(missing), "Chrome did not write a NetLog");
		assert.equal(netLogDiagnostics(empty), "Chrome wrote an empty NetLog");
		assert.match(netLogDiagnostics(malformed), /^Chrome wrote an unreadable NetLog:/);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});
