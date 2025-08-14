// test-platform.js - Test platform detection
import { getPackageForCurrentPlatform, findInstalledPlatformPackage } from "./platform.js";

console.log("Testing platform detection...");

try {
	const result = getPackageForCurrentPlatform();

	console.log("Platform detection result:", result);

	const installed = findInstalledPlatformPackage();

	if (installed) {
		console.log("Found installed platform package:", installed);
	} else {
		console.log("No platform packages found in node_modules");
	}
} catch (error) {
	console.error("Platform detection failed:", error.message);
}
