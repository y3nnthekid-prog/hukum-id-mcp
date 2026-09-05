import assert from "node:assert/strict";
import test from "node:test";

import { createApiApp } from "../src/api/app.js";
import { createEvidence } from "../src/core/contracts.js";

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
