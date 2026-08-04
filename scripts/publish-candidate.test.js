import assert from "node:assert/strict";
import test from "node:test";
import {
	publicationOrder,
	publicationPlan,
	publishArguments,
	publishCommand,
} from "./publish-candidate.js";

function manifest(overrides = {}) {
	return {
		scope: "release",
		sourceCommit: "a".repeat(40),
		releaseVersion: "0.1.0",
		packages: publicationOrder.toReversed().map((name) => ({ name })),
		...overrides,
	};
}

test("publication plan is complete, pinned, and dependency ordered", () => {
	const plan = publicationPlan(manifest(), {
		sourceCommit: "a".repeat(40),
		version: "0.1.0",
	});
	assert.deepEqual(
		plan.map(({ name }) => name),
		publicationOrder
	);
	assert.equal(plan.at(-1).name, "@http3-server/server");
});

test("publication plan rejects incomplete or mismatched candidates", () => {
	assert.throws(
		() =>
			publicationPlan(manifest({ sourceCommit: "b".repeat(40) }), {
				sourceCommit: "a".repeat(40),
				version: "0.1.0",
			}),
		/Candidate source commit differs/
	);
	assert.throws(
		() =>
			publicationPlan(manifest(), {
				sourceCommit: "a".repeat(40),
				version: "0.2.0",
			}),
		/not requested version/
	);
	assert.throws(
		() =>
			publicationPlan(manifest({ packages: [] }), {
				sourceCommit: "a".repeat(40),
				version: "0.1.0",
			}),
		/complete publication set/
	);
});

test("publication arguments distinguish safe checks from live provenance publication", () => {
	assert.deepEqual(publishArguments("package.tgz", "next", false), [
		"publish",
		"package.tgz",
		"--access=public",
		"--tag=next",
		"--dry-run",
		"--provenance=false",
	]);
	assert.deepEqual(publishArguments("package.tgz", "latest", true), [
		"publish",
		"package.tgz",
		"--access=public",
		"--tag=latest",
		"--provenance",
	]);
});

test("publication runs the npm CLI through the current Node runtime", () => {
	assert.deepEqual(publishCommand("/path/to/npm-cli.js", "package.tgz", "next", false), [
		process.execPath,
		[
			"/path/to/npm-cli.js",
			"publish",
			"package.tgz",
			"--access=public",
			"--tag=next",
			"--dry-run",
			"--provenance=false",
		],
	]);
});
