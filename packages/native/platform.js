// platform.js
// Platform detection and package resolution for http3-server
// Based on esbuild"s approach: https://github.com/evanw/esbuild/blob/main/lib/npm/node-platform.ts

import os from "os";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

// Known platform-specific packages for HTTP/3 server
export const knownPlatformPackages = {
	// Darwin (macOS)
	"darwin arm64 LE": "@http3-server/darwin-arm64",
	"darwin x64 LE": "@http3-server/darwin-x64",

	// Linux
	"linux arm64 LE": "@http3-server/linux-arm64",
	"linux x64 LE": "@http3-server/linux-x64",

	// Windows
	"win32 arm64 LE": "@http3-server/win32-arm64",
	"win32 x64 LE": "@http3-server/win32-x64",
};

/**
 * Get the package name for the current platform
 * @returns {string}
 */
export const getPackageForCurrentPlatform = () => {
	let pkg;

	// Create platform key similar to esbuild
	const platformKey = `${process.platform} ${os.arch()} ${os.endianness()}`;

	if (platformKey in knownPlatformPackages) {
		pkg = knownPlatformPackages[platformKey];
	} else {
		throw new Error(`Unsupported platform: ${platformKey}

The @http3-server/native package doesn"t have a binary for your platform.
Supported platforms:
${Object.keys(knownPlatformPackages).map(key => `  - ${key}`).join("\n")}

You can:
1. Request support for your platform by opening an issue
2. Build from source if build tools are available
3. Use a different HTTP/3 implementation`);
	}

	return pkg;
}

/**
 * Check if there"s a package for some other platform installed
 * This helps provide better error messages when people copy node_modules
 * between different platforms (common with Docker)
 */
export function findInstalledPlatformPackage() {
	try {
		// Try to find the http3-server package location
		const require = createRequire(import.meta.url);
		const http3ServerPath = require.resolve("http3-server/package.json");
		const nodeModulesDir = path.dirname(path.dirname(http3ServerPath));

		if (path.basename(nodeModulesDir) === "node_modules") {
			// Look for any installed platform packages
			for (const [platformKey, packageName] of Object.entries(knownPlatformPackages)) {
				const packagePath = path.join(nodeModulesDir, packageName);
				if (fs.existsSync(packagePath)) {
					return { platformKey, packageName };
				}
			}
		}
	} catch (error) {
		// Ignore errors - this is just for better error messages
	}

	return null;
}

/**
 * Generate a helpful error message when the platform package is missing
 */
export function generatePlatformErrorMessage(requestedPkg, foundPlatform = /** @type {object} */ (null)) {
	const currentPlatform = `${process.platform} ${os.arch()} ${os.endianness()}`;

	let message = `The package "${requestedPkg}" could not be found, and is needed by http3-server.

Current platform: ${currentPlatform}`;

	if (foundPlatform) {
		message += `
Found package: ${foundPlatform.packageName} (for ${foundPlatform.platformKey})

This usually happens when:
1. You installed http3-server on one platform and copied node_modules to another
2. You"re using Docker and copied node_modules from the host
3. You"re switching between different architectures (e.g., x64 vs arm64)

To fix this:
1. Delete node_modules and package-lock.json
2. Run "npm install" on the target platform
3. Or use "npm ci" if you have a package-lock.json`;
	} else {
		message += `

To fix this:
1. Make sure you didn"t use "--no-optional" when installing
2. Check that your platform is supported
3. Try running "npm install ${requestedPkg}" manually`;
	}

	return message;
}

// Re-export createRequire for compatibility
export { createRequire };
