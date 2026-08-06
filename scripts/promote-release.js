#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { publicationOrder } from "./publish-candidate.js";

function command(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	return result;
}

function registryValue(npmExecPath, specifier, field) {
	const result = command(process.execPath, [npmExecPath, "view", specifier, field, "--json"]);
	if (result.status !== 0) {
		throw new Error(`Unable to inspect ${specifier}: ${result.stderr.trim()}`);
	}
	return JSON.parse(result.stdout.trim());
}

export function promotionPlan(states, version) {
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Invalid release version ${version}`);
	}
	if (states.size !== publicationOrder.length) {
		throw new Error("Registry state does not contain the complete publication set");
	}
	return publicationOrder.map((name) => {
		const state = states.get(name);
		if (!state) throw new Error(`Registry state is missing ${name}`);
		if (state.publishedVersion !== version) {
			throw new Error(`${name}@${version} is not published`);
		}
		if (state.distTags.next !== version) {
			throw new Error(`${name} next is ${state.distTags.next || "unset"}, not ${version}`);
		}
		return { name, alreadyPromoted: state.distTags.latest === version };
	});
}

function registryState(npmExecPath, name, version) {
	return {
		publishedVersion: registryValue(npmExecPath, `${name}@${version}`, "version"),
		distTags: registryValue(npmExecPath, name, "dist-tags"),
	};
}

function main() {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) throw new Error("Run promotion through an npm package script");
	const version = process.argv
		.find((argument) => argument.startsWith("--version="))
		?.slice("--version=".length);
	const promote = process.argv.includes("--promote");
	if (!version) throw new Error("Pass the exact release version with --version=<semver>");
	if (promote && process.env.GITHUB_ACTIONS !== "true") {
		throw new Error("Live release promotion is restricted to the GitHub release workflow");
	}

	const states = new Map(
		publicationOrder.map((name) => [name, registryState(npmExecPath, name, version)])
	);
	const plan = promotionPlan(states, version);
	for (const { name, alreadyPromoted } of plan) {
		if (alreadyPromoted) {
			console.log(`already promoted ${name}@${version} to latest`);
			continue;
		}
		if (!promote) {
			console.log(`would promote ${name}@${version} to latest`);
			continue;
		}
		const result = command(
			process.execPath,
			[npmExecPath, "dist-tag", "add", `${name}@${version}`, "latest"],
			{ stdio: "inherit" }
		);
		if (result.status !== 0) process.exit(result.status ?? 1);
		console.log(`promoted ${name}@${version} to latest`);
	}

	if (!promote) return;
	for (const name of publicationOrder) {
		const tags = registryValue(npmExecPath, name, "dist-tags");
		if (tags.latest !== version || tags.next !== version) {
			throw new Error(`${name} tags did not converge on ${version}`);
		}
	}
	console.log(
		`verified latest and next at ${version} for all ${publicationOrder.length} packages`
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
