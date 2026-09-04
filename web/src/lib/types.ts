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
