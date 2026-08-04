#!/usr/bin/env node
// @ts-check

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "./platforms.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
	throw new Error("Usage: node scripts/set-version.js <semver>");
}

const packagePaths = [
	"package.json",
	"packages/dev-certificates/package.json",
	"packages/native/package.json",
	"packages/server/package.json",
	...platforms.map(({ id }) => `binaries/${id}/package.json`),
];

for (const relativePath of packagePaths) {
	const path = join(projectRoot, relativePath);
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	pkg.version = version;
	if (pkg.name === "http3s") pkg.dependencies["@http3-server/native"] = version;
	if (pkg.name === "@http3-server/native") {
		for (const name of Object.keys(pkg.optionalDependencies)) {
			pkg.optionalDependencies[name] = version;
		}
	}
	writeFileSync(path, `${JSON.stringify(pkg, null, "\t")}\n`);
	console.log(`set ${relativePath} to ${version}`);
}

console.log("Run npm install --package-lock-only to update package-lock.json.");
