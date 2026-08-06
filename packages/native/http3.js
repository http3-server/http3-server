// @ts-check

import { loadNativeModule } from "./resolve.js";

/** @type {typeof import("./http3.js").HTTP3Server} */
export const HTTP3Server = loadNativeModule();
