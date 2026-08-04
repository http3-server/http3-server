#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const requirements = join(projectRoot, "packages", "server", "test", "requirements.txt");
const environment = join(projectRoot, ".cache", "aioquic");
const stamp = join(environment, ".requirements-sha256");
const python = join(
	environment,
	process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
);

function run(command, args) {
	const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

export function ensureIntegrationClient() {
	const digest = createHash("sha256").update(readFileSync(requirements)).digest("hex");
	if (existsSync(python) && existsSync(stamp) && readFileSync(stamp, "utf8") === digest) {
		return python;
	}

	mkdirSync(dirname(environment), { recursive: true });
	if (!existsSync(python)) {
		run(process.env.PYTHON || "python3", ["-m", "venv", environment]);
	}
	run(python, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--requirement",
		requirements,
	]);
	writeFileSync(stamp, digest);
	return python;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	console.log(ensureIntegrationClient());
}
