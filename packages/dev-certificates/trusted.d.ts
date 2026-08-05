import type { CreateDevelopmentCertificateOptions } from "./types.d.ts";

export interface CreateDevelopmentCertificateChainOptions
	extends Omit<CreateDevelopmentCertificateOptions, "validityDays"> {
	readonly authorityName?: string;
	readonly validityDays?: number;
}

export interface DevelopmentCertificateChain {
	readonly authorityCertificatePEM: string;
	readonly certificatePEM: string;
	readonly privateKeyPEM: string;
	readonly validFrom: Date;
	readonly validTo: Date;
}

export interface EnsureTrustedDevelopmentCertificateOptions
	extends CreateDevelopmentCertificateChainOptions {
	readonly directory: string;
	readonly installTrust?: boolean;
	readonly renewBeforeMs?: number;
}

export interface StoredTrustedDevelopmentCertificate {
	readonly authorityCertificateFile: string;
	readonly certificateFile: string;
	readonly fingerprint: string;
	readonly privateKeyFile: string;
	readonly reused: boolean;
	readonly trusted: boolean;
	readonly validFrom: Date;
	readonly validTo: Date;
}

export interface RemoveTrustedDevelopmentCertificateOptions {
	readonly directory: string;
}

export function createDevelopmentCertificateChain(
	options?: CreateDevelopmentCertificateChainOptions
): Promise<DevelopmentCertificateChain>;

export function ensureTrustedDevelopmentCertificate(
	options: EnsureTrustedDevelopmentCertificateOptions
): Promise<StoredTrustedDevelopmentCertificate>;

export function removeTrustedDevelopmentCertificate(
	options: RemoveTrustedDevelopmentCertificateOptions
): Promise<boolean>;

export const trustedDevelopmentCertificateDefaults: Readonly<{
	authorityName: "http3-server development CA";
	validityDays: 365;
}>;
