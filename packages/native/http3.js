// @ts-check

import { createRequire } from "node:module";
import {
	findInstalledPlatformPackage,
	generatePlatformErrorMessage,
	getLocalPlatformModule,
	getPackageForCurrentPlatform,
} from "./install.js";

function loadNativeModule() {
	const pkg = getPackageForCurrentPlatform();
	const require = createRequire(import.meta.url);
	const localModule = getLocalPlatformModule(pkg);

	try {
		if (localModule) return require(localModule).HTTP3Server;
		// first try to load from the platform-specific package
		return require(pkg).HTTP3Server;
	} catch (error) {
		console.error(`Failed to load native module from package "${pkg}":`, error.message);

		// try to provide helpful error messages
		if (error.code === "MODULE_NOT_FOUND") {
			const foundPlatform = findInstalledPlatformPackage();
			const errorMessage = generatePlatformErrorMessage(pkg, foundPlatform);

			console.error(`\n${errorMessage}`);
		}

		throw error;
	}
}

/** @type {typeof import("./http3.js").HTTP3Server} */
export const HTTP3Server = loadNativeModule();
