export interface DevelopmentCertificateHash {
	readonly algorithm: "sha-256";
	readonly value: Uint8Array;
}

export interface CreateDevelopmentCertificateOptions {
	readonly commonName?: string;
	readonly dnsNames?: readonly string[];
	readonly ipAddresses?: readonly string[];
	readonly now?: Date;
	readonly validityDays?: number;
}

export interface DevelopmentCertificate {
	readonly certificateDER: Uint8Array;
	readonly certificateHash: Uint8Array;
	readonly certificatePEM: string;
	readonly privateKeyPEM: string;
	readonly privateKeyPKCS8: Uint8Array;
	readonly serverCertificateHashes: readonly DevelopmentCertificateHash[];
	readonly validFrom: Date;
	readonly validTo: Date;
}

export function createDevelopmentCertificate(
	options?: CreateDevelopmentCertificateOptions
): Promise<DevelopmentCertificate>;
