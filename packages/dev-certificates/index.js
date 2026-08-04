const DAY = 24 * 60 * 60 * 1000;
const CLOCK_SKEW = 5 * 60 * 1000;
const MAXIMUM_NAMES = 128;
const textEncoder = new TextEncoder();

function concat(...parts) {
	const length = parts.reduce((total, part) => total + part.length, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function encodeLength(length) {
	if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid DER length");
	if (length < 128) return Uint8Array.of(length);
	const octets = [];
	for (let value = length; value > 0; value = Math.floor(value / 256)) {
		octets.unshift(value % 256);
	}
	return Uint8Array.of(0x80 | octets.length, ...octets);
}

function element(tag, value) {
	return concat(Uint8Array.of(tag), encodeLength(value.length), value);
}

function sequence(...values) {
	return element(0x30, concat(...values));
}

function set(...values) {
	return element(0x31, concat(...values));
}

function integer(value) {
	let bytes = value;
	while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.slice(1);
	if ((bytes[0] & 0x80) !== 0) bytes = concat(Uint8Array.of(0), bytes);
	return element(0x02, bytes);
}

function encodeBase128(value) {
	const bytes = [value % 128];
	for (
		let remaining = Math.floor(value / 128);
		remaining > 0;
		remaining = Math.floor(remaining / 128)
	) {
		bytes.unshift(0x80 | (remaining % 128));
	}
	return Uint8Array.from(bytes);
}

function objectIdentifier(identifier) {
	const arcs = identifier.split(".").map(Number);
	if (
		arcs.length < 2 ||
		!arcs.every((arc) => Number.isSafeInteger(arc) && arc >= 0) ||
		arcs[0] > 2 ||
		(arcs[0] < 2 && arcs[1] >= 40)
	) {
		throw new TypeError(`Invalid object identifier: ${identifier}`);
	}
	return element(
		0x06,
		concat(encodeBase128(arcs[0] * 40 + arcs[1]), ...arcs.slice(2).map(encodeBase128))
	);
}

function bitString(value, unusedBits = 0) {
	return element(0x03, concat(Uint8Array.of(unusedBits), value));
}

function octetString(value) {
	return element(0x04, value);
}

function boolean(value) {
	return element(0x01, Uint8Array.of(value ? 0xff : 0));
}

function utf8String(value) {
	return element(0x0c, textEncoder.encode(value));
}

function utcTime(date) {
	const year = date.getUTCFullYear();
	if (year < 1950 || year > 2049) throw new RangeError("Certificate dates must be 1950-2049");
	const stamp = [
		String(year % 100).padStart(2, "0"),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
		String(date.getUTCHours()).padStart(2, "0"),
		String(date.getUTCMinutes()).padStart(2, "0"),
		String(date.getUTCSeconds()).padStart(2, "0"),
		"Z",
	].join("");
	return element(0x17, textEncoder.encode(stamp));
}

function extension(identifier, value, critical = false) {
	return sequence(
		objectIdentifier(identifier),
		...(critical ? [boolean(true)] : []),
		octetString(value)
	);
}

function assertDnsName(name) {
	if (
		typeof name !== "string" ||
		name.length === 0 ||
		name.length > 253 ||
		!/^[A-Za-z0-9.-]+$/.test(name) ||
		name.startsWith(".") ||
		name.endsWith(".") ||
		name.includes("..") ||
		name
			.split(".")
			.some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))
	) {
		throw new TypeError(`Invalid DNS name: ${name}`);
	}
	return name.toLowerCase();
}

function parseIPv4(address) {
	const parts = address.split(".");
	if (parts.length !== 4) throw new TypeError(`Invalid IP address: ${address}`);
	const bytes = parts.map((part) => {
		if (!/^(0|[1-9]\d{0,2})$/.test(part)) throw new TypeError(`Invalid IP address: ${address}`);
		const value = Number(part);
		if (value > 255) throw new TypeError(`Invalid IP address: ${address}`);
		return value;
	});
	return Uint8Array.from(bytes);
}

function parseIPv6Part(part, address) {
	if (!part) return [];
	const tokens = part.split(":");
	const words = [];
	for (const [index, token] of tokens.entries()) {
		if (token.includes(".")) {
			if (index !== tokens.length - 1) throw new TypeError(`Invalid IP address: ${address}`);
			const ipv4 = parseIPv4(token);
			words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
		} else {
			if (!/^[0-9A-Fa-f]{1,4}$/.test(token))
				throw new TypeError(`Invalid IP address: ${address}`);
			words.push(Number.parseInt(token, 16));
		}
	}
	return words;
}

function parseIPv6(address) {
	if (address.includes("%")) throw new TypeError(`Invalid IP address: ${address}`);
	const halves = address.split("::");
	if (halves.length > 2) throw new TypeError(`Invalid IP address: ${address}`);
	const left = parseIPv6Part(halves[0], address);
	const right = parseIPv6Part(halves[1] ?? "", address);
	const omitted = 8 - left.length - right.length;
	if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
		throw new TypeError(`Invalid IP address: ${address}`);
	}
	const words = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
	const bytes = new Uint8Array(16);
	for (const [index, word] of words.entries()) {
		bytes[index * 2] = word >> 8;
		bytes[index * 2 + 1] = word & 0xff;
	}
	return bytes;
}

function parseIpAddress(address) {
	if (typeof address !== "string" || address.length === 0) {
		throw new TypeError(`Invalid IP address: ${address}`);
	}
	return address.includes(":") ? parseIPv6(address) : parseIPv4(address);
}

function names(value, defaults, label) {
	if (value === undefined) return defaults;
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	if (value.length > MAXIMUM_NAMES) {
		throw new RangeError(`${label} cannot contain more than ${MAXIMUM_NAMES} entries`);
	}
	return value;
}

function containsControlCharacter(value) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint <= 31 || codePoint === 127;
	});
}

function pem(label, value) {
	let binary = "";
	for (let offset = 0; offset < value.length; offset += 0x8000) {
		binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
	}
	const encoded = btoa(binary);
	const lines = encoded.match(/.{1,64}/g) ?? [];
	return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function ecdsaSignature(raw) {
	if (raw.length !== 64)
		throw new Error(`Expected a 64-byte P-256 signature, received ${raw.length}`);
	return sequence(integer(raw.slice(0, 32)), integer(raw.slice(32)));
}

export async function createDevelopmentCertificate(options = {}) {
	if (!options || typeof options !== "object") throw new TypeError("options must be an object");
	const dnsNames = [
		...new Set(names(options.dnsNames, ["localhost"], "dnsNames").map(assertDnsName)),
	];
	const ipAddresses = [
		...new Set(names(options.ipAddresses, ["127.0.0.1", "::1"], "ipAddresses")),
	];
	if (dnsNames.length + ipAddresses.length > MAXIMUM_NAMES) {
		throw new RangeError(`A certificate cannot contain more than ${MAXIMUM_NAMES} names`);
	}
	const encodedIpAddresses = ipAddresses.map(parseIpAddress);
	if (dnsNames.length + ipAddresses.length === 0) {
		throw new TypeError("At least one DNS name or IP address is required");
	}

	const commonName = options.commonName ?? dnsNames[0] ?? ipAddresses[0];
	if (
		typeof commonName !== "string" ||
		commonName.length === 0 ||
		textEncoder.encode(commonName).length > 64 ||
		containsControlCharacter(commonName)
	) {
		throw new TypeError("commonName must contain 1-64 UTF-8 bytes without control characters");
	}
	const validityDays = options.validityDays ?? 10;
	if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 13) {
		throw new RangeError("validityDays must be an integer from 1 through 13");
	}
	const now = options.now ? new Date(options.now) : new Date();
	if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date");
	const validFrom = new Date(Math.floor((now.getTime() - CLOCK_SKEW) / 1000) * 1000);
	const validTo = new Date(Math.floor((now.getTime() + validityDays * DAY) / 1000) * 1000);

	const keyPair = await globalThis.crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"]
	);
	const [subjectPublicKeyInfo, privateKeyPKCS8] = await Promise.all([
		globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey),
		globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
	]);
	const serialNumber = globalThis.crypto.getRandomValues(new Uint8Array(16));
	serialNumber[0] &= 0x7f;
	if (serialNumber[0] === 0) serialNumber[0] = 1;

	const signatureAlgorithm = sequence(objectIdentifier("1.2.840.10045.4.3.2"));
	const name = sequence(set(sequence(objectIdentifier("2.5.4.3"), utf8String(commonName))));
	const subjectAlternativeNames = sequence(
		...dnsNames.map((dnsName) => element(0x82, textEncoder.encode(dnsName))),
		...encodedIpAddresses.map((address) => element(0x87, address))
	);
	const extensions = sequence(
		extension("2.5.29.17", subjectAlternativeNames),
		extension("2.5.29.19", sequence(), true),
		extension("2.5.29.15", bitString(Uint8Array.of(0x80), 7), true),
		extension("2.5.29.37", sequence(objectIdentifier("1.3.6.1.5.5.7.3.1")))
	);
	const tbsCertificate = sequence(
		element(0xa0, integer(Uint8Array.of(2))),
		integer(serialNumber),
		signatureAlgorithm,
		name,
		sequence(utcTime(validFrom), utcTime(validTo)),
		name,
		new Uint8Array(subjectPublicKeyInfo),
		element(0xa3, extensions)
	);
	const rawSignature = new Uint8Array(
		await globalThis.crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			keyPair.privateKey,
			tbsCertificate
		)
	);
	const certificateDER = sequence(
		tbsCertificate,
		signatureAlgorithm,
		bitString(ecdsaSignature(rawSignature))
	);
	const certificateHash = new Uint8Array(
		await globalThis.crypto.subtle.digest("SHA-256", certificateDER)
	);
	const privateKeyBytes = new Uint8Array(privateKeyPKCS8);

	return {
		certificateDER,
		certificateHash,
		certificatePEM: pem("CERTIFICATE", certificateDER),
		privateKeyPEM: pem("PRIVATE KEY", privateKeyBytes),
		privateKeyPKCS8: privateKeyBytes,
		serverCertificateHashes: [{ algorithm: "sha-256", value: certificateHash.slice() }],
		validFrom,
		validTo,
	};
}
