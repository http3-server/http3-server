import { createDevelopmentCertificate } from "@http3-server/dev-certificates";
import { ensureDevelopmentCertificate } from "@http3-server/dev-certificates/node";
import {
	createDevelopmentCertificateChain,
	ensureTrustedDevelopmentCertificate,
	removeTrustedDevelopmentCertificate,
} from "@http3-server/dev-certificates/node/trusted";

const generated = await createDevelopmentCertificate({
	dnsNames: ["localhost"],
	ipAddresses: ["127.0.0.1", "::1"],
	validityDays: 10,
});
const hash: Uint8Array = generated.serverCertificateHashes[0]?.value ?? new Uint8Array();
void hash;

const stored = await ensureDevelopmentCertificate({
	directory: ".http3s",
	renewBeforeMs: 86_400_000,
});
const certificateFile: string = stored.certificateFile;
void certificateFile;

const chain = await createDevelopmentCertificateChain({
	dnsNames: ["app.localhost.test"],
	ipAddresses: ["127.0.0.1"],
});
const authorityCertificatePEM: string = chain.authorityCertificatePEM;
void authorityCertificatePEM;

const trusted = await ensureTrustedDevelopmentCertificate({
	directory: ".http3s/trusted",
	installTrust: false,
});
const trustedCertificateFile: string = trusted.certificateFile;
const isTrusted: boolean = trusted.trusted;
void trustedCertificateFile;
void isTrusted;
void removeTrustedDevelopmentCertificate({ directory: ".http3s/trusted" });
