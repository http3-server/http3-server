#!/usr/bin/env node
// @ts-check

import { cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installCandidate, run } from "./candidate.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = resolve(process.argv[2] || join(projectRoot, "release"));
const { platformName, root } = installCandidate(candidateDirectory);

try {
	for (const filename of ["netlog-diagnostics.js", "test-browser.js"]) {
		cpSync(join(projectRoot, "scripts", filename), join(root, filename));
	}
	run(process.execPath, ["test-browser.js"], { cwd: root, env: process.env });
	console.log(`passed packed ${platformName} browser suite on Node ${process.versions.node}`);
} finally {
	rmSync(root, { force: true, recursive: true });
}
