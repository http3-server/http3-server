// @ts-check

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { endianness } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Known platform-specific packages for HTTP/3 server. */
export const knownPlatformPackages = /** @type {Record<string, string>} */ ({
	"darwin arm64 LE": "@http3-server/darwin-arm64",
	"darwin x64 LE": "@http3-server/darwin-x64",
	"linux arm64 LE glibc": "@http3-server/linux-arm64-gnu",
	"linux arm64 LE musl": "@http3-server/linux-arm64-musl",
	"linux x64 LE glibc": "@http3-server/linux-x64-gnu",
	"linux x64 LE musl": "@http3-server/linux-x64-musl",
	"win32 arm64 LE": "@http3-server/win32-arm64",
	"win32 x64 LE": "@http3-server/win32-x64",
});

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
	architecture = process.arch,
	byteOrder = endianness(),
	report = process.report,
} = {}) =>
	[
		platform,
		architecture,
		byteOrder,
		...(platform === "linux" ? [detectLinuxLibc(report)] : []),
	].join(" ");

const supportedPlatforms = Object.keys(knownPlatformPackages)
	.map((key) => `  - ${key}`)
	.join("\n");

/** Returns the package name for the current platform. */
export const getPackageForCurrentPlatform = (runtime) => {
	const platformKey = getPlatformKey(runtime);
	const packageName = knownPlatformPackages[platformKey];
	if (packageName) return packageName;

	throw createNativeError(
		"HTTP3_UNSUPPORTED_PLATFORM",
		`Unsupported native HTTP/3 platform: ${platformKey}\n\nSupported platforms:\n${supportedPlatforms}`
	);
};

/** Returns the checked-out platform module while developing in the monorepo. */
export const getLocalPlatformModule = (packageName = getPackageForCurrentPlatform()) => {
	const platform = packageName.slice(packageName.lastIndexOf("/") + 1);
	const path = fileURLToPath(new URL(`../../binaries/${platform}/http3.js`, import.meta.url));
	return existsSync(path) ? path : null;
};

const nativePackageDirectory = dirname(fileURLToPath(import.meta.url));
const possibleNodeModulesDirectory = dirname(dirname(nativePackageDirectory));
const nodeModulesDirectory =
	basename(possibleNodeModulesDirectory) === "node_modules" ? possibleNodeModulesDirectory : null;

const getInstalledPackageDirectory = (packageName) =>
	nodeModulesDirectory ? join(nodeModulesDirectory, ...packageName.split("/")) : null;

/** Return every installed binary package visible beside the loader package. */
export const findInstalledPlatformPackages = () => {
	if (!nodeModulesDirectory) return [];

	return Object.entries(knownPlatformPackages)
		.filter(([, packageName]) => existsSync(getInstalledPackageDirectory(packageName)))
		.map(([platformKey, packageName]) => ({ platformKey, packageName }));
};

/** Return whether the current process exposes an explicit optional-dependency omission. */
export const wereOptionalDependenciesOmitted = (environment = process.env) => {
	const omit = environment.npm_config_omit ?? environment.NPM_CONFIG_OMIT ?? "";
	const optional = environment.npm_config_optional ?? environment.NPM_CONFIG_OPTIONAL;
	const ignoreOptional =
		environment.npm_config_ignore_optional ?? environment.NPM_CONFIG_IGNORE_OPTIONAL;
	return (
		omit.split(/[\s,]+/).includes("optional") ||
		optional === "false" ||
		ignoreOptional === "true"
	);
};

const defaultRequire = createRequire(import.meta.url);

const formatOriginalError = (error) => {
	if (error instanceof Error) {
		const code = "code" in error && error.code ? ` [${error.code}]` : "";
		return `${error.name}${code}: ${error.message}`;
	}
	return String(error);
};

function createNativeError(code, message, cause) {
	const error = new Error(message, cause === undefined ? undefined : { cause });
	error.code = code;
	return error;
}

function loadResolvedModule(packageName, resolvedModule, moduleLoader) {
	try {
		const nativeModule = moduleLoader(resolvedModule);
		if (typeof nativeModule?.HTTP3Server !== "function") {
			throw new TypeError(`${packageName} does not export an HTTP3Server constructor`);
		}
		return nativeModule.HTTP3Server;
	} catch (error) {
		throw createNativeError(
			"HTTP3_NATIVE_LOAD_FAILED",
			`The native module for ${packageName} is present but failed to load.\n\nOriginal loader error: ${formatOriginalError(error)}`,
			error
		);
	}
}

/** Resolve and load the native constructor selected for this runtime. */
export function loadNativeModule({
	runtime,
	moduleResolver = (packageName) => defaultRequire.resolve(packageName),
	moduleLoader = (resolvedModule) => defaultRequire(resolvedModule),
	localModule = getLocalPlatformModule(getPackageForCurrentPlatform(runtime)),
	installedPlatformPackages = findInstalledPlatformPackages(),
	expectedPackageDirectoryExists,
	optionalDependenciesOmitted = wereOptionalDependenciesOmitted(),
} = {}) {
	const platformKey = getPlatformKey(runtime);
	const packageName = getPackageForCurrentPlatform(runtime);

	if (localModule) return loadResolvedModule(packageName, localModule, moduleLoader);

	let resolvedModule;
	try {
		resolvedModule = moduleResolver(packageName);
	} catch (error) {
		const expectedDirectory = getInstalledPackageDirectory(packageName);
		const expectedDirectoryExists =
			expectedPackageDirectoryExists ??
			(expectedDirectory !== null && existsSync(expectedDirectory));

		if (expectedDirectoryExists) {
			throw createNativeError(
				"HTTP3_PLATFORM_PACKAGE_INVALID",
				`The expected platform package ${packageName} is installed but incomplete and its entry point could not be resolved.\n\nOriginal resolver error: ${formatOriginalError(error)}\n\nRemove node_modules and reinstall on this machine.`,
				error
			);
		}

		const wrongPlatforms = installedPlatformPackages.filter(
			({ packageName: installedPackageName }) => installedPackageName !== packageName
		);
		if (wrongPlatforms.length > 0) {
			const found = wrongPlatforms
				.map(
					({ packageName: foundPackage, platformKey: foundPlatform }) =>
						`  - ${foundPackage} (${foundPlatform})`
				)
				.join("\n");
			throw createNativeError(
				"HTTP3_WRONG_PLATFORM_DEPENDENCY",
				`The installed native packages do not match this machine (${platformKey}).\nExpected: ${packageName}\nFound:\n${found}\n\nThis usually means node_modules was copied from another OS, CPU, or libc environment. Remove node_modules and reinstall on the target machine.`,
				error
			);
		}

		if (optionalDependenciesOmitted) {
			throw createNativeError(
				"HTTP3_OPTIONAL_DEPENDENCIES_OMITTED",
				`The optional native dependency for this machine was omitted.\nExpected: ${packageName} (${platformKey})\n\nReinstall without --omit=optional, --no-optional, or equivalent package-manager configuration before using @http3-server/native.`,
				error
			);
		}

		throw createNativeError(
			"HTTP3_PLATFORM_PACKAGE_MISSING",
			`The expected platform package is missing.\nExpected: ${packageName} (${platformKey})\n\nNo platform package is installed, and the current process does not indicate that optional dependencies were deliberately omitted. Remove node_modules and reinstall on this machine. If omission was intentional, reinstall without --omit=optional, --no-optional, or equivalent package-manager configuration before using @http3-server/native.`,
			error
		);
	}

	return loadResolvedModule(packageName, resolvedModule, moduleLoader);
}
