// test-platform.js - Test platform detection
import { findInstalledPlatformPackages, getPackageForCurrentPlatform } from "../resolve.js";

console.log("Testing platform detection...");

try {
	const result = getPackageForCurrentPlatform();

	console.log("Platform detection result:", result);

	const installed = findInstalledPlatformPackages();

	if (installed.length > 0) {
		console.log("Found installed platform package:", installed);
	} else {
		console.log("No platform packages found in node_modules");
	}
} catch (error) {
	console.error("Platform detection failed:", error.message);
}
