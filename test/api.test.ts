import assert from "node:assert/strict";
import test from "node:test";

import { createApiApp } from "../src/api/app.js";
import { createEvidence } from "../src/core/contracts.js";
import type { JsonModel } from "../src/ai/json-model.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { createSumberService, signedPart } from "../src/core/sumber.js";
import { createPlatformServer } from "../src/platform.js";

const service = {
  searchLegalSources: async ({ query }: { query: string }) => ({
    traceId: "00000000-0000-4000-8000-000000000001",
    query,
    documents: [],
    sourceStatus: { regulation: "ok" },
    warnings: [],
    nextCursor: null,
  }),
  getLegalDocument: async () => ({ id: "document-1" }),
  lookupArticle: async () => ({ status: "insufficient_evidence", evidence: [] }),
  verifyCitation: async () => ({ hasil: [] }),
  traceRegulation: async () => ({ simpulan: "berlaku" }),
  searchJurisprudence: async () => ({ documents: [] }),
  researchShariaIssue: async () => ({ fatwa_dsn: { hasil: [] } }),
  analyzeLegalProblem: async () => ({ status: "insufficient_evidence", evidence: [] }),
  analyzeUploadedDocument: async () => ({ hasil: [] }),
  getSourceStatus: async () => ({ hasil: [] }),
};

// Data uji sintetis, tidak ditulis ke cache dan bukan kutipan sumber hukum.
function v2Fixture() {
  const signer = createSigner(generateSigningKey());
  const text = "Teks sumber sintetis ini dipakai hanya untuk menguji alur bukti bertanda tangan.";
  const unused = async () => { throw new Error("Adapter tidak dipakai pada uji ini."); };
  const sumber = createSumberService({
    inspectArticle: unused, regulationDetail: unused, pdfPages: unused, fatwaText: unused,
    khesLocation: unused, gradedHadith: unused, turats: unused,
    verse: async () => ({ terjemah: text, rujukan: "Sumber sintetis untuk pengujian" }),
  }, signer);
  let calls = 0;
  const model: JsonModel = {
    provider: "claude", model: "uji",
    async generate(input) {
      calls += 1;
      assert.equal("allowRetries" in input ? input.allowRetries : undefined, false);
      const { potongan } = JSON.parse(input.user);
      return { kalimat: [{ id: "k1", teks: text, kutipan: text, lapisan: "dalil", potongan_id: potongan[0].potongan_id }], analisis: [] } as never;
    },
  };
  return { signer, sumber, makeByokModel: () => model, calls: () => calls };
}

const v2Headers = { "content-type": "application/json", "x-pasla-ai-provider": "claude", "x-pasla-ai-key": "kunci-uji-sintetis" };
const v2Question = { pertanyaan: "Apa isi sumber sintetis?", bagian: { judul: "Uji", fokus: "Alur bukti" } };

test("v2 returns 503 when signing is not configured", async () => {
  const app = createApiApp({ service: service as any });
  for (const path of ["/v2/kunci-publik", "/v2/sumber/buka", "/v2/laporan/sintesis"]) {
    const response = await app.request(path, { method: path.endsWith("kunci-publik") ? "GET" : "POST" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SIGNING_NOT_CONFIGURED");
  }
});

test("v2 exposes only public signing keys and allows BYOK CORS preflight", async () => {
  const fixture = v2Fixture();
  const app = createApiApp({ service: service as any, ...fixture, allowedOrigins: ["https://pasla.tech"] });
  const response = await app.request("/v2/kunci-publik");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { alg: "Ed25519", kid: fixture.signer.kid, kunci: [fixture.signer.publicKeyPem] });
  assert.equal(response.headers.get("x-trace-id"), body.meta.traceId);
  assert.ok(!JSON.stringify(body).includes("PRIVATE KEY"));
  const preflight = await app.request("/v2/laporan/sintesis", { method: "OPTIONS", headers: { origin: "https://pasla.tech" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://pasla.tech");
  assert.match(preflight.headers.get("access-control-allow-headers")!, /x-pasla-ai-key/);
});

test("v2 opens signed sources and streams validated, signed synthesis", async () => {
  const fixture = v2Fixture();
  const app = createApiApp({ service: service as any, ...fixture });
  const opened = await app.request("/v2/sumber/buka", { method: "POST", headers: v2Headers, body: JSON.stringify({ rujukan: [{ jenis: "ayat", surah: 1, ayat: 1 }] }) });
  assert.equal(opened.status, 200);
  const passage = (await opened.json()).data[0].potongan[0];
  assert.ok(verifySignature(signedPart(passage), passage.tanda, [fixture.signer.publicKeyPem]));
  const response = await app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, body: JSON.stringify({ ...v2Question, potongan: [passage] }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /application\/x-ndjson/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.jenis), ["mulai", "hasil"]);
  assert.equal(lines[0].traceId, response.headers.get("x-trace-id"));
  const { tanda, ...result } = lines[1].data;
  assert.equal(result.kalimat.length, 1);
  assert.ok(verifySignature(result, tanda, [fixture.signer.publicKeyPem]));
  assert.equal(fixture.calls(), 1);
  assert.ok(!JSON.stringify(lines).includes(v2Headers["x-pasla-ai-key"]));
});

test("v2 requires BYOK even when a platform AI model is available", async () => {
  const fixture = v2Fixture();
  const app = createApiApp({ service: service as any, ...fixture, resolveAiModel: () => { throw new Error("Tidak boleh memakai kunci platform."); } });
  const response = await app.request("/v2/laporan/sintesis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...v2Question, potongan: [{}] }) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "AI_KEY_REQUIRED");
  assert.equal(fixture.calls(), 0);
});

test("v2 rejects forged, modified and malformed passages before calling AI", async () => {
  const fixture = v2Fixture();
  const app = createApiApp({ service: service as any, ...fixture });
  const passage = (await fixture.sumber.buka({ jenis: "ayat", surah: 1, ayat: 1 })).potongan[0]!;
  const foreignSigner = createSigner(generateSigningKey());
  const forged = { ...passage, tanda: foreignSigner.sign(signedPart(passage)) };
  const tampered = { ...passage, text: `${passage.text} tambahan` };
  const relabelled = { ...passage, lapisan: ["norma"] };
  const response = await app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, body: JSON.stringify({ ...v2Question, potongan: [forged, tampered, relabelled, {}] }) });
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.jenis), ["mulai", "hasil"]);
  assert.equal(lines[1].data.potonganDitolak.length, 4);
  assert.deepEqual(lines[1].data.kalimat, []);
  assert.equal(lines[1].data.model, null);
  assert.equal(fixture.calls(), 0);
});

test("v2 validates JSON, source references and actual body size", async () => {
  const app = createApiApp({ service: service as any, ...v2Fixture() });
  for (const [body, status, code] of [
    ["{", 400, "INVALID_JSON"],
    [JSON.stringify({ rujukan: [{ jenis: "ayat", surah: 0, ayat: 1 }] }), 422, "VALIDATION_ERROR"],
    [JSON.stringify({ rujukan: [], padding: "x".repeat(20_000) }), 413, "PAYLOAD_TOO_LARGE"],
  ] as const) {
    const response = await app.request("/v2/sumber/buka", { method: "POST", headers: v2Headers, body });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("platform HTTP server forwards v2 signing and source dependencies", async () => {
  const fixture = v2Fixture();
  const server = createPlatformServer({ service: service as any, ...fixture, disableMcp: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/v2/kunci-publik`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.kid, fixture.signer.kid);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("v2 stops reading an oversized streamed request before buffering the whole body", async () => {
  const app = createApiApp({ service: service as any, ...v2Fixture() });
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks += 1;
      controller.enqueue(new Uint8Array(10_000));
      if (chunks === 10) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost/v2/sumber/buka", { method: "POST", body, duplex: "half" } as RequestInit);
  const response = await app.request(request);
  assert.equal(response.status, 413);
  assert.ok(cancelled);
  assert.ok(chunks < 10);
});

test("v2 does not start AI for a request that was already cancelled", async () => {
  const fixture = v2Fixture();
  const app = createApiApp({ service: service as any, ...fixture });
  const passage = (await fixture.sumber.buka({ jenis: "ayat", surah: 1, ayat: 1 })).potongan[0]!;
  const response = await app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, signal: AbortSignal.abort(), body: JSON.stringify({ ...v2Question, potongan: [passage] }) });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "DEADLINE");
  assert.equal(fixture.calls(), 0);
});

test("v2 bounds a slow source response and keeps its PDF slot occupied until work stops", async () => {
  const fixture = v2Fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const app = createApiApp({
    service: service as any, ...fixture, deadlineMs: 20, pools: { buka: 1, sintesis: 1, antrean: 0 },
    sumber: { buka: async (ref) => { await gate; return fixture.sumber.buka(ref); } },
  });
  const open = () => app.request("/v2/sumber/buka", { method: "POST", headers: v2Headers, body: JSON.stringify({ rujukan: [{ jenis: "ayat", surah: 1, ayat: 1 }] }) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = open();
  try {
    const result = await Promise.race([first, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 250); })]);
    assert.ok(result, "Respons harus selesai walau adapter belum menjawab.");
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, "DEADLINE");
    const busy = await open();
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).error.code, "BUSY");
    // Kolam AI tetap tersedia ketika sumber/PDF masih tertahan.
    const synthesis = await app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, body: JSON.stringify({ ...v2Question, potongan: [{}] }) });
    assert.match(await synthesis.text(), /"jenis":"hasil"/);
  } finally {
    clearTimeout(timer);
    release();
    await first;
  }
});

test("v2 propagates cancellation of an NDJSON reader to the AI model", async () => {
  const fixture = v2Fixture();
  const passage = (await fixture.sumber.buka({ jenis: "ayat", surah: 1, ayat: 1 })).potongan[0]!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let cancelled = false;
  const model: JsonModel = { provider: "claude", model: "uji", async generate({ signal }) {
    signal!.addEventListener("abort", () => { cancelled = true; release(); }, { once: true });
    await gate;
    return { kalimat: [], analisis: [] } as never;
  } };
  const app = createApiApp({ service: service as any, ...fixture, makeByokModel: () => model });
  const response = await app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, body: JSON.stringify({ ...v2Question, potongan: [passage] }) });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    await reader.cancel();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(cancelled);
  } finally { release(); }
});

test("v2 emits a deadline event when AI ignores cancellation and retains its occupied slot", async () => {
  const fixture = v2Fixture();
  const passage = (await fixture.sumber.buka({ jenis: "ayat", surah: 1, ayat: 1 })).potongan[0]!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const model: JsonModel = { provider: "claude", model: "uji", async generate() {
    await gate;
    return { kalimat: [], analisis: [] } as never;
  } };
  const app = createApiApp({ service: service as any, ...fixture, makeByokModel: () => model, deadlineMs: 20, pools: { buka: 1, sintesis: 1, antrean: 0 } });
  const synthesize = () => app.request("/v2/laporan/sintesis", { method: "POST", headers: v2Headers, body: JSON.stringify({ ...v2Question, potongan: [passage] }) });
  const response = await synthesize();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([response.text(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 250); })]);
    assert.ok(body, "Streaming harus berakhir meski model belum berhenti.");
    const events = body.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((item) => item.jenis), ["mulai", "galat"]);
    assert.equal(events[1].kode, "DEADLINE");
    const busy = await synthesize();
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).error.code, "BUSY");
  } finally {
    clearTimeout(timer);
    release();
  }
});

test("GET /v1/search validates its query and uses one error shape", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/search");
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(typeof body.error.traceId, "string");
});

test("GET /v1/search returns data, trace and security headers", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/search?q=akad%20murabahah&pageSize=10");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.query, "akad murabahah");
  assert.equal(body.meta.nextCursor, null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-trace-id"), body.meta.traceId);
});

test("GET /v1/search reports an invalid source as 422, not an internal error", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/search?q=akad&sources=regulation,unknown");
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("GET /v1/documents rejects an unknown source instead of silently changing authority", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/documents/bpk:123?source=unknown");
  assert.equal(response.status, 422);
});

test("GET /v1/documents/:id/articles/:article exposes fail-closed exact lookup", async () => {
  let received: unknown;
  const app = createApiApp({
    service: {
      ...service,
      lookupArticle: async (input: unknown) => {
        received = input;
        return { status: "insufficient_evidence", evidence: [], warnings: ["Pasal tidak ditemukan persis."] };
      },
    } as any,
  });
  const response = await app.request("/v1/documents/UU%2021%2F2008/articles/Pasal%209999");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(received, { regulation: "UU 21/2008", article: "Pasal 9999" });
  assert.equal(body.data.status, "insufficient_evidence");
  assert.deepEqual(body.data.evidence, []);
});

test("POST /v1/citations/verify rejects oversized drafts", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/citations/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(100_001) }),
  });

  assert.equal(response.status, 422);
});

test("unknown routes never expose an internal stack", async () => {
  const app = createApiApp({ service: service as any });
  const response = await app.request("/v1/does-not-exist");
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "traceId"]);
});

test("upload endpoints require an authenticated owner and preserve the idempotency key", async () => {
  const calls: any[] = [];
  const uploadStore = {
    createUpload: async (input: unknown) => {
      calls.push(input);
      return { id: "upload-1", uploadUrl: "/v1/uploads/upload-1/content" };
    },
    putUpload: async () => ({ id: "upload-1", status: "queued" }),
  };
  const body = JSON.stringify({
    fileName: "akad.pdf",
    contentType: "application/pdf",
    sizeBytes: 20,
    classification: "confidential",
    aiConsent: true,
  });
  const anonymous = createApiApp({ service: service as any, uploadStore });
  const denied = await anonymous.request("/v1/uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "intent-1" },
    body,
  });
  assert.equal(denied.status, 401);

  const authenticated = createApiApp({
    service: service as any,
    uploadStore,
    authenticate: async () => "user-1",
  });
  const created = await authenticated.request("/v1/uploads", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "idempotency-key": "intent-1",
    },
    body,
  });

  assert.equal(created.status, 201);
  assert.equal(calls[0].ownerId, "user-1");
  assert.equal(calls[0].idempotencyKey, "intent-1");
});

const verifiedEvidence = createEvidence({
  documentId: "bpk:uu-21-2008",
  text: "Bank Syariah adalah Bank yang menjalankan kegiatan usahanya berdasarkan Prinsip Syariah.",
  locator: { article: "Pasal 1 angka 7", page: 3 },
  provenance: {
    sourceName: "JDIH BPK RI",
    sourceUrl: "https://peraturan.bpk.go.id/Details/39655/uu-no-21-tahun-2008",
    authority: "Republik Indonesia",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    indexVersion: "test-1",
    verificationStatus: "verified_snapshot",
  },
});

test("AI research requires an account and explicit upload consent", async () => {
  const makeAiProvider = () => ({
    synthesize: async () => ({ summary: "Ringkas", claims: [], conflicts: [] }),
  });
  const resolveEvidence = async () => [verifiedEvidence];
  const anonymous = createApiApp({ service: service as any, makeAiProvider, resolveEvidence });
  const denied = await anonymous.request("/v1/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Apa definisi Bank Syariah?", useAi: true, evidenceIds: [verifiedEvidence.id] }),
  });
  assert.equal(denied.status, 401);

  const authenticated = createApiApp({
    service: service as any,
    authenticate: async () => "user-1",
    makeAiProvider,
    resolveEvidence,
    jobStore: { getJob: async () => ({ aiConsent: false, classification: "confidential" }) },
  });
  const noConsent = await authenticated.request("/v1/research", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({
      question: "Apa definisi Bank Syariah?",
      useAi: true,
      evidenceIds: [verifiedEvidence.id],
      documentContext: { source: "upload", uploadId: "00000000-0000-4000-8000-000000000010" },
    }),
  });
  const body = await noConsent.json();
  assert.equal(noConsent.status, 422);
  assert.equal(body.error.code, "AI_CONSENT_REQUIRED");
});

test("AI research accepts ephemeral BYOK and drops unsupported provider claims", async () => {
  let receivedKey: string | undefined;
  const app = createApiApp({
    service: service as any,
    authenticate: async () => "user-1",
    resolveEvidence: async () => [verifiedEvidence],
    makeAiProvider: (key) => {
      receivedKey = key;
      return {
        synthesize: async () => ({
          summary: "Definisi ditemukan.",
          claims: [
            { text: "Bank Syariah beroperasi berdasarkan Prinsip Syariah.", evidenceIds: [verifiedEvidence.id] },
            { text: "Klaim rekaan", evidenceIds: ["ev_000000000000000000000000"] },
          ],
          conflicts: [],
        }),
      };
    },
  });
  const response = await app.request("/v1/research", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "x-gemini-api-key": "ephemeral-key",
    },
    body: JSON.stringify({ question: "Apa definisi Bank Syariah?", useAi: true, evidenceIds: [verifiedEvidence.id] }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(receivedKey, "ephemeral-key");
  assert.equal(body.data.status, "partial");
  assert.equal(body.data.claims.length, 1);
  assert.doesNotMatch(JSON.stringify(body), /ephemeral-key/);
});

test("source status probes run at most once per window for all callers", async () => {
  let calls = 0;
  const app = createApiApp({
    service: {
      ...service,
      getSourceStatus: async () => {
        calls += 1;
        return { hasil: [] };
      },
    } as any,
  });

  const responses = await Promise.all([
    app.request("/v1/sources/status"),
    app.request("/v1/sources/status"),
    app.request("/v1/sources/status"),
  ]);
  await app.request("/v1/sources/status");

  assert.equal(calls, 1);
  assert.ok(responses.every((response) => response.status === 200));
  const body = await responses[0]!.json();
  assert.equal(typeof body.meta.checkedAt, "string");
});
