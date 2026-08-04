import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureDevelopmentCertificate } from "../node.js";

test("stores, reuses, and rotates a development certificate", async () => {
	const directory = await mkdtemp(join(tmpdir(), "http3-dev-certificate-"));
	try {
		const first = await ensureDevelopmentCertificate({ directory });
		assert.equal(first.reused, false);
		assert.match(await readFile(first.certificateFile, "utf8"), /BEGIN CERTIFICATE/);
		assert.match(await readFile(first.privateKeyFile, "utf8"), /BEGIN PRIVATE KEY/);
		if (process.platform !== "win32") {
			assert.equal((await stat(first.privateKeyFile)).mode & 0o777, 0o600);
		}

		const second = await ensureDevelopmentCertificate({ directory });
		assert.equal(second.reused, true);
		assert.deepEqual(second.certificateHash, first.certificateHash);

		const rotated = await ensureDevelopmentCertificate({
			directory,
			renewBeforeMs: 11 * 24 * 60 * 60 * 1000,
		});
		assert.equal(rotated.reused, false);
		assert.notDeepEqual(rotated.certificateHash, first.certificateHash);

		const reprofiled = await ensureDevelopmentCertificate({
			directory,
			dnsNames: ["game.test"],
			ipAddresses: [],
		});
		assert.equal(reprofiled.reused, false);
		assert.notDeepEqual(reprofiled.certificateHash, rotated.certificateHash);
		assert.equal(
			(
				await ensureDevelopmentCertificate({
					directory,
					dnsNames: ["game.test"],
					ipAddresses: [],
				})
			).reused,
			true
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("recovers from an invalid cache without hiding permission errors", async () => {
	const directory = await mkdtemp(join(tmpdir(), "http3-dev-certificate-"));
	try {
		const first = await ensureDevelopmentCertificate({ directory });
		await writeFile(first.certificateFile, "invalid");
		const generated = await ensureDevelopmentCertificate({ directory });
		assert.equal(generated.reused, false);

		if (
			process.platform !== "win32" &&
			typeof process.getuid === "function" &&
			process.getuid() !== 0
		) {
			await chmod(generated.privateKeyFile, 0o000);
			await assert.rejects(ensureDevelopmentCertificate({ directory }), /EACCES/);
		}
	} finally {
		for (const filename of ["current.json"]) {
			await chmod(join(directory, filename), 0o600).catch(() => undefined);
		}
		const current = await readFile(join(directory, "current.json"), "utf8").catch(
			() => undefined
		);
		if (current) {
			const { privateKeyFile } = JSON.parse(current);
			await chmod(join(directory, privateKeyFile), 0o600).catch(() => undefined);
		}
		await rm(directory, { force: true, recursive: true });
	}
});

test("concurrent generation always returns matching immutable pairs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "http3-dev-certificate-"));
	try {
		const generated = await Promise.all(
			Array.from({ length: 8 }, () => ensureDevelopmentCertificate({ directory }))
		);
		for (const certificate of generated) {
			assert.match(await readFile(certificate.certificateFile, "utf8"), /BEGIN CERTIFICATE/);
			assert.match(await readFile(certificate.privateKeyFile, "utf8"), /BEGIN PRIVATE KEY/);
		}
		assert.equal((await ensureDevelopmentCertificate({ directory })).reused, true);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("validates an empty development profile before consulting the cache", async () => {
	const directory = await mkdtemp(join(tmpdir(), "http3-dev-certificate-"));
	try {
		await ensureDevelopmentCertificate({ directory });
		await assert.rejects(
			ensureDevelopmentCertificate({ directory, dnsNames: [], ipAddresses: [] }),
			/At least one/
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
