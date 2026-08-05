import { spawn } from "node:child_process";
import { createPrivateKey, createPublicKey, randomUUID, X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { createCertificate } from "./x509.js";

const DAY = 24 * 60 * 60 * 1000;
const CACHE_FORMAT_VERSION = 1;
const DEFAULT_AUTHORITY_NAME = "http3-server development CA";
const pending = new Map();

export async function createDevelopmentCertificateChain(options = {}) {
	if (!options || typeof options !== "object") throw new TypeError("options must be an object");
	const authorityName = options.authorityName ?? DEFAULT_AUTHORITY_NAME;
	const validityDays = options.validityDays ?? 365;
	const authority = await createCertificate({
		authority: true,
		commonName: authorityName,
		maximumValidityDays: 397,
		now: options.now,
		validityDays,
	});
	const server = await createCertificate({
		commonName: options.commonName,
		dnsNames: options.dnsNames,
		ipAddresses: options.ipAddresses,
		issuerCommonName: authorityName,
		maximumValidityDays: 397,
		now: options.now,
		signingKey: authority.privateKey,
		validityDays,
	});

	return {
		authorityCertificatePEM: authority.certificatePEM,
		certificatePEM: `${server.certificatePEM}${authority.certificatePEM}`,
		privateKeyPEM: server.privateKeyPEM,
		validFrom: server.validFrom,
		validTo: server.validTo,
	};
}

export function ensureTrustedDevelopmentCertificate(options) {
	if (!options || typeof options.directory !== "string" || options.directory.length === 0) {
		return Promise.reject(new TypeError("directory is required"));
	}
	const directory = resolve(options.directory);
	const previous = pending.get(directory) ?? Promise.resolve();
	const next = previous
		.catch(() => undefined)
		.then(() => ensureTrustedDevelopmentCertificateOnce({ ...options, directory }));
	pending.set(directory, next);
	const cleanup = () => {
		if (pending.get(directory) === next) pending.delete(directory);
	};
	void next.then(cleanup, cleanup);
	return next;
}

async function ensureTrustedDevelopmentCertificateOnce(options) {
	const profile = profileFrom(options);
	const renewBeforeMs = options.renewBeforeMs ?? 30 * DAY;
	if (!Number.isFinite(renewBeforeMs) || renewBeforeMs < 0) {
		throw new RangeError("renewBeforeMs must be a non-negative finite number");
	}
	const installTrust = options.installTrust !== false;
	await mkdir(options.directory, { mode: 0o700, recursive: true });

	let previous;
	let previousAuthority;
	try {
		previous = await readCache(options.directory);
		previousAuthority = await validateCachedAuthority(previous);
		if (JSON.stringify(previous.profile) !== JSON.stringify(profile)) {
			throw new Error("Trusted certificate cache has a different profile");
		}
		const reused = await readStoredCertificate(previous, profile, options.now, renewBeforeMs);
		const trusted = installTrust
			? await ensureAuthorityTrusted(reused.authorityCertificateFile, profile.authorityName)
			: false;
		return { ...reused, reused: true, trusted };
	} catch (error) {
		if (!isRecoverableCacheError(error)) throw error;
	}

	const generated = await createDevelopmentCertificateChain({
		...profile,
		now: options.now,
	});
	const identifier = randomUUID();
	const paths = {
		authorityCertificateFile: join(options.directory, `authority-${identifier}.pem`),
		certificateFile: join(options.directory, `certificate-${identifier}.pem`),
		privateKeyFile: join(options.directory, `private-key-${identifier}.pem`),
	};
	await Promise.all([
		writeFile(paths.authorityCertificateFile, generated.authorityCertificatePEM, {
			flag: "wx",
			mode: 0o644,
		}),
		writeFile(paths.certificateFile, generated.certificatePEM, { flag: "wx", mode: 0o644 }),
		writeFile(paths.privateKeyFile, generated.privateKeyPEM, { flag: "wx", mode: 0o600 }),
	]);

	const authority = new X509Certificate(generated.authorityCertificatePEM);
	const fingerprint = normalizeFingerprint(authority.fingerprint256);
	const trusted = installTrust
		? await ensureAuthorityTrusted(paths.authorityCertificateFile, profile.authorityName)
		: false;
	if (trusted && previousAuthority && previousAuthority.fingerprint !== fingerprint) {
		await removeAuthorityTrust(
			previousAuthority.certificateFile,
			previousAuthority.fingerprint,
			previousAuthority.authorityName
		);
	}

	await writeAtomically(
		join(options.directory, "trusted-current.json"),
		`${JSON.stringify({
			formatVersion: CACHE_FORMAT_VERSION,
			authorityCertificateFile: paths.authorityCertificateFile,
			certificateFile: paths.certificateFile,
			fingerprint,
			privateKeyFile: paths.privateKeyFile,
			profile,
		})}\n`,
		0o600
	);
	if (previousAuthority) {
		await Promise.all([
			rm(previous.authorityCertificateFile, { force: true }),
			rm(previous.certificateFile, { force: true }),
			rm(previous.privateKeyFile, { force: true }),
		]);
	}

	return {
		...paths,
		fingerprint,
		reused: false,
		trusted,
		validFrom: generated.validFrom,
		validTo: generated.validTo,
	};
}

export async function removeTrustedDevelopmentCertificate(options) {
	if (!options || typeof options.directory !== "string" || options.directory.length === 0) {
		throw new TypeError("directory is required");
	}
	const directory = resolve(options.directory);
	let cache;
	try {
		cache = await readCache(directory);
	} catch (error) {
		if (isRecoverableCacheError(error)) return false;
		throw error;
	}
	await validateCachedAuthority(cache);
	await removeAuthorityTrust(
		cache.authorityCertificateFile,
		cache.fingerprint,
		cache.profile.authorityName
	);
	await Promise.all([
		rm(cache.authorityCertificateFile, { force: true }),
		rm(cache.certificateFile, { force: true }),
		rm(cache.privateKeyFile, { force: true }),
		rm(join(directory, "trusted-current.json"), { force: true }),
	]);
	return true;
}

async function validateCachedAuthority(cache) {
	const certificate = new X509Certificate(await readFile(cache.authorityCertificateFile));
	const fingerprint = normalizeFingerprint(certificate.fingerprint256);
	if (!certificate.ca || fingerprint !== cache.fingerprint) {
		throw new Error("Trusted certificate cache does not match its certificate authority");
	}
	if (
		typeof cache.profile?.authorityName !== "string" ||
		cache.profile.authorityName.length === 0
	) {
		throw new Error("Trusted certificate cache has an invalid authority name");
	}
	return {
		authorityName: cache.profile.authorityName,
		certificateFile: cache.authorityCertificateFile,
		fingerprint,
	};
}

function profileFrom(options) {
	if (options.dnsNames !== undefined && !Array.isArray(options.dnsNames)) {
		throw new TypeError("dnsNames must be an array");
	}
	if (options.ipAddresses !== undefined && !Array.isArray(options.ipAddresses)) {
		throw new TypeError("ipAddresses must be an array");
	}
	const profile = {
		authorityName: options.authorityName ?? DEFAULT_AUTHORITY_NAME,
		commonName: options.commonName ?? null,
		dnsNames: [...(options.dnsNames ?? ["localhost"])],
		ipAddresses: [...(options.ipAddresses ?? ["127.0.0.1", "::1"])],
		validityDays: options.validityDays ?? 365,
	};
	if (profile.dnsNames.length + profile.ipAddresses.length === 0) {
		throw new TypeError("At least one DNS name or IP address is required");
	}
	return profile;
}

async function readCache(directory) {
	const cache = JSON.parse(await readFile(join(directory, "trusted-current.json"), "utf8"));
	if (cache.formatVersion !== CACHE_FORMAT_VERSION) {
		throw new Error("Trusted certificate cache has an unsupported format");
	}
	return {
		authorityCertificateFile: cachePath(directory, cache.authorityCertificateFile),
		certificateFile: cachePath(directory, cache.certificateFile),
		fingerprint: normalizeFingerprint(cache.fingerprint),
		privateKeyFile: cachePath(directory, cache.privateKeyFile),
		profile: cache.profile,
	};
}

async function readStoredCertificate(paths, profile, nowOption, renewBeforeMs) {
	const [authorityPEM, certificatePEM, privateKeyPEM] = await Promise.all([
		readFile(paths.authorityCertificateFile, "utf8"),
		readFile(paths.certificateFile, "utf8"),
		readFile(paths.privateKeyFile, "utf8"),
	]);
	const authority = new X509Certificate(authorityPEM);
	const certificate = new X509Certificate(certificatePEM);
	const now = nowOption ? new Date(nowOption) : new Date();
	const validFrom = new Date(certificate.validFrom);
	const validTo = new Date(certificate.validTo);
	const expectedPublicKey = createPublicKey(createPrivateKey(privateKeyPEM)).export({
		format: "der",
		type: "spki",
	});
	const actualPublicKey = certificate.publicKey.export({ format: "der", type: "spki" });
	const fingerprint = normalizeFingerprint(authority.fingerprint256);
	if (
		Number.isNaN(now.getTime()) ||
		!authority.ca ||
		certificate.ca ||
		now < validFrom ||
		validTo.getTime() - now.getTime() <= renewBeforeMs ||
		!certificate.verify(authority.publicKey) ||
		!expectedPublicKey.equals(actualPublicKey) ||
		profile.dnsNames.some((name) => !certificate.checkHost(name)) ||
		profile.ipAddresses.some((address) => !certificate.checkIP(address)) ||
		fingerprint !== paths.fingerprint
	) {
		throw new Error("Stored trusted development certificate is not reusable");
	}
	return { ...paths, fingerprint, validFrom, validTo };
}

function cachePath(directory, path) {
	if (typeof path !== "string")
		throw new Error("Trusted certificate cache contains an invalid path");
	const resolved = resolve(path);
	if (dirname(resolved) !== directory) {
		throw new Error("Trusted certificate cache points outside its directory");
	}
	return resolved;
}

function isRecoverableCacheError(error) {
	if (!(error instanceof Error) || !("code" in error)) return true;
	return error.code !== "EACCES" && error.code !== "EPERM";
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

async function ensureAuthorityTrusted(certificateFile, authorityName) {
	const certificate = new X509Certificate(await readFile(certificateFile));
	const fingerprint = normalizeFingerprint(certificate.fingerprint256);
	if (await authorityIsTrusted(fingerprint, authorityName)) return true;
	await installAuthorityTrust(certificateFile, fingerprint);
	if (!(await authorityIsTrusted(fingerprint, authorityName))) {
		throw new Error(
			"The development certificate authority was installed but could not be verified"
		);
	}
	return true;
}

async function authorityIsTrusted(fingerprint, authorityName) {
	switch (process.platform) {
		case "darwin": {
			const result = await run(
				"/usr/bin/security",
				[
					"find-certificate",
					"-a",
					"-Z",
					"-c",
					authorityName,
					"/Library/Keychains/System.keychain",
				],
				{ allowFailure: true }
			);
			return result.code === 0 && normalizeFingerprint(result.output).includes(fingerprint);
		}
		case "win32": {
			const result = await run("certutil", ["-user", "-store", "Root", fingerprint], {
				allowFailure: true,
			});
			return result.code === 0;
		}
		case "linux": {
			const anchor = await linuxAnchor(fingerprint);
			try {
				const installed = new X509Certificate(await readFile(anchor.path));
				return normalizeFingerprint(installed.fingerprint256) === fingerprint;
			} catch {
				if (anchor.method !== "p11-kit") return false;
				const result = await run("trust", ["list", "--filter=ca-anchors"], {
					allowFailure: true,
				});
				return result.code === 0 && result.output.includes(authorityName);
			}
		}
		default:
			throw new Error(`Automatic certificate trust is not supported on ${process.platform}`);
	}
}

async function installAuthorityTrust(certificateFile, fingerprint) {
	switch (process.platform) {
		case "darwin":
			await runElevated("/usr/bin/security", [
				"add-trusted-cert",
				"-d",
				"-r",
				"trustRoot",
				"-k",
				"/Library/Keychains/System.keychain",
				certificateFile,
			]);
			return;
		case "win32":
			await run("certutil", ["-user", "-addstore", "Root", certificateFile]);
			return;
		case "linux": {
			const anchor = await linuxAnchor(fingerprint);
			if (anchor.method === "p11-kit") {
				await runElevated("trust", ["anchor", certificateFile]);
				return;
			}
			await runElevated("install", ["-m", "0644", certificateFile, anchor.path]);
			await runElevated(anchor.refreshCommand, anchor.refreshArguments);
			return;
		}
		default:
			throw new Error(`Automatic certificate trust is not supported on ${process.platform}`);
	}
}

async function removeAuthorityTrust(certificateFile, fingerprint, authorityName) {
	if (!(await authorityIsTrusted(fingerprint, authorityName))) return;
	switch (process.platform) {
		case "darwin":
			await runElevated("/usr/bin/security", [
				"delete-certificate",
				"-Z",
				fingerprint,
				"/Library/Keychains/System.keychain",
			]);
			return;
		case "win32":
			await run("certutil", ["-user", "-delstore", "Root", fingerprint]);
			return;
		case "linux": {
			const anchor = await linuxAnchor(fingerprint);
			if (anchor.method === "p11-kit") {
				await runElevated("trust", ["anchor", "--remove", certificateFile]);
				return;
			}
			await runElevated("rm", ["-f", anchor.path]);
			await runElevated(anchor.refreshCommand, anchor.refreshArguments);
			return;
		}
	}
}

async function linuxAnchor(fingerprint) {
	const suffix = fingerprint.toLowerCase();
	if (await commandExists("update-ca-certificates")) {
		return {
			method: "debian",
			path: `/usr/local/share/ca-certificates/http3-server-${suffix}.crt`,
			refreshArguments: [],
			refreshCommand: "update-ca-certificates",
		};
	}
	if (await commandExists("update-ca-trust")) {
		return {
			method: "fedora",
			path: `/etc/pki/ca-trust/source/anchors/http3-server-${suffix}.pem`,
			refreshArguments: ["extract"],
			refreshCommand: "update-ca-trust",
		};
	}
	if (await commandExists("trust")) {
		return {
			method: "p11-kit",
			path: `/etc/http3-server-${suffix}.pem`,
			refreshArguments: [],
			refreshCommand: "trust",
		};
	}
	throw new Error("No supported Linux CA trust command was found");
}

async function commandExists(command) {
	const directories = new Set([
		"/usr/bin",
		"/usr/sbin",
		"/bin",
		"/sbin",
		...(process.env.PATH ?? "").split(delimiter),
	]);
	for (const directory of directories) {
		try {
			await access(join(directory, command), constants.X_OK);
			return true;
		} catch {
			// Try the next executable directory.
		}
	}
	return false;
}

function runElevated(command, arguments_) {
	return typeof process.getuid === "function" && process.getuid() === 0
		? run(command, arguments_)
		: run("sudo", [command, ...arguments_]);
}

function run(command, arguments_, options = {}) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, arguments_, { stdio: ["inherit", "pipe", "pipe"] });
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			const exitCode = code ?? 1;
			if (exitCode === 0 || options.allowFailure) {
				resolveRun({ code: exitCode, output });
			} else {
				reject(
					new Error(
						`${command} failed${signal === null ? ` with exit code ${exitCode}` : ` after ${signal}`}`
					)
				);
			}
		});
	});
}

function normalizeFingerprint(value) {
	if (typeof value !== "string") throw new TypeError("Certificate fingerprint must be a string");
	return value
		.replaceAll(":", "")
		.replaceAll(/[^A-Fa-f0-9]/g, "")
		.toUpperCase();
}

export const trustedDevelopmentCertificateDefaults = Object.freeze({
	authorityName: DEFAULT_AUTHORITY_NAME,
	validityDays: 365,
});
