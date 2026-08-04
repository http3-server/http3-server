import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectLinuxLibc, getPackageForCurrentPlatform, getPlatformKey } from "./install.js";

const report = (glibcVersionRuntime) => ({
	getReport: () => ({ header: glibcVersionRuntime ? { glibcVersionRuntime } : {} }),
});

test("selects GNU and musl Linux packages", () => {
	assert.equal(detectLinuxLibc(report("2.36")), "glibc");
	assert.equal(detectLinuxLibc(report()), "musl");
	assert.equal(
		getPackageForCurrentPlatform({
			platform: "linux",
			architecture: "x64",
			byteOrder: "LE",
			report: report("2.36"),
		}),
		"@http3-server/linux-x64-gnu"
	);
	assert.equal(
		getPackageForCurrentPlatform({
			platform: "linux",
			architecture: "arm64",
			byteOrder: "LE",
			report: report(),
		}),
		"@http3-server/linux-arm64-musl"
	);
});

test("leaves non-Linux platform keys unchanged", () => {
	assert.equal(
		getPlatformKey({ platform: "darwin", architecture: "arm64", byteOrder: "LE" }),
		"darwin arm64 LE"
	);
});

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
