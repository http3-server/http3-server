import { createDevelopmentCertificate } from "@http3-server/dev-certificates";

const generated = await createDevelopmentCertificate();
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", generated.certificateDER));
if (generated.certificateDER[0] !== 0x30) throw new Error("Certificate is not a DER sequence");
if (generated.privateKeyPKCS8[0] !== 0x30) throw new Error("Private key is not PKCS#8 DER");
if (generated.certificateHash.length !== 32) throw new Error("Certificate hash is not SHA-256");
if (!generated.certificateHash.every((byte, index) => byte === digest[index])) {
	throw new Error("Certificate hash does not match the DER certificate");
}
if (!generated.certificatePEM.includes("BEGIN CERTIFICATE"))
	throw new Error("Missing PEM certificate");
if (!generated.privateKeyPEM.includes("BEGIN PRIVATE KEY"))
	throw new Error("Missing PEM private key");

const runtime =
	typeof globalThis.Bun !== "undefined"
		? `Bun ${globalThis.Bun.version}`
		: typeof globalThis.Deno !== "undefined"
			? `Deno ${globalThis.Deno.version.deno}`
			: `Node ${process.versions.node}`;
console.log(`portable development certificate passed on ${runtime}`);
