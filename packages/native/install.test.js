import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the installer runs directly from a path containing spaces", () => {
	const root = mkdtempSync(join(tmpdir(), "http3 installer "));
	try {
		for (const name of ["install.js", "install-constants.js"]) {
			cpSync(fileURLToPath(new URL(name, import.meta.url)), join(root, name));
		}
		const result = spawnSync(process.execPath, [join(root, "install.js")], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Checking platform compatibility/);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
