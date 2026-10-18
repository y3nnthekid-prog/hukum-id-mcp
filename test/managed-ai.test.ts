import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTicketGuard, estimatedManagedInputTokens, requestHash } from "../src/core/step-ticket.js";
import { createManagedAzure, createManagedClaims } from "../src/core/managed-ai.js";
import { createAzureModel } from "../src/ai/azure.js";
import { RencanaSchema, rencanaLaporan } from "../src/core/laporan.js";
import { z } from "zod";
import { createApiApp } from "../src/api/app.js";
import { createSigner, generateSigningKey } from "../src/core/sign.js";

test("managed tickets require the pinned issuer/profile/output and cannot authorize BYOK implicitly", () => {
  const secret = "s".repeat(43); const input = { pertanyaan: "Uji sintetis", rumpun: "hes" };
  const encode = (changes = {}) => {
    const payload = { v: 2, mode: "managed-azure", profile: "pasla-azure-low4096-v1", iss: "https://riset.pasla.pages.dev", sub: "alice", aud: "https://api.pasla.tech", reportId: "r1", step: "rencana", attemptId: "a1", inputHash: requestHash(input), maxInputTokens: estimatedManagedInputTokens(input), maxOutputTokens: 4096, jti: "j".repeat(43), iat: 1000, exp: 1120, ...changes };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const guard = createTicketGuard(secret, "https://api.pasla.tech", () => 1000);
  for (const change of [{ iss: "https://evil.test" }, { profile: "other" }, { maxOutputTokens: 2500 }, { mode: "byok" }, { maxInputTokens: 1 }]) assert.throws(() => guard(encode(change), "rencana", input));
  assert.equal(guard(encode(), "rencana", input).v, 2);
  assert.throws(() => guard(encode(), "rencana", input));
});

test("managed claims survive restart, serialize requests and keep the 65-second interval", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pasla-managed-")); const file = path.join(directory, "claims.sqlite");
  let time = 1000;
  let claims = createManagedClaims(file, () => time);
  try {
    claims.claim("a".repeat(43), 1120);
    assert.throws(() => claims.claim("b".repeat(43), 1120), /MANAGED_BUSY/);
    claims.finish("a".repeat(43));
    assert.throws(() => claims.claim("b".repeat(43), 1120), /MANAGED_RATE/);
    claims.close(); claims = createManagedClaims(file, () => time);
    assert.throws(() => claims.claim("a".repeat(43), 1120), /MANAGED_REPLAY/);
    time = 1065; claims.claim("b".repeat(43), 1185);
    claims.close(); claims = createManagedClaims(file, () => time);
    time = 1130; assert.throws(() => claims.claim("c".repeat(43), 1250), /MANAGED_BUSY/);
    time = 1186; claims.claim("c".repeat(43), 1300);
  } finally { claims.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("v2 managed AI requires its signed profile and never falls back from BYOK", async () => {
  const input = { rumpun: "hes", pertanyaan: "Apa isi sumber sintetis?" };
  const secret = "s".repeat(43); let created = 0;
  const signer = createSigner(generateSigningKey());
  const plan = { isu: "Isu sintetis", subpertanyaan: ["Apa cakupannya?"], penelusuran: [{ kueri: "uji", sumber: ["peraturan"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Temuan", fokus: "Uji sumber" }] };
  const app = createApiApp({ service: {} as any, signer, stepTickets: { secret, audience: "https://api.pasla.tech" }, requireStepTicket: true, managedAi: () => {
    created++;
    return { model: { provider: "openai", model: "azure:pasla-chat:gpt-5-mini:2025-08-07:low-4096", generate: async ({ schema }: any) => schema.parse(plan) }, summary: () => ({ calls: 1, usage: [{ prompt_tokens: 100, completion_tokens: 200 }], lastFailure: null, validationIssues: [] }) } as any;
  } });
  const epoch = Math.floor(Date.now() / 1000);
  const raw = { v: 2, mode: "managed-azure", profile: "pasla-azure-low4096-v1", iss: "https://riset.pasla.pages.dev", sub: "alice", aud: "https://api.pasla.tech", reportId: "r1", step: "rencana", attemptId: "a1", inputHash: requestHash(input), maxInputTokens: estimatedManagedInputTokens(input), maxOutputTokens: 4096, jti: "j".repeat(43), iat: epoch, exp: epoch + 120 };
  const encoded = Buffer.from(JSON.stringify(raw)).toString("base64url"); const ticket = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  const post = (headers: Record<string, string>) => app.request("/v2/laporan/rencana", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(input) });
  assert.equal((await post({ "x-pasla-ai-mode": "managed-azure" })).status, 401);
  assert.equal((await post({})).status, 422); assert.equal(created, 0);
  const response = await post({ "x-pasla-ai-mode": "managed-azure", "x-pasla-step-ticket": ticket });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.find(event => event.jenis === "hasil").data.rencana.isu, plan.isu);
  assert.equal(events.find(event => event.jenis === "pemakaian").data.usage[0].completion_tokens, 200);
  assert.equal((await post({ "x-pasla-ai-mode": "managed-azure", "x-pasla-step-ticket": ticket })).status, 401);
  assert.equal(created, 1);
});

test("managed wire bound includes schema and prompts and blocks before network", async () => {
  let calls = 0;
  const azure = createAzureModel({ apiKey: "synthetic-key-only", maxUsd: 1, maxInputTokens: 1500, profile: "low-4096", fetchImpl: async () => { calls++; throw new Error(); } });
  await assert.rejects(azure.model.generate({ system: "Instructions".repeat(100), user: "Small", schema: z.object({ status: z.string() }), effort: "low" }), /INPUT_LIMIT/);
  assert.equal(calls, 0); assert.equal(azure.summary().calls, 0);
});

test("managed wrapper pins low/4096, records usage and consumes the claim only once", async () => {
  const claims = createManagedClaims(":memory:"); let calls = 0;
  try {
    const factory = createManagedAzure({ apiKey: "synthetic-key-only", claims, fetchImpl: async (_url, init) => {
      calls++; const body = JSON.parse(String(init.body));
      assert.equal(body.reasoning_effort, "low"); assert.equal(body.max_completion_tokens, 4096);
      return Response.json({ model: "gpt-5-mini-2025-08-07", choices: [{ finish_reason: "stop", message: { content: '{"status":"ok"}' } }], usage: { prompt_tokens: 50, completion_tokens: 100 } });
    } });
    const ticket = { jti: "w".repeat(43), exp: Math.floor(Date.now()/1000)+120, maxInputTokens: 6500 } as any;
    const azure = factory(ticket); const request = { system: "JSON", user: "Synthetic", schema: z.object({ status: z.string() }), effort: "medium" as const, maxOutputTokens: 2500 };
    assert.deepEqual(await azure.model.generate(request), { status: "ok" });
    assert.equal(azure.summary().usage[0]?.completion_tokens, 100);
    await assert.rejects(factory(ticket).model.generate(request), /MANAGED_REPLAY/);
    await assert.rejects(azure.model.generate(request), /MANAGED_REPLAY/);
    assert.equal(calls, 1);
  } finally { claims.close(); }
});

test("plan prompt asks for short queries and two initial sections without loosening validation", async () => {
  const signer = createSigner(generateSigningKey());
  const plan = { isu: "Isu sintetis", subpertanyaan: ["Apa cakupannya?"], penelusuran: [{ kueri: "uji", sumber: ["peraturan"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Temuan", fokus: "Uji sumber" }] };
  await rencanaLaporan({ pertanyaan: "Uji sintetis", rumpun: "hes", signer, signal: AbortSignal.timeout(1000), model: { provider: "openai", model: "synthetic", async generate(request) {
    assert.match(request.system, /80 karakter/); assert.match(request.system, /120 karakter/); assert.match(request.system, /dua bagian/);
    assert.match(request.system, /syarat inklusi/); assert.match(request.system, /alasan eksklusi/); assert.match(request.system, /laporan temuan/);
    return request.schema.parse(plan);
  } } });
  assert.equal(RencanaSchema.safeParse({ ...plan, penelusuran: [{ kueri: "q".repeat(121), sumber: ["peraturan"] }] }).success, false);
});

test("the real plan wire request fits the gateway reservation for every research field", async () => {
  const signer = createSigner(generateSigningKey());
  const plan = { isu: "Isu sintetis", subpertanyaan: ["Apa cakupannya?"], penelusuran: [{ kueri: "uji", sumber: ["peraturan"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Temuan", fokus: "Uji sumber" }] };
  for (const rumpun of ["ilmu-hukum","hes","htn","hukum-keluarga","pidana-islam","perbandingan-madzhab"] as const) {
    const input = { rumpun, pertanyaan: "Pertanyaan sintetis uji sumber" };
    const azure = createAzureModel({ apiKey:"synthetic-key-only", maxUsd:1, maxInputTokens:estimatedManagedInputTokens(input),profile:"low-4096", fetchImpl:async()=>Response.json({model:"gpt-5-mini-2025-08-07",choices:[{finish_reason:"stop",message:{content:JSON.stringify(plan)}}],usage:{prompt_tokens:100,completion_tokens:200}}) });
    await rencanaLaporan({ ...input, signer, signal:AbortSignal.timeout(1000), model:azure.model });
    assert.equal(azure.summary().calls,1);
  }
});
