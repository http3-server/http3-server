import assert from "node:assert/strict";
import test from "node:test";
import { promotionPlan, verifyTagConvergence } from "./promote-release.js";
import { publicationOrder } from "./publish-candidate.js";

function registryStates(version = "0.3.1") {
	return new Map(
		publicationOrder.map((name) => [
			name,
			{ publishedVersion: version, distTags: { latest: "0.3.0", next: version } },
		])
	);
}

test("promotion plan covers every package in dependency order", () => {
	const plan = promotionPlan(registryStates(), "0.3.1");
	assert.deepEqual(
		plan.map(({ name }) => name),
		publicationOrder
	);
	assert.ok(plan.every(({ alreadyPromoted }) => !alreadyPromoted));
});

test("promotion plan is safely rerunnable", () => {
	const states = registryStates();
	states.get("@http3-server/dev-certificates").distTags.latest = "0.3.1";
	assert.equal(promotionPlan(states, "0.3.1")[0].alreadyPromoted, true);
});

test("promotion refuses incomplete, unpublished, or unsoaked package state", () => {
	assert.throws(() => promotionPlan(new Map(), "0.3.1"), /complete publication set/);

	const unpublished = registryStates();
	unpublished.get("@http3-server/server").publishedVersion = "0.3.0";
	assert.throws(() => promotionPlan(unpublished, "0.3.1"), /is not published/);

	const wrongNext = registryStates();
	wrongNext.get("@http3-server/native").distTags.next = "0.3.0";
	assert.throws(() => promotionPlan(wrongNext, "0.3.1"), /next is 0.3.0/);
});

test("promotion verification tolerates registry propagation delay", async () => {
	let reads = 0;
	await verifyTagConvergence(
		["@http3-server/server"],
		"0.3.1",
		() => {
			reads += 1;
			return { latest: reads === 1 ? "0.3.0" : "0.3.1", next: "0.3.1" };
		},
		{ attempts: 2, delayMs: 0, sleep: async () => undefined }
	);
	assert.equal(reads, 2);
});

test("promotion verification reports packages that never converge", async () => {
	await assert.rejects(
		verifyTagConvergence(
			["@http3-server/server"],
			"0.3.1",
			() => ({ latest: "0.3.0", next: "0.3.1" }),
			{ attempts: 2, delayMs: 0, sleep: async () => undefined }
		),
		/@http3-server\/server tags did not converge/
	);
});
