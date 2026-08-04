#!/usr/bin/env node
// @ts-check

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HTTP3Server } from "@http3-server/server";
import { ensureIntegrationClient } from "./integration-client.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const durationSeconds = Number(process.env.HTTP3_SOAK_SECONDS ?? 60);
const maxGrowthMiB = Number(process.env.HTTP3_SOAK_MAX_RSS_GROWTH_MB ?? 64);
const requestsPerConnection = Number(process.env.HTTP3_SOAK_REQUESTS ?? 32);
const warmupSeconds = Number(
	process.env.HTTP3_SOAK_WARMUP_SECONDS ?? Math.min(300, durationSeconds / 2)
);
const reportSeconds = Number(process.env.HTTP3_SOAK_REPORT_SECONDS ?? 60);

for (const [name, value] of Object.entries({
	HTTP3_SOAK_SECONDS: durationSeconds,
	HTTP3_SOAK_MAX_RSS_GROWTH_MB: maxGrowthMiB,
	HTTP3_SOAK_REPORT_SECONDS: reportSeconds,
})) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}
if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds >= durationSeconds) {
	throw new Error("HTTP3_SOAK_WARMUP_SECONDS must be nonnegative and shorter than the soak");
}
if (!Number.isSafeInteger(requestsPerConnection) || requestsPerConnection < 1) {
	throw new Error("HTTP3_SOAK_REQUESTS must be a positive integer");
}

const python = ensureIntegrationClient();
if (typeof global.gc !== "function") throw new Error("run the soak with Node --expose-gc");

function retainedMemory() {
	global.gc();
	return process.memoryUsage();
}

const server = new HTTP3Server().handle({
	stream: () => new Response("baseline"),
	session: () => undefined,
});
await server.start({
	address: "127.0.0.1",
	port: 0,
	certificateFile: join(projectRoot, "packages", "server", "test", "localhost.pem"),
	privateKeyFile: join(projectRoot, "packages", "server", "test", "localhost-key.pem"),
});

const deadline = Date.now() + durationSeconds * 1_000;
const measurementStart = Date.now() + warmupSeconds * 1_000;
let nextReport = Date.now() + reportSeconds * 1_000;
let baselineRss;
let peakRss;
let baselineHeapUsed;
let peakHeapUsed;
let baselineExternal;
let peakExternal;
let runs = 0;
let measuredRuns = 0;

try {
	while (Date.now() < deadline) {
		await execFileAsync(
			python,
			[
				join(projectRoot, "packages", "server", "test", "h3-smoke.py"),
				server.address,
				String(server.port),
				"--requests",
				String(requestsPerConnection),
			],
			{ timeout: 15_000 }
		);
		runs += 1;
		await new Promise((resolve) => setTimeout(resolve, 25));
		const diagnostics = server.getDiagnostics();
		assert.equal(diagnostics.activeRequests, 0);
		assert.equal(diagnostics.pendingResponseSends, 0);
		assert.equal(diagnostics.pendingWebTransportSends, 0);
		assert.equal(diagnostics.pendingDatagramSends, 0);
		assert.equal(server.connections.size, 0);
		if (Date.now() >= measurementStart) {
			measuredRuns += 1;
			if (baselineRss === undefined) {
				const memory = retainedMemory();
				baselineRss = memory.rss;
				peakRss = memory.rss;
				baselineHeapUsed = memory.heapUsed;
				peakHeapUsed = memory.heapUsed;
				baselineExternal = memory.external;
				peakExternal = memory.external;
			}
		}
		if (Date.now() >= nextReport) {
			const memory = retainedMemory();
			if (baselineRss !== undefined) {
				peakRss = Math.max(peakRss ?? memory.rss, memory.rss);
				peakHeapUsed = Math.max(peakHeapUsed ?? memory.heapUsed, memory.heapUsed);
				peakExternal = Math.max(peakExternal ?? memory.external, memory.external);
			}
			console.log(
				`soak progress: ${runs} iterations; RSS ${(memory.rss / 1024 / 1024).toFixed(1)} MiB, ` +
					`heap ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MiB, ` +
					`external ${(memory.external / 1024 / 1024).toFixed(1)} MiB`
			);
			nextReport = Date.now() + reportSeconds * 1_000;
		}
	}
} finally {
	await server.stop({ gracePeriodMs: 5_000 });
}

assert.ok(runs > 0, "soak completed no traffic iterations");
assert.ok(measuredRuns > 0, "soak completed no measured iterations after warm-up");
const finalMemory = retainedMemory();
baselineRss ??= finalMemory.rss;
peakRss ??= baselineRss;
baselineHeapUsed ??= finalMemory.heapUsed;
peakHeapUsed ??= baselineHeapUsed;
baselineExternal ??= finalMemory.external;
peakExternal ??= baselineExternal;
const finalRss = finalMemory.rss;
const growthMiB = (Math.max(finalRss, peakRss) - baselineRss) / 1024 / 1024;
const heapGrowthMiB =
	(Math.max(finalMemory.heapUsed, peakHeapUsed) - baselineHeapUsed) / 1024 / 1024;
const externalGrowthMiB =
	(Math.max(finalMemory.external, peakExternal) - baselineExternal) / 1024 / 1024;
assert.ok(
	growthMiB <= maxGrowthMiB,
	`resident memory grew ${growthMiB.toFixed(1)} MiB after warm-up; ` +
		`heap grew ${heapGrowthMiB.toFixed(1)} MiB and external grew ${externalGrowthMiB.toFixed(1)} MiB; ` +
		`limit is ${maxGrowthMiB} MiB`
);
console.log(
	`soak passed ${runs} HTTP/3 + WebTransport iterations (${measuredRuns} measured); ` +
		`post-warm-up RSS growth ${growthMiB.toFixed(1)} MiB, heap growth ${heapGrowthMiB.toFixed(1)} MiB, ` +
		`external growth ${externalGrowthMiB.toFixed(1)} MiB`
);
