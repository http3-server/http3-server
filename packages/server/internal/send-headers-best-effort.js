// @ts-check

/**
 * Attempts to end a native request without allowing a synchronous throw or
 * rejected promise to escape the native event callback.
 *
 * @param {Pick<import("@http3-server/native").HTTP3Server, "sendHeaders">} native
 * @param {string} id
 * @param {number} status
 */
export async function sendHeadersBestEffort(native, id, status) {
	try {
		await native.sendHeaders(id, status, [], true);
	} catch {
		// The native request may not exist or may already be closed.
	}
}
