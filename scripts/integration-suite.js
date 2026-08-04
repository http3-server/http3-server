// @ts-check

import { run } from "./candidate.js";

export function runIntegrationSuite({ cwd, testFile, python }) {
	const baseEnvironment = { ...process.env, AIOQUIC_PYTHON: python };
	delete baseEnvironment.MSH3_FAULT_TEST;
	delete baseEnvironment.MSH3_TEST_FAIL_MSH3_CALL;
	delete baseEnvironment.MSH3_TEST_FAIL_TSFN_CALL;

	const runTests = (arguments_, environment = {}) => {
		run(process.execPath, ["--test", ...arguments_, testFile], {
			cwd,
			env: { ...baseEnvironment, ...environment },
		});
	};

	runTests([]);
	runTests(["--test-name-pattern", "TSFN delivery is rejected"], {
		MSH3_FAULT_TEST: "tsfn-delivery",
		MSH3_TEST_FAIL_TSFN_CALL: "connection",
	});
	runTests(["--test-name-pattern", "MSH3 submission fails"], {
		MSH3_FAULT_TEST: "msh3-submission",
		MSH3_TEST_FAIL_MSH3_CALL: "request-send",
	});
}
