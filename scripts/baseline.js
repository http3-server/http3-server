#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureIntegrationClient } from "./integration-client.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const producerRoot = resolve(process.env.MSH3_NODE_ROOT || join(projectRoot, "..", "msh3-node"));

function run(command, args, cwd = projectRoot, environment = process.env) {
	console.log(`\n> ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

const python = ensureIntegrationClient();

for (const script of ["lint", "patch:check", "bundle:verify"]) {
	run("npm", ["run", script], producerRoot);
}

run("node", ["scripts/import-binaries.js", join(producerRoot, "src"), "--local", "--check"]);
run("npm", ["run", "lint"]);
run("npm", ["test"]);
run("npm", ["run", "check:workspace"]);
run("npm", ["run", "test:integration", "--workspace", "http3s"], projectRoot, {
	...process.env,
	AIOQUIC_PYTHON: python,
});

console.log("\nHTTP/3 and WebTransport baseline passed");
