// @ts-check
/// <reference types="./types.d.ts" />

/** @type {<T>(type: string) => http3.MapConstructor<T>} */
export const mapOf = (
	/**
	 * Type of items in this map.
	 * @type {string}
	 */
	type
) => /** @type {never} */ (class extends Map {
	constructor(
		/**
		 * Server that owns this map.
		 * @type {http3.HTTP3Server}
		 */
		server
	) {
		super();

		this.#server = server;
	}

	get [Symbol.toStringTag]() {
		return `${type}Map`;
	}

	[Symbol.for('nodejs.util.inspect.custom')](
		/** @type {number} */
		depth,
		
		/** @type {import("node:util").InspectOptionsStylized} */
		options,
		
		/** @type {import("node:util")["inspect"]} */
		inspect
	) {
		return `${type}${inspect(
			new Map(this.entries()),
			{
				depth: isNaN(depth) ? 2 : Number(depth),
				...options,
			}
		)}`;
	}

	/** @type {http3.HTTP3Server} */
	#server;

	/** Server that owns this map. */
	get server() {
		return this.#server;
	}

	/**
	 * Get an item or throw an error with a custom label.
	*/
	get(/** @type {http3.Id} */ key) {
		const value = super.get(key);

		if (value === undefined) {
			throw new Error(`${type} ${key} does not exist`);
		}

		return value;
	}
})
