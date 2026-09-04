import { randomUUID } from "node:crypto";

import {
  LegalDocumentSchema,
  createEvidence,
  createResearchResult,
  type Evidence,
  type ResearchResult,
} from "./contracts.js";

export type SearchSource =
  | "regulation"
  | "ma-product"
  | "fatwa"
  | "ma-decision"
  | "mk-decision"
  | "literature";

type LegacyRecord = Record<string, any>;
type AsyncAdapter = (input: LegacyRecord) => Promise<LegacyRecord>;

export interface LegalAdapters {
  searchRegulations: AsyncAdapter;
  searchMaProducts: AsyncAdapter;
  searchFatwas: AsyncAdapter;
  searchMaDecisions: AsyncAdapter;
  searchMkDecisions: AsyncAdapter;
  searchLiterature: AsyncAdapter;
  getRegulation: (ref: string) => Promise<LegacyRecord>;
  getMaDecision: (ref: string) => Promise<LegacyRecord>;
  inspectArticle: AsyncAdapter;
  verifyCitations: AsyncAdapter;
  traceRegulation: AsyncAdapter;
  lawAtDate: AsyncAdapter;
  researchSharia: AsyncAdapter;
  inspectKhes: AsyncAdapter;
  sourceStatus: AsyncAdapter;
}

export type SearchLegalInput = {
  query: string;
  sources?: SearchSource[] | undefined;
  number?: string | undefined;
  year?: string | undefined;
  pageSize?: number | undefined;
};

const SOURCE_ADAPTER: Record<SearchSource, keyof LegalAdapters> = {
  regulation: "searchRegulations",
  "ma-product": "searchMaProducts",
  fatwa: "searchFatwas",
  "ma-decision": "searchMaDecisions",
  "mk-decision": "searchMkDecisions",
  literature: "searchLiterature",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedDocument(source: SearchSource, item: LegacyRecord) {
  const sourceUrl =
    asText(item.url) || asText(item.url_detail) || asText(item.url_pdf) || asText(item.doi_url) || asText(item.doi);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;

  const sourceConfig: Record<SearchSource, { prefix: string; authority: string; type: string }> = {
    regulation: { prefix: "bpk", authority: "JDIH BPK RI", type: asText(item.jenis) || "PERATURAN" },
    "ma-product": { prefix: "jdih-ma", authority: "Mahkamah Agung RI", type: "PRODUK_HUKUM_MA" },
    fatwa: { prefix: "dsn", authority: "DSN-MUI", type: "FATWA" },
    "ma-decision": { prefix: "ma", authority: "Mahkamah Agung RI", type: "PUTUSAN" },
    "mk-decision": { prefix: "mk", authority: "Mahkamah Konstitusi RI", type: "PUTUSAN" },
    literature: { prefix: "openalex", authority: "Sumber sekunder", type: "LITERATUR" },
  };
  const config = sourceConfig[source];
  const rawId = asText(item.id) || asText(item.nomor) || asText(item.nomor_perkara) || sourceUrl;
  const title = asText(item.judul) || asText(item.nomor_perkara) || asText(item.title);
  if (!title) return null;

  return LegalDocumentSchema.parse({
    id: `${config.prefix}:${rawId}`,
    jurisdiction: "ID",
    authority: config.authority,
    documentType: config.type,
    number: asText(item.nomor) || asText(item.nomor_perkara) || null,
    year: asText(item.tahun) || null,
    title,
    status: asText(item.status) || null,
    effectiveFrom: null,
    effectiveTo: null,
    canonicalUrl: sourceUrl,
  });
}

export function createLegalResearchService(adapters: LegalAdapters) {
  async function searchLegalSources(input: SearchLegalInput) {
    const sources: SearchSource[] = input.sources?.length
      ? [...new Set(input.sources)]
      : ["regulation", "ma-product", "fatwa"];
    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50);
    const sourceStatus: Partial<Record<SearchSource, "ok" | "failed">> = {};
    const warnings: string[] = [];

    const groups = await Promise.all(
      sources.map(async (source) => {
        try {
          const adapter = adapters[SOURCE_ADAPTER[source]] as AsyncAdapter;
          const result = await adapter({
            query: input.query,
            keywords: input.query,
            nomor: input.number ?? "",
            tahun: input.year ?? "",
            limit: pageSize,
          });
          sourceStatus[source] = "ok";
          return (result.hasil ?? []).map((item: LegacyRecord) => normalizedDocument(source, item)).filter(Boolean);
        } catch (error) {
          sourceStatus[source] = "failed";
          warnings.push(`${source} gagal: ${error instanceof Error ? error.message : "galat tidak dikenal"}`);
          return [];
        }
      })
    );

    return {
      traceId: randomUUID(),
      query: input.query,
      documents: groups.flat().slice(0, pageSize),
      sourceStatus,
      warnings,
      nextCursor: null,
    };
  }

  async function lookupArticle(input: { regulation: string; article: string }): Promise<ResearchResult> {
    const raw = await adapters.inspectArticle({ peraturan: input.regulation, pasal: input.article });
    const excerpts = Array.isArray(raw.pasal?.kutipan) ? raw.pasal.kutipan : [];
    const sourceUrl = asText(raw.peraturan?.url_pdf) || asText(raw.peraturan?.url);
    if (raw.ditemukan === false || excerpts.length === 0 || !sourceUrl) {
      return createResearchResult({
        query: `${input.regulation} ${input.article}`,
        evidence: [],
        claims: [],
        warnings: [
          asText(raw.catatan) || `Frasa ${input.article} tidak ditemukan persis; sistem tidak mengembalikan halaman lain.`,
        ],
      });
    }

    const retrievedAt = new Date().toISOString();
    const evidence: Evidence[] = excerpts
      .filter((excerpt: LegacyRecord) => asText(excerpt.teks))
      .map((excerpt: LegacyRecord) =>
        createEvidence({
          documentId: `bpk:${asText(raw.peraturan?.id) || sourceUrl}`,
          text: asText(excerpt.teks),
          locator: { article: input.article, ...(excerpt.halaman ? { page: Number(excerpt.halaman) } : {}) },
          provenance: {
            sourceName: asText(raw.sumber) || "Sumber hukum resmi",
            sourceUrl,
            authority: asText(raw.sumber) || "Otoritas penerbit",
            retrievedAt,
            indexVersion: process.env.HUKUM_INDEX_VERSION || "legacy-live",
            verificationStatus: "verified_snapshot",
          },
        })
      );

    return createResearchResult({
      query: `${input.regulation} ${input.article}`,
      summary: `Ditemukan ${evidence.length} kutipan untuk ${input.article}.`,
      evidence,
      claims: evidence.map((item) => ({ text: item.text, evidenceIds: [item.id] })),
      warnings: Array.isArray(raw.peringatan) ? raw.peringatan : [],
    });
  }

  return {
    searchLegalSources,
    async getLegalDocument(input: { source: "regulation" | "ma-decision"; ref: string }) {
      const prefix = input.source === "regulation" ? "bpk:" : "ma:";
      const ref = input.ref.startsWith(prefix) ? input.ref.slice(prefix.length) : input.ref;
      return input.source === "regulation" ? adapters.getRegulation(ref) : adapters.getMaDecision(ref);
    },
    lookupArticle,
    async verifyCitation(input: { text: string }) {
      return adapters.verifyCitations({ teks: input.text });
    },
    async traceRegulation(input: { regulation: string; article?: string | undefined; asOf?: string | undefined }) {
      if (input.asOf) return adapters.lawAtDate({ peraturan: input.regulation, tanggal: input.asOf });
      return adapters.traceRegulation({ peraturan: input.regulation, pasal: input.article ?? "Pasal 1" });
    },
    async searchJurisprudence(input: {
      query: string;
      court?: "MA" | "MK" | undefined;
      pageSize?: number | undefined;
    }) {
      return searchLegalSources({
        query: input.query,
        sources: input.court === "MA" ? ["ma-decision"] : input.court === "MK" ? ["mk-decision"] : ["ma-decision", "mk-decision"],
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      });
    },
    async researchShariaIssue(input: { topic: string }) {
      return adapters.researchSharia({ akad: input.topic });
    },
    async analyzeLegalProblem(input: { question: string }) {
      const search = await searchLegalSources({ query: input.question });
      return createResearchResult({
        query: input.question,
        evidence: [],
        claims: [],
        warnings: [
          ...search.warnings,
          "Metadata pencarian bukan evidence isi. Buka dokumen atau pasal sebelum menyusun simpulan.",
        ],
      });
    },
    async analyzeUploadedDocument(input: { text: string }) {
      return adapters.verifyCitations({ teks: input.text });
    },
    async getSourceStatus(input: { importantOnly?: boolean | undefined } = {}) {
      return adapters.sourceStatus({ hanya_penting: input.importantOnly ?? false });
    },
  };
}

export type LegalResearchService = ReturnType<typeof createLegalResearchService>;
