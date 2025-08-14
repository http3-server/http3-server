// test-load.js - Test loading the native module
import { HTTP3Native } from "./http3-native-server.js";

console.log("HTTP3Native loaded:", !!HTTP3Native);

if (HTTP3Native) {
	console.log("HTTP3Native type:", typeof HTTP3Native);
	console.log("HTTP3Native constructor name:", HTTP3Native.constructor?.name);
}
