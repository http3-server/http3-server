// @ts-check

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

export function runNpm(args, options = {}) {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) throw new Error("Run candidate tests through an npm package script");
	run(process.execPath, [npmExecPath, ...args], options);
}

export function readCandidate(candidateDirectory) {
	const directory = resolve(candidateDirectory);
	const manifest = JSON.parse(readFileSync(join(directory, "candidate-manifest.json"), "utf8"));
	return {
		directory,
		manifest,
		packageByName: new Map(manifest.packages.map((pkg) => [pkg.name, pkg])),
	};
}

export function installCandidate(candidateDirectory) {
	const candidate = readCandidate(candidateDirectory);
	const platformName = `@http3-server/${process.platform}-${process.arch}`;
	const required = [
		"http3s",
		"@http3-server/dev-certificates",
		"@http3-server/native",
		platformName,
	];
	for (const name of required) {
		if (!candidate.packageByName.has(name))
			throw new Error(`Candidate does not contain ${name}`);
	}

	const root = mkdtempSync(join(tmpdir(), "http3-candidate-test-"));
	const dependencies = Object.fromEntries(
		required.map((name) => [
			name,
			`file:${join(candidate.directory, candidate.packageByName.get(name).filename)}`,
		])
	);
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ private: true, type: "module", dependencies }, null, "\t")}\n`
	);
	runNpm(["install", "--offline", "--no-audit", "--no-fund"], {
		cwd: root,
		env: {
			...process.env,
			npm_config_cache: join(root, "npm-cache"),
			npm_config_update_notifier: "false",
		},
	});
	return { ...candidate, platformName, root };
}
