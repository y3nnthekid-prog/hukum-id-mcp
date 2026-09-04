import assert from "node:assert/strict";
import test from "node:test";

import { createApiApp } from "../src/api/app.js";

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
