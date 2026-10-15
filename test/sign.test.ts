import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";

const payload = {
  id: "ps_0123456789abcdef01234567",
  contentHash: "a".repeat(64),
  locator: { pasal: "Pasal 7", halamanAwal: 4, halamanAkhir: 5, bagian: "batang-tubuh" },
  retrievedAt: "2026-10-16T01:00:00.000Z",
};

test("canonical JSON ignores key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
});

test("a signed passage verifies, and any change to its content or locator is rejected", () => {
  const signer = createSigner(generateSigningKey());
  const signature = signer.sign(payload);
  assert.ok(verifySignature(payload, signature, [signer.publicKeyPem]));
  assert.ok(!verifySignature({ ...payload, contentHash: "b".repeat(64) }, signature, [signer.publicKeyPem]));
  assert.ok(!verifySignature({ ...payload, locator: { ...payload.locator, pasal: "Pasal 8" } }, signature, [signer.publicKeyPem]));
});

test("a signature from an unknown key is rejected, and rotation accepts both keys", () => {
  const oldSigner = createSigner(generateSigningKey());
  const newSigner = createSigner(generateSigningKey());
  const signature = oldSigner.sign(payload);
  assert.ok(!verifySignature(payload, signature, [newSigner.publicKeyPem]));
  assert.ok(verifySignature(payload, signature, [newSigner.publicKeyPem, oldSigner.publicKeyPem]));
  assert.ok(!verifySignature(payload, { ...signature, sig: "AAAA" }, [oldSigner.publicKeyPem]));
});

test("the key can be supplied as one-line base64 and non-Ed25519 keys are refused", async () => {
  const pem = generateSigningKey();
  const signer = createSigner(Buffer.from(pem).toString("base64"));
  assert.match(signer.kid, /^[a-f0-9]{16}$/);
  const { generateKeyPairSync } = await import("node:crypto");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => createSigner(rsa), /Ed25519/);
});
