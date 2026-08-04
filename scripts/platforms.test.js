import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentPlatform, platforms } from "./platforms.js";

test("selects exactly one Linux libc package", () => {
	const linuxX64 = platforms.filter(({ os, cpu }) => os === "linux" && cpu === "x64");
	assert.deepEqual(
		linuxX64.filter((platform) =>
			isCurrentPlatform(platform, { os: "linux", cpu: "x64", libc: "glibc" })
		),
		[platforms.find(({ id }) => id === "linux-x64-gnu")]
	);
	assert.deepEqual(
		linuxX64.filter((platform) =>
			isCurrentPlatform(platform, { os: "linux", cpu: "x64", libc: "musl" })
		),
		[platforms.find(({ id }) => id === "linux-x64-musl")]
	);
});
