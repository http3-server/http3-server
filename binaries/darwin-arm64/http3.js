import { createRequire } from "node:module";

export const { HTTP3Server } = createRequire(import.meta.url)("./http3.node");
