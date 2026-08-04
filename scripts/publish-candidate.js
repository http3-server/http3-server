#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const publicationOrder = [
	"@http3-server/dev-certificates",
	"@http3-server/darwin-arm64",
	"@http3-server/darwin-x64",
	"@http3-server/linux-arm64-gnu",
	"@http3-server/linux-arm64-musl",
	"@http3-server/linux-x64-gnu",
	"@http3-server/linux-x64-musl",
	"@http3-server/win32-arm64",
	"@http3-server/win32-x64",
	"@http3-server/native",
	"@http3-server/server",
];

export function publicationPlan(manifest, { sourceCommit, version }) {
	if (manifest.scope !== "release") throw new Error("Only a full release candidate can publish");
	if (manifest.sourceCommit !== sourceCommit) {
		throw new Error("Candidate source commit differs from the checked-out release commit");
	}
	if (manifest.releaseVersion !== version) {
		throw new Error(
			`Candidate is ${manifest.releaseVersion}, not requested version ${version}`
		);
	}
	const packages = new Map(manifest.packages.map((pkg) => [pkg.name, pkg]));
	if (packages.size !== publicationOrder.length) {
		throw new Error("Candidate does not contain the complete publication set");
	}
	return publicationOrder.map((name) => {
		const pkg = packages.get(name);
		if (!pkg) throw new Error(`Candidate is missing ${name}`);
		return pkg;
	});
}

export function publishArguments(tarball, tag, publish) {
	return [
		"publish",
		tarball,
		"--access=public",
		`--tag=${tag}`,
		...(publish ? ["--provenance"] : ["--dry-run", "--provenance=false"]),
	];
}

export function publishCommand(npmExecPath, tarball, tag, publish) {
	return [process.execPath, [npmExecPath, ...publishArguments(tarball, tag, publish)]];
}

function command(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	return result;
}

function exactPublishedIntegrity(npmExecPath, name, version) {
	const result = command(process.execPath, [
		npmExecPath,
		"view",
		`${name}@${version}`,
		"dist.integrity",
		"--json",
	]);
	if (result.status === 0) return JSON.parse(result.stdout.trim());
	const output = `${result.stdout}\n${result.stderr}`;
	if (/E404|404 Not Found/.test(output)) return null;
	throw new Error(`Unable to check ${name}@${version}: ${output.trim()}`);
}

function main() {
	const npmExecPath = process.env.npm_execpath;
	if (!npmExecPath) throw new Error("Run candidate publication through an npm package script");
	const candidateArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
	const candidateDirectory = resolve(candidateArgument || join(projectRoot, "release"));
	const version = process.argv
		.find((argument) => argument.startsWith("--version="))
		?.slice("--version=".length);
	const tag =
		process.argv.find((argument) => argument.startsWith("--tag="))?.slice("--tag=".length) ||
		"next";
	const publish = process.argv.includes("--publish");
	if (!version) throw new Error("Pass the exact candidate version with --version=<semver>");
	if (!/^[a-z][a-z0-9._-]*$/.test(tag)) throw new Error(`Invalid npm dist-tag ${tag}`);
	if (publish && process.env.GITHUB_ACTIONS !== "true") {
		throw new Error("Live candidate publication is restricted to the GitHub release workflow");
	}

	const verification = command(
		process.execPath,
		[join(projectRoot, "scripts", "verify-candidate.js"), candidateDirectory],
		{ stdio: "inherit" }
	);
	if (verification.status !== 0) process.exit(verification.status ?? 1);
	const sourceCommit = command("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
	if (sourceCommit.status !== 0) throw new Error(sourceCommit.stderr.trim());
	const manifest = JSON.parse(
		readFileSync(join(candidateDirectory, "candidate-manifest.json"), "utf8")
	);
	const plan = publicationPlan(manifest, {
		sourceCommit: sourceCommit.stdout.trim(),
		version,
	});
	const publishedIntegrities = new Map();
	for (const pkg of plan) {
		const publishedIntegrity = exactPublishedIntegrity(npmExecPath, pkg.name, version);
		if (publishedIntegrity && publishedIntegrity !== pkg.integrity) {
			throw new Error(`${pkg.name}@${version} already exists with different contents`);
		}
		publishedIntegrities.set(pkg.name, publishedIntegrity);
	}

	for (const pkg of plan) {
		const tarball = join(candidateDirectory, pkg.filename);
		if (publishedIntegrities.get(pkg.name)) {
			console.log(`already published ${pkg.name}@${version}`);
			continue;
		}
		const [executable, args] = publishCommand(npmExecPath, tarball, tag, publish);
		const result = command(executable, args, { cwd: projectRoot, stdio: "inherit" });
		if (result.status !== 0) process.exit(result.status ?? 1);
		console.log(`${publish ? "published" : "checked"} ${pkg.name}@${version} on ${tag}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
