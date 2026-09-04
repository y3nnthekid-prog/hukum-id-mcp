import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const EvidenceStatusSchema = z.enum([
  "verified_live",
  "verified_snapshot",
  "ambiguous",
  "conflicting",
  "insufficient_evidence",
]);

export const LegalDocumentSchema = z.object({
  id: z.string().min(1),
  jurisdiction: z.literal("ID").default("ID"),
  authority: z.string().min(1),
  documentType: z.string().min(1),
  number: z.string().nullable().default(null),
  year: z.string().nullable().default(null),
  title: z.string().min(1),
  status: z.string().nullable().default(null),
  effectiveFrom: z.string().date().nullable().default(null),
  effectiveTo: z.string().date().nullable().default(null),
  canonicalUrl: z.string().url(),
});

export const EvidenceLocatorSchema = z.object({
  article: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  paragraph: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
});

export const ProvenanceSchema = z.object({
  sourceName: z.string().min(1),
  sourceUrl: z.string().url(),
  authority: z.string().min(1),
  retrievedAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  indexVersion: z.string().min(1),
  verificationStatus: EvidenceStatusSchema,
});

export const EvidenceSchema = z.object({
  id: z.string().regex(/^ev_[a-f0-9]{24}$/),
  documentId: z.string().min(1),
  text: z.string().min(1),
  locator: EvidenceLocatorSchema,
  provenance: ProvenanceSchema,
});

export const ClaimSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
});

export const ResearchResultSchema = z.object({
  traceId: z.string().uuid(),
  query: z.string().min(1),
  status: z.enum(["complete", "partial", "insufficient_evidence"]),
  summary: z.string(),
  claims: z.array(ClaimSchema),
  evidence: z.array(EvidenceSchema),
  conflicts: z.array(z.string()),
  warnings: z.array(z.string()),
  coverage: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  generatedAt: z.string().datetime({ offset: true }),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type Claim = z.infer<typeof ClaimSchema>;

type EvidenceInput = Omit<Evidence, "id" | "provenance"> & {
  provenance: Omit<Evidence["provenance"], "contentHash">;
};

export function createEvidence(input: EvidenceInput): Evidence {
  const contentHash = createHash("sha256").update(input.text.normalize("NFC")).digest("hex");
  const identity = JSON.stringify({
    documentId: input.documentId,
    locator: input.locator,
    contentHash,
    sourceUrl: input.provenance.sourceUrl,
  });
  const id = `ev_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;

  return EvidenceSchema.parse({
    ...input,
    id,
    provenance: { ...input.provenance, contentHash },
  });
}

type ResearchResultInput = {
  query: string;
  summary?: string;
  claims?: Array<{ text: string; evidenceIds: string[] }>;
  evidence?: Evidence[];
  conflicts?: string[];
  warnings?: string[];
  traceId?: string;
};

export function createResearchResult(input: ResearchResultInput): ResearchResult {
  const evidence = input.evidence ?? [];
  const claims = input.claims ?? [];
  const knownEvidence = new Set(evidence.map((item) => item.id));
  const supportedClaims = claims.filter(
    (claim) => claim.evidenceIds.length > 0 && claim.evidenceIds.every((id) => knownEvidence.has(id))
  );
  const removed = claims.length - supportedClaims.length;
  const coverage = claims.length === 0 ? 0 : supportedClaims.length / claims.length;
  const warnings = [...(input.warnings ?? [])];
  if (removed > 0) warnings.push(`${removed} klaim dibuang karena tidak memiliki evidence yang sah.`);

  const status =
    supportedClaims.length === 0
      ? "insufficient_evidence"
      : supportedClaims.length === claims.length
        ? "complete"
        : "partial";

  return ResearchResultSchema.parse({
    traceId: input.traceId ?? randomUUID(),
    query: input.query,
    status,
    summary:
      status === "insufficient_evidence"
        ? "Bukti yang tersedia belum cukup untuk menyusun simpulan."
        : input.summary ?? supportedClaims.map((claim) => claim.text).join(" "),
    claims: supportedClaims,
    evidence,
    conflicts: input.conflicts ?? [],
    warnings,
    coverage,
    confidence: status === "insufficient_evidence" ? 0 : Math.round(coverage * 100) / 100,
    generatedAt: new Date().toISOString(),
  });
}
