#!/usr/bin/env node
// install.js - Post-install script for http3-server
// Based on esbuild"s install script approach

import { getPackageForCurrentPlatform, findInstalledPlatformPackage, generatePlatformErrorMessage } from "./platform.js";
import { createRequire } from "module";

/**
 * Check if the required platform package is available
 */
function checkPlatformPackage() {
	const pkg = getPackageForCurrentPlatform();

	try {
		// Try to resolve the platform-specific package
		const require = createRequire(import.meta.url);
		const packagePath = require.resolve(pkg);
		console.log(`✓ Found platform package: ${pkg}`);
		return true;
	} catch (error) {
		console.error(`✗ Platform package not found: ${pkg}`);

		// Check if there"s a different platform package installed
		const foundPlatform = findInstalledPlatformPackage();
		const errorMessage = generatePlatformErrorMessage(pkg, foundPlatform);

		console.error("\n" + errorMessage);

		// Don"t throw an error here - let the application handle it at runtime
		// This allows the package to be installed even if the platform-specific
		// binary isn"t available (useful for development environments)
		return false;
	}
}

/**
 * Main install function
 */
function install() {
	console.log("http3-server: Checking platform compatibility...");

	try {
		const pkg = getPackageForCurrentPlatform();
		console.log(`Platform detected: ${process.platform} ${process.arch}`);
		console.log(`Required package: ${pkg}`);

		const packageAvailable = checkPlatformPackage();

		if (packageAvailable) {
			console.log("✓ http3-server installation complete");
		} else {
			console.warn("⚠ http3-server installed but platform package is missing");
			console.warn("  The package will not work until the platform-specific binary is available");
		}

	} catch (error) {
		console.error("✗ http3-server installation failed:", error.message);
		// Don"t exit with error code - allow installation to continue
	}
}

// Run install if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	install();
}
