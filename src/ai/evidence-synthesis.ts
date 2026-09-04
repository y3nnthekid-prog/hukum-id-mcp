import { z } from "zod";

import { createResearchResult, type Evidence, type ResearchResult } from "../core/contracts.js";

export const AiDraftSchema = z.object({
  summary: z.string().max(5_000),
  claims: z.array(z.object({ text: z.string().min(1).max(5_000), evidenceIds: z.array(z.string()).max(20) })).max(50),
  conflicts: z.array(z.string().min(1).max(2_000)).max(20),
});

export type AiDraft = z.infer<typeof AiDraftSchema>;

export type EvidenceSynthesisInput = {
  question: string;
  evidence: Evidence[];
  evidenceRole: "untrusted_quoted_evidence";
  signal?: AbortSignal | undefined;
};

export interface EvidenceSynthesisProvider {
  synthesize(input: EvidenceSynthesisInput): Promise<AiDraft>;
}

/**
 * Synthesizes only verified evidence and applies the same claim validator used
 * by API and MCP. Provider output is never trusted as a final legal result.
 */
export async function synthesizeEvidenceFirst(
  input: { question: string; evidence: Evidence[]; signal?: AbortSignal | undefined },
  provider: EvidenceSynthesisProvider
): Promise<ResearchResult> {
  const verifiedEvidence = input.evidence.filter((item) =>
    ["verified_live", "verified_snapshot"].includes(item.provenance.verificationStatus)
  );

  if (verifiedEvidence.length === 0) {
    return createResearchResult({
      query: input.question,
      evidence: input.evidence,
      warnings: ["Tidak ada evidence terverifikasi; AI tidak dipanggil dan sistem abstain."],
    });
  }

  const draft = AiDraftSchema.parse(
    await provider.synthesize({
      question: input.question,
      evidence: verifiedEvidence,
      evidenceRole: "untrusted_quoted_evidence",
      ...(input.signal ? { signal: input.signal } : {}),
    })
  );

  return createResearchResult({
    query: input.question,
    summary: draft.summary,
    evidence: input.evidence,
    claims: draft.claims,
    conflicts: draft.conflicts,
    warnings: ["Sintesis AI dibatasi pada evidence terverifikasi dan tetap memerlukan penilaian peneliti."],
  });
}
