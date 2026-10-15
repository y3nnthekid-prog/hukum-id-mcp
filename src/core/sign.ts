import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * Tanda tangan Ed25519 untuk potongan bukti dan hasil sintesis.
 *
 * Mesin menandatangani apa yang ia buka sendiri dari sumber resmi. Aplikasi web hanya menyimpan
 * sesuatu sebagai "terverifikasi" bila tanda tangannya sah terhadap kunci publik mesin, sehingga
 * klien tidak bisa menyisipkan teks karangan sebagai bukti.
 *
 * Kunci privat dibaca dari PASLA_SIGNING_KEY (PEM PKCS#8, boleh dalam bentuk base64 satu baris).
 * Kunci itu tidak pernah ditulis ke repositori, log, atau respons.
 */

export type Signature = { alg: "Ed25519"; kid: string; sig: string };

/** JSON kanonik: kunci objek diurutkan, tanpa spasi, supaya tanda tangan stabil. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function keyId(publicKey: KeyObject) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

function readPem(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("BEGIN") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
}

export type Signer = {
  kid: string;
  publicKeyPem: string;
  sign(payload: unknown): Signature;
};

export function createSigner(privateKeyPem: string): Signer {
  const privateKey = createPrivateKey(readPem(privateKeyPem));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("PASLA_SIGNING_KEY harus kunci Ed25519.");
  const publicKey = createPublicKey(privateKey);
  const kid = keyId(publicKey);
  return {
    kid,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    sign(payload) {
      const sig = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64url");
      return { alg: "Ed25519", kid, sig };
    },
  };
}

/** Penandatangan dari lingkungan, atau null bila kunci belum disetel. */
export function signerFromEnvironment(env: NodeJS.ProcessEnv = process.env): Signer | null {
  const value = env.PASLA_SIGNING_KEY?.trim();
  return value ? createSigner(value) : null;
}

/** Hanya untuk uji dan pengembangan lokal. */
export function generateSigningKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

/**
 * Periksa tanda tangan terhadap daftar kunci publik yang diterima (lebih dari satu selama masa
 * rotasi kunci).
 */
export function verifySignature(payload: unknown, signature: Signature, publicKeysPem: string[]) {
  if (signature?.alg !== "Ed25519" || typeof signature.sig !== "string") return false;
  for (const pem of publicKeysPem) {
    const publicKey = createPublicKey(readPem(pem));
    if (keyId(publicKey) !== signature.kid) continue;
    try {
      return verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature.sig, "base64url"));
    } catch {
      return false;
    }
  }
  return false;
}
