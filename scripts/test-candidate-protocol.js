#!/usr/bin/env node
// @ts-check

import { cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installCandidate } from "./candidate.js";
import { ensureIntegrationClient } from "./integration-client.js";
import { runIntegrationSuite } from "./integration-suite.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = resolve(process.argv[2] || join(projectRoot, "release"));
const { platformName, root } = installCandidate(candidateDirectory);

try {
	cpSync(join(projectRoot, "packages", "server", "test"), join(root, "test"), {
		recursive: true,
	});
	const python = ensureIntegrationClient();
	runIntegrationSuite({ cwd: root, testFile: "test/integration.test.js", python });
	console.log(`passed packed ${platformName} protocol suite on Node ${process.versions.node}`);
} finally {
	rmSync(root, { force: true, recursive: true });
}
