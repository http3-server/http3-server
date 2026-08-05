import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createDevelopmentCertificateChain,
	ensureTrustedDevelopmentCertificate,
} from "../trusted.js";

test("creates a CA-signed P-256 certificate chain for ordinary local HTTPS", async () => {
	const generated = await createDevelopmentCertificateChain({
		dnsNames: ["app.localhost.test"],
		ipAddresses: ["127.0.0.1"],
	});
	const authority = new X509Certificate(generated.authorityCertificatePEM);
	const certificate = new X509Certificate(generated.certificatePEM);

	assert.equal(authority.ca, true);
	assert.equal(certificate.ca, false);
	assert.equal(certificate.checkHost("app.localhost.test"), "app.localhost.test");
	assert.equal(certificate.checkIP("127.0.0.1"), "127.0.0.1");
	assert.equal(certificate.verify(authority.publicKey), true);
	assert.equal(authority.publicKey.asymmetricKeyType, "ec");
	assert.equal(certificate.publicKey.asymmetricKeyDetails.namedCurve, "prime256v1");
	assert.ok(new Date(certificate.validFrom).getTime() <= Date.now());
	assert.ok(new Date(certificate.validTo).getTime() <= Date.now() + 366 * 24 * 60 * 60 * 1000);

	const expected = createPublicKey(createPrivateKey(generated.privateKeyPEM)).export({
		format: "der",
		type: "spki",
	});
	assert.deepEqual(certificate.publicKey.export({ format: "der", type: "spki" }), expected);
});

test("stores and reuses a trusted certificate profile without mutating trust when disabled", async () => {
	const directory = await mkdtemp(join(tmpdir(), "http3-trusted-certificate-"));
	try {
		const first = await ensureTrustedDevelopmentCertificate({ directory, installTrust: false });
		assert.equal(first.reused, false);
		assert.equal(first.trusted, false);
		assert.match(await readFile(first.authorityCertificateFile, "utf8"), /BEGIN CERTIFICATE/);
		assert.match(await readFile(first.certificateFile, "utf8"), /BEGIN CERTIFICATE/);
		if (process.platform !== "win32") {
			assert.equal((await stat(first.privateKeyFile)).mode & 0o777, 0o600);
		}

		const second = await ensureTrustedDevelopmentCertificate({
			directory,
			installTrust: false,
		});
		assert.equal(second.reused, true);
		assert.equal(second.fingerprint, first.fingerprint);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("validates trusted certificate names and validity", async () => {
	await assert.rejects(
		createDevelopmentCertificateChain({ dnsNames: [], ipAddresses: [] }),
		/At least one/
	);
	await assert.rejects(createDevelopmentCertificateChain({ validityDays: 398 }), /1 through 397/);
	await assert.rejects(
		createDevelopmentCertificateChain({ authorityName: "bad\u0000name" }),
		/control/
	);
});
