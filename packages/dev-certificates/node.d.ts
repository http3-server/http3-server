import type { CreateDevelopmentCertificateOptions, DevelopmentCertificateHash } from "./types.d.ts";

export interface EnsureDevelopmentCertificateOptions extends CreateDevelopmentCertificateOptions {
	readonly directory: string;
	readonly renewBeforeMs?: number;
}

export interface StoredDevelopmentCertificate {
	readonly certificateFile: string;
	readonly certificateHash: Uint8Array;
	readonly privateKeyFile: string;
	readonly reused: boolean;
	readonly serverCertificateHashes: readonly DevelopmentCertificateHash[];
	readonly validFrom: Date;
	readonly validTo: Date;
}

export function ensureDevelopmentCertificate(
	options: EnsureDevelopmentCertificateOptions
): Promise<StoredDevelopmentCertificate>;
