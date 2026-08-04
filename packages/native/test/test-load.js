// test-load.js - Test loading the native module
import { HTTP3Server } from "../http3.js";

console.log("HTTP3Server loaded:", !!HTTP3Server);

if (HTTP3Server) {
	console.log("HTTP3Server type:", typeof HTTP3Server);
	console.log("HTTP3Server constructor name:", HTTP3Server.name);
}
