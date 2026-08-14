// @ts-check

/**
 * Normalize the JSON emitted by npm pack across npm versions.
 *
 * npm has emitted both an array and a package-name-keyed object for a single
 * local package. Accept either shape, but reject ambiguous output.
 *
 * @param {string} stdout
 */
export function parsePackOutput(stdout) {
	const parsed = JSON.parse(stdout);
	const entries = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object" && "name" in parsed
			? [parsed]
			: Object.values(parsed ?? {});
	if (entries.length !== 1 || !entries[0] || typeof entries[0] !== "object") {
		throw new Error(
			`npm pack returned ${entries.length} package results; expected exactly one`
		);
	}
	return entries[0];
}
