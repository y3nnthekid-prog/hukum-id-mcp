import assert from "node:assert/strict";
import test from "node:test";

import {
  EvidenceSchema,
  JobStatusSchema,
  ResearchResultSchema,
  SourceHealthSchema,
  createEvidence,
  createResearchResult,
} from "../src/core/contracts.js";

const input = {
  documentId: "bpk:uu-27-2022",
  text: "Pasal 46 mewajibkan pemberitahuan paling lambat 3 x 24 jam.",
  locator: { article: "Pasal 46", page: 26 },
  provenance: {
    sourceName: "JDIH BPK RI",
    sourceUrl: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
    authority: "DPR RI dan Presiden RI",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    indexVersion: "test-1",
    verificationStatus: "verified_snapshot" as const,
  },
};

test("createEvidence generates a stable content-addressed id", () => {
  const first = createEvidence(input);
  const second = createEvidence({ ...input });

  assert.equal(first.id, second.id);
  assert.match(first.provenance.contentHash, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => EvidenceSchema.parse(first));
});

test("research results remove unsupported claims instead of presenting them", () => {
  const evidence = createEvidence(input);
  const result = createResearchResult({
    query: "Apa kewajiban notifikasi kebocoran data?",
    evidence: [evidence],
    claims: [
      { text: "Pemberitahuan wajib dilakukan dalam 3 x 24 jam.", evidenceIds: [evidence.id] },
      { text: "Denda selalu sepuluh miliar rupiah.", evidenceIds: ["missing-evidence"] },
    ],
  });

  assert.equal(result.claims.length, 1);
  assert.equal(result.coverage, 0.5);
  assert.ok(result.warnings.some((warning) => warning.includes("1 klaim")));
  assert.doesNotThrow(() => ResearchResultSchema.parse(result));
});

test("research results abstain when no claim has evidence", () => {
  const result = createResearchResult({
    query: "Pertanyaan tanpa sumber",
    evidence: [],
    claims: [{ text: "Klaim tanpa dasar", evidenceIds: [] }],
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.claims.length, 0);
  assert.equal(result.confidence, 0);
});

test("source and job health contracts reject misleading state", () => {
  const now = "2026-09-05T10:00:00.000Z";
  const source = SourceHealthSchema.parse({
    sourceId: "jdih-bpk",
    status: "degraded",
    lastSuccessfulAt: now,
    ageSeconds: 3600,
    activeIndexVersion: "2026.09.05",
    lastFailure: "timeout",
    incomplete: true,
  });
  assert.equal(source.incomplete, true);
  assert.throws(() => JobStatusSchema.parse({
    id: "job-1",
    status: "completed",
    progress: 101,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    warnings: [],
    errorCode: null,
  }));
});
