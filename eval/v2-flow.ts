import { z } from "zod";
import { createHash, createPublicKey } from "node:crypto";
import { RencanaSchema } from "../src/core/laporan.js";
import { checkPassage } from "../src/core/sintesis.js";
import { canonicalJson, verifySignature, type Signature } from "../src/core/sign.js";
import type { HasilBuka, PotonganBertanda, RujukanBuka } from "../src/core/sumber.js";
import type { RumpunId } from "../src/rumpun/index.js";

/** Discovery has no access to answer keys or rujukan_wajib. Score only afterward. */
export type V2Question = { pertanyaan: string; rumpun: RumpunId };
export type V2FlowPorts = {
  plan(input: V2Question): Promise<unknown>;
  search(input: { rumpun: RumpunId; query: string; sumber: string[]; limit: number }): Promise<unknown>;
  open(reference: RujukanBuka): Promise<HasilBuka>;
  screen(input: unknown): Promise<unknown>;
  synthesize(input: unknown): Promise<unknown>;
};
const Candidate = z.object({ id: z.string().min(1).max(100), judul: z.string().max(500), rujukan: z.unknown().nullable() });
const Screen = z.object({ hasil: z.array(z.object({ id: z.string(), keputusan: z.enum(["masukkan", "keluarkan", "historis", "tidak_dapat_diperiksa"]) })).max(24) });
export function evalKeyFingerprint(pem: string) {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519" ? createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex") : null;
  } catch { return null; }
}
function signedObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("EVAL_SIGNATURE");
  const { tanda, ...data } = value as Record<string, unknown>;
  try { if (!verifySignature(data, tanda as Signature, keys)) throw new Error(); }
  catch { throw new Error("EVAL_SIGNATURE"); }
  return data;
}

export async function runV2Flow(question: V2Question, ports: V2FlowPorts, publicKeys: string[]) {
  if (!publicKeys.length) throw new Error("EVAL_PIN_REQUIRED");
  // Copy only the two question fields: an accidental extra answer-key property
  // cannot cross the planning boundary, even from an untyped caller.
  const input = { pertanyaan: question.pertanyaan.trim(), rumpun: question.rumpun };
  const plan = await ports.plan(input);
  const planData = signedObject(plan, publicKeys);
  if (planData.pertanyaan !== input.pertanyaan || planData.rumpun !== input.rumpun) throw new Error("EVAL_PLAN_CONTEXT");
  const rencana = RencanaSchema.parse(planData.rencana);
  const candidates: Array<z.infer<typeof Candidate>> = [];
  const candidateIds = new Set<string>();
  const references = new Set<string>();
  for (const search of rencana.penelusuran) {
    const raw = z.object({ kandidat: z.array(Candidate).max(50) }).parse(await ports.search({ rumpun: input.rumpun, query: search.kueri, sumber: search.sumber, limit: 24 }));
    for (const candidate of raw.kandidat) {
      if (candidates.length === 24) break;
      const ref = canonicalJson(candidate.rujukan);
      if (candidateIds.has(candidate.id) || candidate.rujukan && references.has(ref)) continue;
      candidateIds.add(candidate.id);
      if (candidate.rujukan) references.add(ref);
      candidates.push(candidate);
    }
  }
  const opened: Array<{ candidateId: string; result: HasilBuka }> = [];
  let passageCount = 0;
  for (const candidate of candidates) {
    if (!candidate.rujukan || passageCount >= 120) continue;
    const result = await ports.open(candidate.rujukan as RujukanBuka);
    if (!["dibuka", "tidak_ditemukan", "tidak_dapat_diperiksa"].includes(result.status) || !Array.isArray(result.potongan) || result.potongan.length > 120 - passageCount) throw new Error("EVAL_OPEN_RESULT");
    for (const passage of result.potongan) {
      try { if (checkPassage(passage, publicKeys)) throw new Error(); }
      catch { throw new Error("EVAL_PASSAGE"); }
    }
    passageCount += result.potongan.length;
    opened.push({ candidateId: candidate.id, result });
  }
  const screeningInput = { rencana, kandidat: candidates.map(candidate => {
    const openedSource = opened.find(row => row.candidateId === candidate.id)?.result;
    return { id: candidate.id, judul: candidate.judul, statusBuka: openedSource?.status ?? "tidak_dapat_diperiksa", potongan: openedSource?.potongan.slice(0, 24) ?? [] };
  }) };
  const screen = await ports.screen(screeningInput);
  const verdict = Screen.parse(signedObject(screen, publicKeys));
  if (verdict.hasil.length !== candidates.length || new Set(verdict.hasil.map(item => item.id)).size !== candidates.length || verdict.hasil.some(item => !candidateIds.has(item.id))) throw new Error("EVAL_SCREEN_CONTEXT");
  const selected: PotonganBertanda[] = [];
  const passageIds = new Map<string, string>();
  for (const decision of verdict.hasil) {
    if (decision.keputusan !== "masukkan") continue;
    const row = opened.find(row => row.candidateId === decision.id)?.result;
    if (row?.status !== "dibuka") throw new Error("EVAL_SCREEN_CONTEXT");
    for (const passage of row.potongan.slice(0, 24)) {
      const previous = passageIds.get(passage.id);
      if (previous && previous !== passage.contentHash) throw new Error("EVAL_PASSAGE_ID");
      if (!previous && selected.length < 24) { passageIds.set(passage.id, passage.contentHash); selected.push(passage); }
    }
  }
  const sections: unknown[] = [];
  if (selected.length) for (const plannedSection of rencana.bagian) {
    const bagian = z.object({ judul: z.string().trim().min(1).max(120), fokus: z.string().trim().min(1).max(600) }).parse(plannedSection);
    const section = await ports.synthesize({ pertanyaan: input.pertanyaan, bagian, potongan: selected });
    const data = signedObject(section, publicKeys);
    if (data.pertanyaan !== input.pertanyaan || canonicalJson(data.bagian) !== canonicalJson(bagian)) throw new Error("EVAL_SECTION_CONTEXT");
    const sourceHashes = z.array(z.object({ id: z.string(), contentHash: z.string() })).parse(data.potongan);
    if (canonicalJson(sourceHashes) !== canonicalJson(selected.map(p => ({ id: p.id, contentHash: p.contentHash })))) throw new Error("EVAL_SECTION_CONTEXT");
    sections.push(section);
  }
  return { question: input, plan, candidates, opened, screen, selected, sections, automatedEvidenceSelection: true as const };
}
