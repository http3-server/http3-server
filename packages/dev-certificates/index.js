import { createCertificate } from "./x509.js";

export async function createDevelopmentCertificate(options = {}) {
	if (!options || typeof options !== "object") throw new TypeError("options must be an object");
	const generated = await createCertificate({
		...options,
		maximumValidityDays: 13,
		validityDays: options.validityDays ?? 10,
	});
	const certificateHash = new Uint8Array(
		await globalThis.crypto.subtle.digest("SHA-256", generated.certificateDER)
	);

	return {
		certificateDER: generated.certificateDER,
		certificateHash,
		certificatePEM: generated.certificatePEM,
		privateKeyPEM: generated.privateKeyPEM,
		privateKeyPKCS8: generated.privateKeyPKCS8,
		serverCertificateHashes: [{ algorithm: "sha-256", value: certificateHash.slice() }],
		validFrom: generated.validFrom,
		validTo: generated.validTo,
	};
}
