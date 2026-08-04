import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { test } from "node:test";
import { createDevelopmentCertificate } from "../index.js";

test("creates a WebTransport-compatible P-256 certificate", async () => {
	const generated = await createDevelopmentCertificate();
	const certificate = new X509Certificate(generated.certificatePEM);
	assert.deepEqual(certificate.raw, Buffer.from(generated.certificateDER));
	assert.equal(certificate.ca, false);
	assert.equal(certificate.checkHost("localhost"), "localhost");
	assert.equal(certificate.checkIP("127.0.0.1"), "127.0.0.1");
	assert.equal(certificate.checkIP("::1"), "::1");
	assert.equal(certificate.publicKey.asymmetricKeyType, "ec");
	assert.equal(certificate.publicKey.asymmetricKeyDetails.namedCurve, "prime256v1");
	assert.equal(certificate.verify(certificate.publicKey), true);
	assert.ok(
		new Date(certificate.validTo) - new Date(certificate.validFrom) < 14 * 24 * 60 * 60 * 1000
	);

	const privateKey = createPrivateKey(generated.privateKeyPEM);
	const publicFromPrivate = createPublicKey(privateKey).export({ format: "der", type: "spki" });
	const publicFromCertificate = certificate.publicKey.export({ format: "der", type: "spki" });
	assert.deepEqual(publicFromPrivate, publicFromCertificate);
	assert.deepEqual(
		generated.certificateHash,
		new Uint8Array(createHash("sha256").update(certificate.raw).digest())
	);
	assert.deepEqual(generated.serverCertificateHashes, [
		{ algorithm: "sha-256", value: generated.certificateHash },
	]);
});

test("supports explicit development names and IPv4-embedded IPv6", async () => {
	const generated = await createDevelopmentCertificate({
		commonName: "game.test",
		dnsNames: ["game.test", "GAME.TEST"],
		ipAddresses: ["192.0.2.10", "::ffff:192.0.2.10"],
	});
	const certificate = new X509Certificate(generated.certificatePEM);
	assert.equal(certificate.checkHost("game.test"), "game.test");
	assert.equal(certificate.checkIP("192.0.2.10"), "192.0.2.10");
	assert.equal(certificate.checkIP("::ffff:192.0.2.10"), "::ffff:192.0.2.10");
});

test("uses unique keys, serials, and certificate hashes", async () => {
	const [first, second] = await Promise.all([
		createDevelopmentCertificate(),
		createDevelopmentCertificate(),
	]);
	assert.notDeepEqual(first.privateKeyPKCS8, second.privateKeyPKCS8);
	assert.notDeepEqual(first.certificateHash, second.certificateHash);
	assert.notEqual(
		new X509Certificate(first.certificatePEM).serialNumber,
		new X509Certificate(second.certificatePEM).serialNumber
	);
});

test("rejects invalid names, addresses, dates, and validity periods", async () => {
	await assert.rejects(createDevelopmentCertificate({ dnsNames: ["bad name"] }), /Invalid DNS/);
	await assert.rejects(
		createDevelopmentCertificate({ ipAddresses: ["127.0.0.999"] }),
		/Invalid IP/
	);
	await assert.rejects(createDevelopmentCertificate({ ipAddresses: ["1::2::3"] }), /Invalid IP/);
	await assert.rejects(
		createDevelopmentCertificate({ dnsNames: [], ipAddresses: [] }),
		/At least one/
	);
	await assert.rejects(createDevelopmentCertificate({ now: new Date("invalid") }), /valid Date/);
	await assert.rejects(createDevelopmentCertificate({ validityDays: 14 }), /1 through 13/);
	await assert.rejects(
		createDevelopmentCertificate({ dnsNames: "localhost" }),
		/must be an array/
	);
	await assert.rejects(
		createDevelopmentCertificate({ dnsNames: Array.from({ length: 129 }, () => "localhost") }),
		/more than 128/
	);
	await assert.rejects(createDevelopmentCertificate({ commonName: "bad\u0000name" }), /control/);
});
