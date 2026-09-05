import { createEvidence, createResearchResult } from "../../src/core/contracts.js";
import type { LegalResearchService } from "../../src/core/service.js";

export const CHANNEL_FIXTURE_QUERY = "Apa definisi Bank Syariah?";
export const CHANNEL_FIXTURE_RELEASE = "fixture-release-2026-09-06";
export const CHANNEL_FIXTURE_EVIDENCE = createEvidence({
  documentId: "bpk:uu-21-2008",
  text: "Bank Syariah adalah Bank yang menjalankan kegiatan usahanya berdasarkan Prinsip Syariah.",
  locator: { article: "Pasal 1 angka 7", page: 3 },
  provenance: {
    sourceName: "JDIH BPK RI",
    sourceUrl: "https://peraturan.bpk.go.id/Details/39655/uu-no-21-tahun-2008",
    authority: "Republik Indonesia",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    indexVersion: CHANNEL_FIXTURE_RELEASE,
    verificationStatus: "verified_snapshot",
  },
});

export const CHANNEL_FIXTURE_SERVICE: LegalResearchService = {
  searchLegalSources: async ({ query }: { query: string }) => ({
    query,
    documents: [],
    sourceStatus: { regulation: "ok" },
    warnings: [],
    nextCursor: null,
  }),
  getLegalDocument: async () => ({}),
  lookupArticle: async () =>
    createResearchResult({
      query: CHANNEL_FIXTURE_QUERY,
      evidence: [CHANNEL_FIXTURE_EVIDENCE],
      claims: [{ text: CHANNEL_FIXTURE_EVIDENCE.text, evidenceIds: [CHANNEL_FIXTURE_EVIDENCE.id] }],
    }),
  verifyCitation: async () => ({ hasil: [] }),
  traceRegulation: async () => ({}),
  searchJurisprudence: async () => ({ documents: [] }),
  researchShariaIssue: async () => ({}),
  analyzeLegalProblem: async ({ question }: { question: string }) =>
    createResearchResult({
      query: question,
      evidence: [CHANNEL_FIXTURE_EVIDENCE],
      claims: [{ text: CHANNEL_FIXTURE_EVIDENCE.text, evidenceIds: [CHANNEL_FIXTURE_EVIDENCE.id] }],
    }),
  analyzeUploadedDocument: async () => ({}),
  getSourceStatus: async () => ({ hasil: [] }),
};
