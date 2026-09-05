export type SearchSource =
  | "regulation"
  | "ma-product"
  | "fatwa"
  | "ma-decision"
  | "mk-decision"
  | "literature";

export type LegalDocument = {
  id: string;
  jurisdiction: "ID";
  authority: string;
  documentType: string;
  number: string | null;
  year: string | null;
  title: string;
  status: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  canonicalUrl: string;
};

export type SearchResponse = {
  data: {
    query: string;
    documents: LegalDocument[];
    sourceStatus: Partial<Record<SearchSource, "ok" | "failed">>;
    warnings: string[];
    nextCursor: string | null;
  };
  meta: { traceId: string; nextCursor: string | null };
};

export type ResearchResponse = {
  data: {
    traceId: string;
    query: string;
    status: "complete" | "partial" | "insufficient_evidence";
    summary: string;
    claims: Array<{ text: string; evidenceIds: string[] }>;
    evidence: Array<{
      id: string;
      documentId: string;
      text: string;
      locator: { article?: string; section?: string; paragraph?: string; page?: number };
      provenance: {
        sourceName: string;
        sourceUrl: string;
        authority: string;
        retrievedAt: string;
        contentHash: string;
        indexVersion: string;
        verificationStatus: string;
      };
    }>;
    conflicts: string[];
    warnings: string[];
    coverage: number;
    confidence: number;
    generatedAt: string;
  };
  meta: { traceId: string };
};
