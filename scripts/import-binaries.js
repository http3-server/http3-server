#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectNativeArchitecture, platforms } from "./platforms.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nativeBaseline = JSON.parse(readFileSync(join(projectRoot, "native-baseline.json"), "utf8"));

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyPreservingMode(source, target) {
	const mode = existsSync(target) ? statSync(target).mode : undefined;
	copyFileSync(source, target);
	if (mode !== undefined) chmodSync(target, mode);
}

/**
 * Replace every imported package directory as one rollback-capable transaction.
 * The optional hook exists only so the transaction can be failure-tested.
 *
 * @param {{
 *   projectRoot: string;
 *   imports: Array<{
 *     platform: (typeof platforms)[number];
 *     sourceDirectory: string;
 *     targetDirectory: string;
 *     manifestPath: string;
 *   }>;
 *   declarationSource: string;
 *   beforeInstall?: (index: number) => void;
 * }} options
 */
export function commitImports({
	projectRoot,
	imports,
	declarationSource,
	beforeInstall = () => {
		// Production imports do not need a pre-install hook.
	},
}) {
	const transactionRoot = mkdtempSync(join(projectRoot, ".binary-import-"));
	const nextRoot = join(transactionRoot, "next");
	const backupRoot = join(transactionRoot, "backup");
	const targets = imports.map(({ platform, sourceDirectory, targetDirectory, manifestPath }) => {
		const stagedDirectory = join(nextRoot, "binaries", platform.id);
		cpSync(targetDirectory, stagedDirectory, { recursive: true });
		for (const name of platform.files) {
			copyPreservingMode(join(sourceDirectory, name), join(stagedDirectory, name));
		}
		copyPreservingMode(manifestPath, join(stagedDirectory, "build-manifest.json"));
		return {
			label: platform.id,
			live: targetDirectory,
			staged: stagedDirectory,
			backup: join(backupRoot, "binaries", platform.id),
		};
	});

	const nativeDirectory = join(projectRoot, "packages", "native");
	const stagedNativeDirectory = join(nextRoot, "packages", "native");
	cpSync(nativeDirectory, stagedNativeDirectory, { recursive: true });
	copyPreservingMode(declarationSource, join(stagedNativeDirectory, "http3.d.ts"));
	targets.push({
		label: "canonical native declarations",
		live: nativeDirectory,
		staged: stagedNativeDirectory,
		backup: join(backupRoot, "packages", "native"),
	});

	const replaced = [];
	try {
		for (const [index, target] of targets.entries()) {
			mkdirSync(dirname(target.backup), { recursive: true });
			renameSync(target.live, target.backup);
			try {
				beforeInstall(index);
				renameSync(target.staged, target.live);
				replaced.push(target);
			} catch (error) {
				renameSync(target.backup, target.live);
				throw error;
			}
			console.log(`imported ${target.label}`);
		}
	} catch (error) {
		for (const target of replaced.reverse()) {
			rmSync(target.live, { force: true, recursive: true });
			renameSync(target.backup, target.live);
		}
		throw error;
	} finally {
		rmSync(transactionRoot, { force: true, recursive: true });
	}
}

function main() {
	const sourceArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
	const checkOnly = process.argv.includes("--check");
	const localOnly = process.argv.includes("--local");
	const defaultLocalRoot = join(
		resolve(process.env.MSH3_NODE_ROOT || join(projectRoot, "..", "msh3-node")),
		"src"
	);
	const sourceRoot = sourceArgument
		? resolve(sourceArgument)
		: localOnly
			? defaultLocalRoot
			: undefined;

	if (!sourceRoot) {
		throw new Error(
			"Usage: node scripts/import-binaries.js <builds-directory> [--check] [--local]"
		);
	}

	const imports = [];
	const selectedPlatforms = localOnly
		? platforms.filter(({ os, cpu }) => os === process.platform && cpu === process.arch)
		: platforms;

	if (selectedPlatforms.length === 0) {
		throw new Error(`No platform package matches ${process.platform}-${process.arch}`);
	}

	for (const platform of selectedPlatforms) {
		const sourceDirectory = localOnly ? sourceRoot : join(sourceRoot, platform.id);
		const targetDirectory = join(projectRoot, "binaries", platform.id);
		const manifestPath = join(sourceDirectory, "build-manifest.json");
		const declarationPath = join(sourceDirectory, "http3.d.ts");
		if (!existsSync(declarationPath)) {
			throw new Error(`${platform.id} does not contain the canonical http3.d.ts`);
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

		if (
			manifest.formatVersion !== nativeBaseline.formatVersion ||
			manifest.producer !== "msh3-node"
		) {
			throw new Error(`${platform.id} has an unsupported build manifest`);
		}
		if (manifest.platform !== platform.id) {
			throw new Error(`${platform.id} contains a manifest for ${manifest.platform}`);
		}
		if (
			manifest.producerCommit !== nativeBaseline.producerCommit ||
			manifest.msh3Commit !== nativeBaseline.msh3Commit ||
			manifest.msquicCommit !== nativeBaseline.msquicCommit ||
			manifest.msh3PatchSha256 !== nativeBaseline.msh3PatchSha256 ||
			manifest.msquicPatchSha256 !== nativeBaseline.msquicPatchSha256
		) {
			throw new Error(`${platform.id} does not match native-baseline.json`);
		}

		const manifestNames = manifest.files.map(({ name }) => name);
		if (JSON.stringify(manifestNames) !== JSON.stringify(platform.files)) {
			throw new Error(`${platform.id} does not contain the expected runtime files`);
		}

		for (const file of manifest.files) {
			const sourcePath = join(sourceDirectory, file.name);
			if (statSync(sourcePath).size !== file.bytes || sha256(sourcePath) !== file.sha256) {
				throw new Error(`${platform.id}/${file.name} does not match its manifest`);
			}
			if (
				file.architecture !== platform.cpu ||
				detectNativeArchitecture(sourcePath) !== platform.cpu
			) {
				throw new Error(`${platform.id}/${file.name} has the wrong architecture`);
			}
		}

		imports.push({ platform, sourceDirectory, targetDirectory, manifestPath, declarationPath });
		console.log(`verified ${platform.id}`);
	}

	const declarationHashes = new Set(
		imports.map(({ declarationPath }) => sha256(declarationPath))
	);
	if (declarationHashes.size !== 1) {
		throw new Error("Native build inputs contain different http3.d.ts declarations");
	}
	const declarationSource = imports[0].declarationPath;
	const declarationTarget = join(projectRoot, "packages", "native", "http3.d.ts");

	if (!checkOnly) {
		commitImports({ projectRoot, imports, declarationSource });
	} else if (localOnly) {
		for (const { platform, sourceDirectory, targetDirectory, manifestPath } of imports) {
			for (const name of platform.files) {
				if (sha256(join(sourceDirectory, name)) !== sha256(join(targetDirectory, name))) {
					throw new Error(
						`${platform.id}/${name} has not been imported from the local bundle`
					);
				}
			}
			if (sha256(manifestPath) !== sha256(join(targetDirectory, "build-manifest.json"))) {
				throw new Error(`${platform.id}/build-manifest.json differs from the local bundle`);
			}
			console.log(`current ${platform.id}`);
		}
		if (sha256(declarationSource) !== sha256(declarationTarget)) {
			throw new Error(
				"packages/native/http3.d.ts differs from the canonical native declaration"
			);
		}
		console.log("current canonical native declarations");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
