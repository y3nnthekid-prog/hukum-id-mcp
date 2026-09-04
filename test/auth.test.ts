import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import { createJwtAuthenticator } from "../src/auth.js";

test("JWT authentication accepts the configured issuer/audience and returns a stable subject", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] });
  const token = await new SignJWT({ oid: "entra-object-id" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://issuer.example")
    .setAudience("hukum-client")
    .setSubject("subject-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const authenticate = createJwtAuthenticator({
    issuer: "https://issuer.example",
    audience: "hukum-client",
    jwks,
  });

  assert.equal(await authenticate(`Bearer ${token}`), "entra-object-id");
  assert.equal(await authenticate(undefined), null);
  assert.equal(await authenticate("Bearer invalid"), null);
});
