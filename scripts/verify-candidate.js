#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = resolve(process.argv[2] || join(projectRoot, "release"));

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const manifestPath = join(candidateDirectory, "candidate-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.formatVersion !== 1) throw new Error("Unsupported candidate manifest format");
const expectedPackages = manifest.scope === "local" ? 4 : 11;
if (manifest.scope !== "local" && manifest.scope !== "release") {
	throw new Error("Candidate manifest has an unsupported scope");
}
if (manifest.packages.length !== expectedPackages) {
	throw new Error(`${manifest.scope} candidate must contain ${expectedPackages} packages`);
}

const names = new Set();
const producerCommits = new Set();
for (const pkg of manifest.packages) {
	if (names.has(pkg.name)) throw new Error(`Duplicate candidate package ${pkg.name}`);
	names.add(pkg.name);
	if (pkg.version !== manifest.releaseVersion) {
		throw new Error(`${pkg.name} is not version ${manifest.releaseVersion}`);
	}
	if (
		pkg.publishConfig?.access !== "public" ||
		pkg.publishConfig?.provenance !== true ||
		pkg.publishConfig?.registry !== "https://registry.npmjs.org/"
	) {
		throw new Error(`${pkg.name} does not enforce public npm publication with provenance`);
	}
	const packedPaths = new Set(pkg.files.map(({ path }) => path));
	if (!packedPaths.has("LICENSE.md") || !packedPaths.has("README.md")) {
		throw new Error(`${pkg.name} does not contain its license and README`);
	}
	const path = join(candidateDirectory, pkg.filename);
	if (statSync(path).size !== pkg.bytes || sha256(path) !== pkg.sha256) {
		throw new Error(`${pkg.filename} differs from candidate-manifest.json`);
	}
	if (pkg.os && pkg.cpu) {
		if (
			!pkg.buildManifest ||
			pkg.buildManifest.formatVersion !== 4 ||
			pkg.buildManifest.producer !== "msh3-node"
		) {
			throw new Error(`${pkg.name} lacks native build provenance`);
		}
		if (!/^[0-9a-f]{40}$/.test(pkg.buildManifest.producerCommit)) {
			throw new Error(`${pkg.name} lacks an exact producer revision`);
		}
		producerCommits.add(pkg.buildManifest.producerCommit);
		const expectedLibc = Array.isArray(pkg.libc) ? pkg.libc[0] : pkg.libc;
		if (
			pkg.buildManifest.target?.os !== pkg.os[0] ||
			pkg.buildManifest.target?.cpu !== pkg.cpu[0] ||
			pkg.buildManifest.target?.libc !== expectedLibc
		) {
			throw new Error(`${pkg.name} has mismatched native target provenance`);
		}
		for (const file of pkg.buildManifest.files) {
			if (!file.sha256 || !file.bytes || !file.architecture) {
				throw new Error(`${pkg.name} has incomplete native checksums`);
			}
		}
	}
}

if (producerCommits.size !== 1) {
	throw new Error("Native packages do not come from one producer revision");
}

const nativePackage = manifest.packages.find(({ name }) => name === "@http3-server/native");
const devCertificatesPackage = manifest.packages.find(
	({ name }) => name === "@http3-server/dev-certificates"
);
const serverPackage = manifest.packages.find(({ name }) => name === "http3s");
if (!devCertificatesPackage) throw new Error("Candidate does not contain development certificates");
if (serverPackage.dependencies?.["@http3-server/native"] !== manifest.releaseVersion) {
	throw new Error("http3s has the wrong native dependency edge");
}
for (const name of names) {
	const pkg = manifest.packages.find((candidatePackage) => candidatePackage.name === name);
	if (!pkg?.os || !pkg.cpu) continue;
	if (nativePackage.optionalDependencies?.[name] !== manifest.releaseVersion) {
		throw new Error(`@http3-server/native has the wrong ${name} dependency edge`);
	}
}

const securityPath = join(candidateDirectory, manifest.securityPolicy.filename);
if (
	statSync(securityPath).size !== manifest.securityPolicy.bytes ||
	sha256(securityPath) !== manifest.securityPolicy.sha256
) {
	throw new Error("SECURITY.md differs from candidate-manifest.json");
}

console.log(
	`verified ${manifest.scope} candidate ${manifest.releaseVersion} (${manifest.packages.length} packages)`
);
