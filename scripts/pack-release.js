#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "./platforms.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error("Run the release packer through an npm package script");
const dryRun = process.argv.includes("--dry-run");
const localOnly = process.argv.includes("--local");
const testBrowser = process.argv.includes("--browser");
const testProtocol = process.argv.includes("--protocol");
const destinationArgument = process.argv.find((argument) => argument.startsWith("--destination="));
const destination = destinationArgument
	? resolve(destinationArgument.slice("--destination=".length))
	: null;

if (destination) {
	const destinationRelative = relative(projectRoot, destination);
	if (!destinationRelative || destinationRelative.startsWith("..")) {
		throw new Error("The candidate destination must be a child of the repository root");
	}
}

const selectedPlatforms = localOnly
	? platforms.filter(({ os, cpu }) => os === process.platform && cpu === process.arch)
	: platforms;
if (selectedPlatforms.length === 0) {
	throw new Error(`No platform package matches ${process.platform}-${process.arch}`);
}
const packageDirectories = [
	...selectedPlatforms.map(({ id }) => `binaries/${id}`),
	"packages/dev-certificates",
	"packages/native",
	"packages/server",
];

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function sortedRecord(value) {
	if (!value) return undefined;
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
	);
}

function command(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		encoding: "utf8",
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}
	return result.stdout?.trim() ?? "";
}

const parentDirectory = destination ? dirname(destination) : tmpdir();
mkdirSync(parentDirectory, { recursive: true });
const transactionRoot = mkdtempSync(join(parentDirectory, ".http3-pack-"));
const candidateDirectory = join(transactionRoot, "candidate");
const npmCache = join(transactionRoot, "npm-cache");
mkdirSync(candidateDirectory);

try {
	const packages = [];
	for (const directory of packageDirectories) {
		const packageDirectory = join(projectRoot, directory);
		const packageJson = readJson(join(packageDirectory, "package.json"));
		const stdout = command(
			process.execPath,
			[
				npmExecPath,
				"pack",
				packageDirectory,
				"--json",
				"--pack-destination",
				candidateDirectory,
			],
			{
				env: {
					...process.env,
					npm_config_cache: npmCache,
					npm_config_update_notifier: "false",
				},
			}
		);
		const [packed] = JSON.parse(stdout);
		if (packed.name !== packageJson.name || packed.version !== packageJson.version) {
			throw new Error(`${directory} packed unexpected package identity ${packed.id}`);
		}
		const packedPaths = new Set(packed.files.map(({ path }) => path));
		for (const path of packageJson.files) {
			if (!packedPaths.has(path)) throw new Error(`${packageJson.name} omitted ${path}`);
		}

		const tarballPath = join(candidateDirectory, packed.filename);
		const platform = platforms.find(({ id }) => directory === `binaries/${id}`);
		const buildManifest = platform
			? readJson(join(packageDirectory, "build-manifest.json"))
			: undefined;
		packages.push({
			name: packageJson.name,
			version: packageJson.version,
			filename: packed.filename,
			bytes: statSync(tarballPath).size,
			sha256: sha256(tarballPath),
			integrity: packed.integrity,
			dependencies: sortedRecord(packageJson.dependencies),
			optionalDependencies: sortedRecord(packageJson.optionalDependencies),
			os: packageJson.os,
			cpu: packageJson.cpu,
			files: packed.files.map(({ path, size }) => ({ path, bytes: size })),
			buildManifest,
		});
		console.log(`packed ${packed.id}`);
	}

	const securitySource = join(projectRoot, "SECURITY.md");
	if (!existsSync(securitySource))
		throw new Error("SECURITY.md is required for a release candidate");
	const securityTarget = join(candidateDirectory, "SECURITY.md");
	copyFileSync(securitySource, securityTarget);
	const releaseVersion = readJson(
		join(projectRoot, "packages", "server", "package.json")
	).version;
	const manifest = {
		formatVersion: 1,
		scope: localOnly ? "local" : "release",
		releaseVersion,
		sourceCommit: command("git", ["rev-parse", "HEAD"]),
		packages,
		securityPolicy: {
			filename: "SECURITY.md",
			bytes: statSync(securityTarget).size,
			sha256: sha256(securityTarget),
		},
	};
	writeFileSync(
		join(candidateDirectory, "candidate-manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`
	);

	command("node", [join(projectRoot, "scripts", "verify-candidate.js"), candidateDirectory], {
		stdio: "inherit",
	});
	command("node", [join(projectRoot, "scripts", "test-candidate.js"), candidateDirectory], {
		stdio: "inherit",
	});
	if (testProtocol) {
		command(
			"node",
			[join(projectRoot, "scripts", "test-candidate-protocol.js"), candidateDirectory],
			{ stdio: "inherit" }
		);
	}
	if (testBrowser) {
		command(
			"node",
			[join(projectRoot, "scripts", "test-candidate-browser.js"), candidateDirectory],
			{ stdio: "inherit" }
		);
	}

	if (destination && !dryRun) {
		const next = `${destination}.${process.pid}.next`;
		const backup = `${destination}.${process.pid}.backup`;
		rmSync(next, { force: true, recursive: true });
		renameSync(candidateDirectory, next);
		let backedUp = false;
		try {
			if (existsSync(destination)) {
				renameSync(destination, backup);
				backedUp = true;
			}
			renameSync(next, destination);
			if (backedUp) rmSync(backup, { force: true, recursive: true });
		} catch (error) {
			if (backedUp && !existsSync(destination)) renameSync(backup, destination);
			throw error;
		} finally {
			rmSync(next, { force: true, recursive: true });
		}
		console.log(`candidate ${releaseVersion} written to ${destination}`);
	} else {
		console.log(`candidate ${releaseVersion} verified without publishing artifacts`);
	}
} finally {
	rmSync(transactionRoot, { force: true, recursive: true });
}
