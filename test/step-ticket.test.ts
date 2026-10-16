import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createTicketGuard, estimatedInputTokens, requestHash } from "../src/core/step-ticket.js";

test("step tickets bind account, input, step, audience, expiration, budget and single use", () => {
  const secret = "s".repeat(43); const audience = "https://api.example.test"; const input = { pertanyaan: "Pertanyaan sintetis" };
  const ticket = (changes = {}) => {
    const value = { v: 1, sub: "alice", aud: audience, reportId: "r1", step: "rencana", attemptId: "a1", inputHash: requestHash(input), maxInputTokens: estimatedInputTokens(input), maxOutputTokens: 2500, jti: "a".repeat(43), iat: 1000, exp: 1120, ...changes };
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const guard = createTicketGuard(secret, audience, () => 1000);
  for (const changes of [{ aud: "https://evil.test" }, { exp: 1000 }, { exp: 1200 }, { step: "saring" }, { inputHash: "b".repeat(64) }, { maxInputTokens: 1 }, { maxOutputTokens: 4096 }]) assert.throws(() => guard(ticket(changes), "rencana", input), /TICKET_INVALID/);
  assert.throws(() => guard(ticket().replace(/.$/, "x"), "rencana", input), /TICKET_INVALID/);
  assert.equal(guard(ticket(), "rencana", input).sub, "alice");
  assert.throws(() => guard(ticket(), "rencana", input), /TICKET_INVALID/);
  for (let i = 0; i < 5; i++) guard(ticket({ jti: String(i).repeat(43) }), "rencana", input);
  assert.throws(() => guard(ticket({ jti: "z".repeat(43) }), "rencana", input), /ACCOUNT_RATE_LIMIT/);
});
