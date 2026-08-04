import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commitImports } from "./import-binaries.js";

function write(path, value) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, value);
}

test("binary imports roll back every package after a mid-commit failure", () => {
	const root = mkdtempSync(join(tmpdir(), "http3-import-test-"));
	try {
		const imports = ["alpha", "beta"].map((id) => {
			const sourceDirectory = join(root, "source", id);
			const targetDirectory = join(root, "binaries", id);
			write(join(sourceDirectory, "runtime.node"), `new-${id}`);
			write(join(sourceDirectory, "build-manifest.json"), `manifest-${id}`);
			write(join(targetDirectory, "runtime.node"), `old-${id}`);
			write(join(targetDirectory, "build-manifest.json"), `old-manifest-${id}`);
			write(join(targetDirectory, "package.json"), `package-${id}`);
			return {
				platform: { id, files: ["runtime.node"] },
				sourceDirectory,
				targetDirectory,
				manifestPath: join(sourceDirectory, "build-manifest.json"),
			};
		});
		write(join(root, "source", "http3.d.ts"), "new declarations");
		write(join(root, "packages", "native", "http3.d.ts"), "old declarations");
		write(join(root, "packages", "native", "package.json"), "native package");

		assert.throws(
			() =>
				commitImports({
					projectRoot: root,
					imports,
					declarationSource: join(root, "source", "http3.d.ts"),
					beforeInstall(index) {
						if (index === 1) throw new Error("injected commit failure");
					},
				}),
			/injected commit failure/
		);

		for (const id of ["alpha", "beta"]) {
			assert.equal(
				readFileSync(join(root, "binaries", id, "runtime.node"), "utf8"),
				`old-${id}`
			);
			assert.equal(
				readFileSync(join(root, "binaries", id, "package.json"), "utf8"),
				`package-${id}`
			);
		}
		assert.equal(
			readFileSync(join(root, "packages", "native", "http3.d.ts"), "utf8"),
			"old declarations"
		);
		assert.deepEqual(
			readFileSync(join(root, "packages", "native", "package.json"), "utf8"),
			"native package"
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("binary imports replace all packages and declarations together", () => {
	const root = mkdtempSync(join(tmpdir(), "http3-import-test-"));
	try {
		const sourceDirectory = join(root, "source", "alpha");
		const targetDirectory = join(root, "binaries", "alpha");
		write(join(sourceDirectory, "runtime.node"), "new runtime");
		write(join(sourceDirectory, "build-manifest.json"), "new manifest");
		write(join(targetDirectory, "runtime.node"), "old runtime");
		write(join(targetDirectory, "build-manifest.json"), "old manifest");
		write(join(targetDirectory, "package.json"), "package metadata");
		write(join(root, "source", "http3.d.ts"), "new declarations");
		write(join(root, "packages", "native", "http3.d.ts"), "old declarations");

		commitImports({
			projectRoot: root,
			imports: [
				{
					platform: { id: "alpha", files: ["runtime.node"] },
					sourceDirectory,
					targetDirectory,
					manifestPath: join(sourceDirectory, "build-manifest.json"),
				},
			],
			declarationSource: join(root, "source", "http3.d.ts"),
		});

		assert.equal(readFileSync(join(targetDirectory, "runtime.node"), "utf8"), "new runtime");
		assert.equal(
			readFileSync(join(targetDirectory, "package.json"), "utf8"),
			"package metadata"
		);
		assert.equal(
			readFileSync(join(root, "packages", "native", "http3.d.ts"), "utf8"),
			"new declarations"
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
