// http3-native-server.js
// @ts-check

import { createRequire } from "module";
import { getPackageForCurrentPlatform, findInstalledPlatformPackage, generatePlatformErrorMessage } from "./platform.js";

/** @type {typeof import("./http3-native-server.js").HTTP3NativeServer} */
export let HTTP3NativeServer;

function loadNativeModule() {
	const pkg = getPackageForCurrentPlatform();
	const require = createRequire(import.meta.url);

	try {
		// first try to load from the platform-specific package
		return require(pkg).HTTP3Server;
	} catch (error) {
		console.error(`Failed to load native module from package "${pkg}":`, error.message);

		// try to provide helpful error messages
		if (error.code === "MODULE_NOT_FOUND") {
			const foundPlatform = findInstalledPlatformPackage();
			const errorMessage = generatePlatformErrorMessage(pkg, foundPlatform);

			console.error("\n" + errorMessage);
		}

		throw error;
	}
}

try {
	HTTP3NativeServer = loadNativeModule();
} catch (error) {
	console.error("Failed to initialize HTTP3Native:", error.message);
	// do nothing and continue
}
