#!/usr/bin/env node
// @ts-check

import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installCandidate, run } from "./candidate.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = resolve(process.argv[2] || join(projectRoot, "release"));
const { platformName, root } = installCandidate(candidateDirectory);

try {
	writeFileSync(
		join(root, "smoke.mjs"),
		`import { HTTP3Server as NativeHTTP3Server } from "@http3-server/native";\n` +
			`import { ensureDevelopmentCertificate } from "@http3-server/dev-certificates/node";\n` +
			`import { HTTP3Server } from "@http3-server/server";\n` +
			`if (typeof NativeHTTP3Server !== "function" || typeof HTTP3Server !== "function") throw new Error("candidate exports are unavailable");\n` +
			`const certificate = await ensureDevelopmentCertificate({ directory: ${JSON.stringify(join(root, ".http3-server"))} });\n` +
			`const server = new HTTP3Server().handle({ stream: () => new Response("ok") });\n` +
			`await server.start({ port: 0, certificateFile: certificate.certificateFile, privateKeyFile: certificate.privateKeyFile });\n` +
			`if (!server.port || !server.address) throw new Error("candidate listener did not report its endpoint");\n` +
			`await server.stop({ gracePeriodMs: 0 });\n`
	);
	run(process.execPath, ["smoke.mjs"], { cwd: root });

	writeFileSync(
		join(root, "types.test.ts"),
		`import { createDevelopmentCertificate } from "@http3-server/dev-certificates";\n` +
			`import { HTTP3Server } from "@http3-server/server";\n` +
			`const certificate = await createDevelopmentCertificate();\n` +
			`const hash: Uint8Array = certificate.certificateHash;\n` +
			`void hash;\n` +
			`const server = new HTTP3Server().handle({ stream: () => new Response("ok"), session: () => false });\n` +
			`const started: Promise<void> = server.start({ certificateFile: "certificate.pem", privateKeyFile: "private-key.pem" });\n` +
			`void started;\n`
	);
	run(
		process.execPath,
		[
			join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
			"--noEmit",
			"--strict",
			"--target",
			"ES2022",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"types.test.ts",
		],
		{ cwd: root }
	);
	console.log(`exercised packed ${platformName} candidate on Node ${process.versions.node}`);
} finally {
	rmSync(root, { force: true, recursive: true });
}
