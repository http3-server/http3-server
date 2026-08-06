import assert from "node:assert/strict";
import test from "node:test";
import { promotionPlan } from "./promote-release.js";
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
