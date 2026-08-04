/** Known platform-specific packages for HTTP/3 server. */
export const knownPlatformPackages = /** @type {Record<string, string>} */ ({
	// macOS
	"darwin arm64 LE": "@http3-server/darwin-arm64",
	"darwin x64 LE": "@http3-server/darwin-x64",

	// Linux
	"linux arm64 LE glibc": "@http3-server/linux-arm64-gnu",
	"linux arm64 LE musl": "@http3-server/linux-arm64-musl",
	"linux x64 LE glibc": "@http3-server/linux-x64-gnu",
	"linux x64 LE musl": "@http3-server/linux-x64-musl",

	// Windows
	"win32 arm64 LE": "@http3-server/win32-arm64",
	"win32 x64 LE": "@http3-server/win32-x64",
});

export const MESSAGE_FOR_PLATFORM_ERROR = (
	/** @type {string} */ requestedPkg,
	/** @type {string} */ currentPlatform
) => `The package "${requestedPkg}" could not be found, and is needed by http3-server.

Current platform: ${currentPlatform}`;

export const MESSAGE_FOR_PLATFORM_FOUND_ERROR = (
	/** @type {string} */ packageName,
	/** @type {string} */ platformKey
) => `Found package: ${packageName} (for ${platformKey})

This usually happens when:
1. You installed http3-server on one platform and copied node_modules to another
2. You"re using Docker and copied node_modules from the host
3. You"re switching between different architectures (e.g., x64 vs arm64)

To fix this:
1. Delete node_modules and package-lock.json
2. Run "npm install" on the target platform
3. Or use "npm ci" if you have a package-lock.json`;

export const MESSAGE_FOR_UNFOUND_ERROR = (/** @type {string} */ requestedPkg) => `

To fix this:
1. Make sure you didn"t use "--no-optional" when installing
2. Check that your platform is supported
3. Try running "npm install ${requestedPkg}" manually`;

export const MESSAGE_FOR_UNSUPPORTED_PLATFORM = (
	/** @type {string} */ platformKey
) => `Unsupported platform: ${platformKey}

The @http3-server/native package doesn"t have a binary for your platform.
Supported platforms:
${Object.keys(knownPlatformPackages)
	.map((key) => `  - ${key}`)
	.join("\n")}

You can:
1. Request support for your platform by opening an issue
2. Build from source if build tools are available
3. Use a different HTTP/3 implementation`;
