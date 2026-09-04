import assert from "node:assert/strict";
import test from "node:test";

import { createLegalResearchService, type LegalAdapters } from "../src/core/service.js";

function fakeAdapters(overrides: Partial<LegalAdapters> = {}): LegalAdapters {
  return {
    searchRegulations: async () => ({
      hasil: [
        {
          id: "229798",
          jenis: "UU",
          nomor: "27",
          tahun: "2022",
          judul: "Pelindungan Data Pribadi",
          url: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
        },
      ],
    }),
    searchMaProducts: async () => ({ hasil: [] }),
    searchFatwas: async () => ({ hasil: [] }),
    searchMaDecisions: async () => ({ hasil: [] }),
    searchMkDecisions: async () => ({ hasil: [] }),
    searchLiterature: async () => ({ hasil: [] }),
    getRegulation: async () => ({}),
    getMaDecision: async () => ({}),
    inspectArticle: async () => ({ ditemukan: false, status: "not_found" }),
    verifyCitations: async () => ({ hasil: [] }),
    traceRegulation: async () => ({}),
    lawAtDate: async () => ({}),
    researchSharia: async () => ({}),
    inspectKhes: async () => ({}),
    sourceStatus: async () => ({ hasil: [] }),
    ...overrides,
  };
}

test("search isolates a failed source and returns the healthy source", async () => {
  const service = createLegalResearchService(
    fakeAdapters({ searchFatwas: async () => Promise.reject(new Error("DSN unavailable")) })
  );

  const result = await service.searchLegalSources({ query: "pelindungan data", sources: ["regulation", "fatwa"] });

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]?.id, "bpk:229798");
  assert.ok(result.warnings.some((warning) => warning.includes("fatwa")));
  assert.equal(result.sourceStatus.fatwa, "failed");
});

test("article lookup abstains when the exact article was not found", async () => {
  const service = createLegalResearchService(fakeAdapters());
  const result = await service.lookupArticle({ regulation: "UU 27/2022", article: "Pasal 9999" });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.claims.length, 0);
  assert.equal(result.evidence.length, 0);
});

test("article lookup exposes page-level evidence and provenance", async () => {
  const service = createLegalResearchService(
    fakeAdapters({
      inspectArticle: async () => ({
        sumber: "JDIH BPK RI",
        peraturan: {
          id: "229798",
          judul: "Pelindungan Data Pribadi",
          jenis: "UU",
          nomor: "27",
          tahun: "2022",
          url: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
          url_pdf: "https://peraturan.bpk.go.id/Home/Download/123/test.pdf",
        },
        pasal: {
          dicari: "Pasal 46",
          kutipan: [{ halaman: 26, teks: "Pasal 46 mewajibkan pemberitahuan." }],
        },
        peringatan: [],
      }),
    })
  );

  const result = await service.lookupArticle({ regulation: "UU 27/2022", article: "Pasal 46" });

  assert.equal(result.status, "complete");
  assert.equal(result.evidence[0]?.locator.page, 26);
  assert.equal(result.claims[0]?.evidenceIds[0], result.evidence[0]?.id);
  assert.match(result.evidence[0]?.provenance.contentHash ?? "", /^[a-f0-9]{64}$/);
});
