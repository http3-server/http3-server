#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runs = Number(process.env.HTTP3_STRESS_RUNS ?? 3);
if (!Number.isSafeInteger(runs) || runs < 1) {
	throw new Error("HTTP3_STRESS_RUNS must be a positive integer");
}

for (let run = 1; run <= runs; run += 1) {
	console.log(`native stress run ${run}/${runs}`);
	const result = spawnSync(
		process.execPath,
		[join(projectRoot, "scripts", "run-integration.js")],
		{
			cwd: projectRoot,
			stdio: "inherit",
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`stress run ${run} exited with status ${result.status}`);
}

console.log(`${runs} native concurrency stress runs passed`);
