import { readFileSync } from "node:fs";

export const platforms = Object.freeze([
	{
		id: "darwin-arm64",
		os: "darwin",
		cpu: "arm64",
		files: ["http3.node", "libmsh3.dylib", "libmsquic.2.dylib"],
	},
	{
		id: "darwin-x64",
		os: "darwin",
		cpu: "x64",
		files: ["http3.node", "libmsh3.dylib", "libmsquic.2.dylib"],
	},
	{
		id: "linux-arm64",
		os: "linux",
		cpu: "arm64",
		files: ["http3.node", "libmsh3.so", "libmsquic.so"],
	},
	{
		id: "linux-x64",
		os: "linux",
		cpu: "x64",
		files: ["http3.node", "libmsh3.so", "libmsquic.so"],
	},
	{
		id: "win32-arm64",
		os: "win32",
		cpu: "arm64",
		files: ["http3.node", "msh3.dll", "msquic.dll"],
	},
	{
		id: "win32-x64",
		os: "win32",
		cpu: "x64",
		files: ["http3.node", "msh3.dll", "msquic.dll"],
	},
]);

export function detectNativeArchitecture(path) {
	const bytes = readFileSync(path);
	const magic = bytes.readUInt32LE(0);
	if (magic === 0xfeedfacf) {
		const cpuType = bytes.readUInt32LE(4);
		if (cpuType === 0x0100000c) return "arm64";
		if (cpuType === 0x01000007) return "x64";
	}
	if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
		const machine = bytes.readUInt16LE(18);
		if (machine === 183) return "arm64";
		if (machine === 62) return "x64";
	}
	if (bytes.subarray(0, 2).toString("ascii") === "MZ") {
		const peOffset = bytes.readUInt32LE(0x3c);
		if (bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0"))) {
			const machine = bytes.readUInt16LE(peOffset + 4);
			if (machine === 0xaa64) return "arm64";
			if (machine === 0x8664) return "x64";
		}
	}
	return "unknown";
}
