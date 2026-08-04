import {
	createHash,
	createPrivateKey,
	createPublicKey,
	randomUUID,
	X509Certificate,
} from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createDevelopmentCertificate } from "./index.js";

const DAY = 24 * 60 * 60 * 1000;
const CACHE_FORMAT_VERSION = 1;

function hashes(certificate) {
	const certificateHash = new Uint8Array(createHash("sha256").update(certificate.raw).digest());
	return {
		certificateHash,
		serverCertificateHashes: [{ algorithm: "sha-256", value: certificateHash.slice() }],
	};
}

function matchesPrivateKey(certificate, privateKeyPEM) {
	const privateKey = createPrivateKey(privateKeyPEM);
	const expected = createPublicKey(privateKey).export({ format: "der", type: "spki" });
	const actual = certificate.publicKey.export({ format: "der", type: "spki" });
	return expected.equals(actual);
}

async function readStoredCertificate(paths, options, renewBeforeMs) {
	const [certificatePEM, privateKeyPEM] = await Promise.all([
		readFile(paths.certificateFile, "utf8"),
		readFile(paths.privateKeyFile, "utf8"),
	]);
	const certificate = new X509Certificate(certificatePEM);
	const validFrom = new Date(certificate.validFrom);
	const validTo = new Date(certificate.validTo);
	const now = options.now ? new Date(options.now) : new Date();
	const dnsNames = options.dnsNames ?? ["localhost"];
	const ipAddresses = options.ipAddresses ?? ["127.0.0.1", "::1"];
	if (
		Number.isNaN(now.getTime()) ||
		now < validFrom ||
		validTo.getTime() - now.getTime() <= renewBeforeMs ||
		validTo.getTime() - validFrom.getTime() >= 14 * DAY ||
		certificate.ca ||
		certificate.publicKey.asymmetricKeyType !== "ec" ||
		certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
		!certificate.verify(certificate.publicKey) ||
		!matchesPrivateKey(certificate, privateKeyPEM) ||
		dnsNames.some((name) => !certificate.checkHost(name)) ||
		ipAddresses.some((address) => !certificate.checkIP(address))
	) {
		throw new Error("Stored development certificate is not reusable");
	}
	return { ...paths, ...hashes(certificate), reused: true, validFrom, validTo };
}

async function writeAtomically(path, data, mode) {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, data, { flag: "wx", mode });
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}

function cachePath(directory, filename) {
	if (typeof filename !== "string" || basename(filename) !== filename) {
		throw new Error("Development certificate cache contains an invalid filename");
	}
	const path = resolve(directory, filename);
	if (dirname(path) !== directory) {
		throw new Error("Development certificate cache points outside its directory");
	}
	return path;
}

async function readCache(directory, profile) {
	const cacheFile = join(directory, "current.json");
	const cache = JSON.parse(await readFile(cacheFile, "utf8"));
	if (cache.formatVersion !== CACHE_FORMAT_VERSION) {
		throw new Error("Development certificate cache has an unsupported format");
	}
	if (JSON.stringify(cache.profile) !== JSON.stringify(profile)) {
		throw new Error("Development certificate cache has a different profile");
	}
	return {
		certificateFile: cachePath(directory, cache.certificateFile),
		privateKeyFile: cachePath(directory, cache.privateKeyFile),
	};
}

function isRecoverableCacheError(error) {
	if (!(error instanceof Error) || !("code" in error)) return true;
	return error.code !== "EACCES" && error.code !== "EPERM";
}

export async function ensureDevelopmentCertificate(options) {
	if (!options || typeof options.directory !== "string" || options.directory.length === 0) {
		throw new TypeError("directory is required");
	}
	const renewBeforeMs = options.renewBeforeMs ?? DAY;
	if (!Number.isFinite(renewBeforeMs) || renewBeforeMs < 0) {
		throw new RangeError("renewBeforeMs must be a non-negative finite number");
	}
	if (options.dnsNames !== undefined && !Array.isArray(options.dnsNames)) {
		throw new TypeError("dnsNames must be an array");
	}
	if (options.ipAddresses !== undefined && !Array.isArray(options.ipAddresses)) {
		throw new TypeError("ipAddresses must be an array");
	}
	const profile = {
		commonName: options.commonName ?? null,
		dnsNames: [...(options.dnsNames ?? ["localhost"])],
		ipAddresses: [...(options.ipAddresses ?? ["127.0.0.1", "::1"])],
		validityDays: options.validityDays ?? 10,
	};
	if (profile.dnsNames.length + profile.ipAddresses.length === 0) {
		throw new TypeError("At least one DNS name or IP address is required");
	}
	const generationOptions = {
		...options,
		...profile,
		commonName: profile.commonName ?? undefined,
	};
	const directory = resolve(options.directory);
	await mkdir(directory, { mode: 0o700, recursive: true });
	try {
		return await readStoredCertificate(
			await readCache(directory, profile),
			generationOptions,
			renewBeforeMs
		);
	} catch (error) {
		if (!isRecoverableCacheError(error)) throw error;
	}

	const generated = await createDevelopmentCertificate(generationOptions);
	const identifier = randomUUID();
	const paths = {
		certificateFile: join(directory, `certificate-${identifier}.pem`),
		privateKeyFile: join(directory, `private-key-${identifier}.pem`),
	};
	await Promise.all([
		writeFile(paths.privateKeyFile, generated.privateKeyPEM, { flag: "wx", mode: 0o600 }),
		writeFile(paths.certificateFile, generated.certificatePEM, { flag: "wx", mode: 0o644 }),
	]);
	await writeAtomically(
		join(directory, "current.json"),
		`${JSON.stringify({
			formatVersion: CACHE_FORMAT_VERSION,
			certificateFile: basename(paths.certificateFile),
			privateKeyFile: basename(paths.privateKeyFile),
			profile,
		})}\n`,
		0o600
	);
	return {
		...paths,
		certificateHash: generated.certificateHash,
		reused: false,
		serverCertificateHashes: generated.serverCertificateHashes,
		validFrom: generated.validFrom,
		validTo: generated.validTo,
	};
}
