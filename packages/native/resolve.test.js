import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	detectLinuxLibc,
	getPackageForCurrentPlatform,
	getPlatformKey,
	loadNativeModule,
	wereOptionalDependenciesOmitted,
} from "./resolve.js";

const report = (glibcVersionRuntime) => ({
	getReport: () => ({ header: glibcVersionRuntime ? { glibcVersionRuntime } : {} }),
});

const linuxX64 = {
	platform: "linux",
	architecture: "x64",
	byteOrder: "LE",
	report: report("2.36"),
};

const resolutionFailure = Object.assign(new Error("package entry was not found"), {
	code: "MODULE_NOT_FOUND",
});

const failingResolver = () => {
	throw resolutionFailure;
};

test("publishes a runtime resolver without install lifecycle scripts", () => {
	const packageJson = JSON.parse(
		readFileSync(new URL("./package.json", import.meta.url), "utf8")
	);
	for (const lifecycle of ["preinstall", "install", "postinstall"]) {
		assert.equal(packageJson.scripts?.[lifecycle], undefined, lifecycle);
	}
	assert.ok(packageJson.files.includes("resolve.js"));
	assert.equal(packageJson.files.includes("install.js"), false);
	assert.equal(packageJson.files.includes("install-constants.js"), false);
});

test("selects GNU and musl Linux packages", () => {
	assert.equal(detectLinuxLibc(report("2.36")), "glibc");
	assert.equal(detectLinuxLibc(report()), "musl");
	assert.equal(getPackageForCurrentPlatform(linuxX64), "@http3-server/linux-x64-gnu");
	assert.equal(
		getPackageForCurrentPlatform({
			...linuxX64,
			architecture: "arm64",
			report: report(),
		}),
		"@http3-server/linux-arm64-musl"
	);
});

test("leaves non-Linux platform keys unchanged", () => {
	assert.equal(
		getPlatformKey({ platform: "darwin", architecture: "arm64", byteOrder: "LE" }),
		"darwin arm64 LE"
	);
});

test("reports unsupported OS, CPU, or libc combinations", () => {
	assert.throws(
		() =>
			getPackageForCurrentPlatform({
				platform: "freebsd",
				architecture: "riscv64",
				byteOrder: "LE",
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_UNSUPPORTED_PLATFORM");
			assert.match(error.message, /freebsd riscv64 LE/);
			assert.match(error.message, /Supported platforms/);
			return true;
		}
	);
});

test("reports when optional platform dependencies were omitted", () => {
	assert.equal(wereOptionalDependenciesOmitted({ npm_config_omit: "dev,optional" }), true);
	assert.equal(wereOptionalDependenciesOmitted({ npm_config_optional: "false" }), true);

	assert.throws(
		() =>
			loadNativeModule({
				runtime: linuxX64,
				localModule: null,
				moduleResolver: failingResolver,
				installedPlatformPackages: [],
				expectedPackageDirectoryExists: false,
				optionalDependenciesOmitted: true,
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_OPTIONAL_DEPENDENCIES_OMITTED");
			assert.match(error.message, /--omit=optional/);
			assert.equal(error.cause, resolutionFailure);
			return true;
		}
	);
});

test("reports a missing expected platform package", () => {
	assert.throws(
		() =>
			loadNativeModule({
				runtime: linuxX64,
				localModule: null,
				moduleResolver: failingResolver,
				installedPlatformPackages: [],
				expectedPackageDirectoryExists: false,
				optionalDependenciesOmitted: false,
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_PLATFORM_PACKAGE_MISSING");
			assert.match(error.message, /expected platform package is missing/i);
			return true;
		}
	);
});

test("reports node_modules copied from another platform", () => {
	assert.throws(
		() =>
			loadNativeModule({
				runtime: linuxX64,
				localModule: null,
				moduleResolver: failingResolver,
				installedPlatformPackages: [
					{
						platformKey: "darwin arm64 LE",
						packageName: "@http3-server/darwin-arm64",
					},
				],
				expectedPackageDirectoryExists: false,
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_WRONG_PLATFORM_DEPENDENCY");
			assert.match(error.message, /copied from another OS, CPU, or libc environment/);
			assert.match(error.message, /@http3-server\/darwin-arm64/);
			return true;
		}
	);
});

test("reports an incomplete expected platform package", () => {
	assert.throws(
		() =>
			loadNativeModule({
				runtime: linuxX64,
				localModule: null,
				moduleResolver: failingResolver,
				installedPlatformPackages: [],
				expectedPackageDirectoryExists: true,
				optionalDependenciesOmitted: false,
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_PLATFORM_PACKAGE_INVALID");
			assert.match(error.message, /installed but incomplete/);
			assert.match(error.message, /package entry was not found/);
			return true;
		}
	);
});

test("preserves the original error when a present native module fails to load", () => {
	const loaderFailure = Object.assign(new Error("libmsquic.so: cannot open shared object"), {
		code: "ERR_DLOPEN_FAILED",
	});

	assert.throws(
		() =>
			loadNativeModule({
				runtime: linuxX64,
				localModule: null,
				moduleResolver: () => "/mock/http3.js",
				moduleLoader: () => {
					throw loaderFailure;
				},
				installedPlatformPackages: [],
			}),
		(error) => {
			assert.equal(error.code, "HTTP3_NATIVE_LOAD_FAILED");
			assert.match(error.message, /ERR_DLOPEN_FAILED/);
			assert.match(error.message, /libmsquic\.so/);
			assert.equal(error.cause, loaderFailure);
			return true;
		}
	);
});

test("loads the selected platform package", () => {
	class HTTP3Server {}
	assert.equal(
		loadNativeModule({
			runtime: linuxX64,
			localModule: null,
			moduleResolver: () => "/mock/http3.js",
			moduleLoader: () => ({ HTTP3Server }),
			installedPlatformPackages: [],
		}),
		HTTP3Server
	);
});
