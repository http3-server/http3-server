#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectNativeArchitecture, platforms } from "./platforms.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nativeBaseline = readJson(join(projectRoot, "native-baseline.json"));
const requireManifests = process.argv.includes("--require-manifests");
const workspaceOnly = process.argv.includes("--workspace");

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const nativePackage = readJson(join(projectRoot, "packages/native/package.json"));
const devCertificatesPackage = readJson(
	join(projectRoot, "packages/dev-certificates/package.json")
);
const serverPackage = readJson(join(projectRoot, "packages/server/package.json"));
const releaseVersion = serverPackage.version;
const failures = [];

if (readJson(join(projectRoot, "package.json")).version !== releaseVersion) {
	failures.push("root and published package versions differ");
}
if (nativePackage.version !== releaseVersion) failures.push("native and server versions differ");
if (devCertificatesPackage.version !== releaseVersion) {
	failures.push("development certificates and server versions differ");
}
if (serverPackage.dependencies["@http3-server/native"] !== releaseVersion) {
	failures.push("http3s does not depend on the release version of @http3-server/native");
}

for (const platform of platforms) {
	const directory = join(projectRoot, "binaries", platform.id);
	const pkg = readJson(join(directory, "package.json"));
	if (pkg.version !== releaseVersion) failures.push(`${pkg.name} version differs`);
	if (JSON.stringify(pkg.os) !== JSON.stringify([platform.os])) {
		failures.push(`${pkg.name} has the wrong os constraint`);
	}
	if (JSON.stringify(pkg.cpu) !== JSON.stringify([platform.cpu])) {
		failures.push(`${pkg.name} has the wrong cpu constraint`);
	}
	if (nativePackage.optionalDependencies[pkg.name] !== releaseVersion) {
		failures.push(`@http3-server/native does not select ${pkg.name}@${releaseVersion}`);
	}
	if (pkg.exports?.["."] !== "./http3.js" || pkg.exports?.["./http3.node"] !== "./http3.node") {
		failures.push(`${pkg.name} does not expose the shared JavaScript loader contract`);
	}

	for (const name of platform.files) {
		const path = join(directory, name);
		if (!existsSync(path) || statSync(path).size === 0)
			failures.push(`${platform.id}/${name} missing`);
		else if (!workspaceOnly && detectNativeArchitecture(path) !== platform.cpu)
			failures.push(`${platform.id}/${name} is not ${platform.cpu}`);
		if (!pkg.files.includes(name)) failures.push(`${pkg.name} does not publish ${name}`);
	}

	const manifestPath = join(directory, "build-manifest.json");
	if (!existsSync(manifestPath)) {
		if (requireManifests) failures.push(`${platform.id} has no build manifest`);
		continue;
	}

	const manifest = readJson(manifestPath);
	if (
		manifest.formatVersion !== nativeBaseline.formatVersion ||
		manifest.platform !== platform.id ||
		manifest.producer !== "msh3-node"
	) {
		failures.push(`${platform.id} has invalid provenance`);
		continue;
	}
	if (
		manifest.producerCommit !== nativeBaseline.producerCommit ||
		manifest.msh3Commit !== nativeBaseline.msh3Commit ||
		manifest.msquicCommit !== nativeBaseline.msquicCommit ||
		manifest.msh3PatchSha256 !== nativeBaseline.msh3PatchSha256 ||
		manifest.msquicPatchSha256 !== nativeBaseline.msquicPatchSha256
	) {
		failures.push(`${platform.id} does not match native-baseline.json`);
	}
	if (JSON.stringify(manifest.files.map(({ name }) => name)) !== JSON.stringify(platform.files)) {
		failures.push(`${platform.id} manifest has the wrong runtime file set`);
	}
	for (const file of manifest.files) {
		const path = join(directory, file.name);
		if (
			!existsSync(path) ||
			statSync(path).size !== file.bytes ||
			sha256(path) !== file.sha256
		) {
			failures.push(`${platform.id}/${file.name} differs from its build manifest`);
		}
	}
	if (!pkg.files.includes("build-manifest.json")) {
		failures.push(`${pkg.name} does not publish its build manifest`);
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(
		`${workspaceOnly ? "workspace" : "release"} metadata is consistent for ${releaseVersion}`
	);
}
