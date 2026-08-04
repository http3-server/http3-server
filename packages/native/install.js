#!/usr/bin/env node

// post-install script for @http3-server/native

import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, endianness } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	knownPlatformPackages,
	MESSAGE_FOR_PLATFORM_ERROR,
	MESSAGE_FOR_PLATFORM_FOUND_ERROR,
	MESSAGE_FOR_UNFOUND_ERROR,
	MESSAGE_FOR_UNSUPPORTED_PLATFORM,
} from "./install-constants.js";

/** Detect the Linux C library used by the current Node.js process. */
export const detectLinuxLibc = (report = process.report) => {
	try {
		const header = /** @type {{ glibcVersionRuntime?: string }} */ (report?.getReport().header);
		return header.glibcVersionRuntime ? "glibc" : "musl";
	} catch {
		return "musl";
	}
};

/** Return the package-selection key for a runtime. */
export const getPlatformKey = ({
	platform = process.platform,
	architecture = arch(),
	byteOrder = endianness(),
	report = process.report,
} = {}) =>
	[
		platform,
		architecture,
		byteOrder,
		...(platform === "linux" ? [detectLinuxLibc(report)] : []),
	].join(" ");

/** Returns the package name for the current platform. */
export const getPackageForCurrentPlatform = (runtime) => {
	const platformKey = getPlatformKey(runtime);

	if (platformKey in knownPlatformPackages) {
		return knownPlatformPackages[platformKey];
	}

	throw new Error(MESSAGE_FOR_UNSUPPORTED_PLATFORM(platformKey));
};

/** Returns the checked-out platform module while developing in the monorepo. */
export const getLocalPlatformModule = (packageName = getPackageForCurrentPlatform()) => {
	const platform = packageName.slice(packageName.lastIndexOf("/") + 1);
	const path = fileURLToPath(new URL(`../../binaries/${platform}/http3.js`, import.meta.url));
	return existsSync(path) ? path : null;
};

/**
 * Check if there's a package for some other platform installed
 * This helps provide better error messages when people copy node_modules
 * between different platforms (common with Docker)
 */
export const findInstalledPlatformPackage = () => {
	try {
		// Try to find the http3-server package location
		const require = createRequire(import.meta.url);
		const http3ServerPath = require.resolve("@http3-server/native/package.json");
		const nodeModulesDir = dirname(dirname(http3ServerPath));

		if (basename(nodeModulesDir) === "node_modules") {
			// Look for any installed platform packages
			for (const [platformKey, packageName] of Object.entries(knownPlatformPackages)) {
				const packagePath = join(nodeModulesDir, packageName);
				if (existsSync(packagePath)) {
					return { platformKey, packageName };
				}
			}
		}
	} catch {
		// Ignore errors - this is just for better error messages
	}

	return null;
};

/**
 * Generate a helpful error message when the platform package is missing
 */
export const generatePlatformErrorMessage = (
	requestedPkg,
	foundPlatform = /** @type {object} */ (null)
) => {
	const currentPlatform = getPlatformKey();

	let message = MESSAGE_FOR_PLATFORM_ERROR(requestedPkg, currentPlatform);

	if (foundPlatform) {
		message += MESSAGE_FOR_PLATFORM_FOUND_ERROR(
			foundPlatform.packageName,
			foundPlatform.platformKey
		);
	} else {
		message += MESSAGE_FOR_UNFOUND_ERROR(requestedPkg);
	}

	return message;
};

// #region installation

// run install if this script is executed directly
if (
	process.argv[1] &&
	pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href ===
		pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
	console.log("http3-server: Checking platform compatibility...");

	try {
		const pkg = getPackageForCurrentPlatform();

		console.log(`Platform detected: ${getPlatformKey()}`);
		console.log(`Required package: ${pkg}`);

		try {
			const localModule = getLocalPlatformModule(pkg);
			if (localModule) {
				console.log(`✓ Found local platform build: ${localModule}`);
				console.log("✓ http3-server installation complete");
				process.exit(0);
			}
			// try to resolve the platform-specific package
			void createRequire(import.meta.url).resolve(pkg);

			console.log(`✓ Found platform package: ${pkg}`);
			console.log("✓ http3-server installation complete");
		} catch {
			console.error(`✗ Platform package not found: ${pkg}`);

			// check if there"s a different platform package installed
			const foundPlatform = findInstalledPlatformPackage();
			const errorMessage = generatePlatformErrorMessage(pkg, foundPlatform);

			console.error(`\n${errorMessage}`);

			// Don't throw an error here - let the application handle it at runtime.
			// This allows the package to be installed even if the platform-specific
			// binary isn"t available (useful for development environments)

			console.warn("⚠ http3-server installed but platform package is missing");
			console.warn(
				"  The package will not work until the platform-specific binary is available"
			);
		}
	} catch (error) {
		console.error("✗ http3-server installation failed:", error.message);

		// don't exit with error code - allow installation to continue
	}
}
