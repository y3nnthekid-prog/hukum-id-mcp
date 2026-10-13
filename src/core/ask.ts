import { synthesizeEvidenceFirst } from "../ai/evidence-synthesis.js";
import { AiProviderError, evidenceProviderFromModel, type JsonModel } from "../ai/json-model.js";
import { heuristicPlan, planWithModel, type AskPlan } from "../ai/planner.js";
import { createEvidence, createResearchResult, type Evidence, type ResearchResult } from "./contracts.js";
import type { LegalAdapters, LegalResearchService } from "./service.js";

type LegacyRecord = Record<string, any>;

/** Kartu sumber yang dibuka server, lengkap dengan status yang dibaca dari sumbernya. */
export type AskSource = {
  kind: "regulation" | "ma-product" | "fatwa";
  reference: string;
  title: string;
  authority: string;
  status: string | null;
  effectiveFrom: string | null;
  url: string | null;
  pdfUrl: string | null;
  amendedBy: string[];
  revokedBy: string[];
  warnings: string[];
  evidenceIds: string[];
};

/** Kandidat dari pencarian. Belum dibuka, jadi bukan evidence. */
export type AskCandidate = {
  title: string;
  documentType: string;
  number: string | null;
  year: string | null;
  status: string | null;
  url: string;
};

export type AskResponse = {
  result: ResearchResult;
  sources: AskSource[];
  candidates: AskCandidate[];
  plan: AskPlan;
  attempted: string[];
  ai: { provider: string; model: string; used: boolean } | null;
  limits: string[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function relationNames(raw: LegacyRecord, label: string): string[] {
  const list = raw.relasi_status?.[label];
  return Array.isArray(list) ? list.map((item: LegacyRecord) => text(item.peraturan)).filter(Boolean).slice(0, 8) : [];
}

function unique(items: string[], max: number): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, max);
}

/**
 * Menjawab satu pertanyaan bahasa sehari-hari.
 *
 * Urutannya disengaja: rencanakan rujukan, buka setiap rujukan lewat exact
 * lookup yang gagal tertutup, kumpulkan evidence dari teks resmi, lalu baru
 * sintesis. AI tidak pernah melihat apa pun selain evidence yang sudah dibuka
 * server, dan kegagalan AI tidak menghapus kutipan resmi yang sudah didapat.
 */
export function createAsk(deps: {
  adapters: Pick<LegalAdapters, "inspectArticle" | "researchSharia">;
  service: Pick<LegalResearchService, "searchLegalSources">;
  limits?: string[] | undefined;
}) {
  return async function ask(input: {
    question: string;
    model?: JsonModel | null | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<AskResponse> {
    const attempted: string[] = [];
    const warnings: string[] = [];
    const sources: AskSource[] = [];
    const evidence: Evidence[] = [];
    const model = input.model ?? null;

    let plan: AskPlan;
    if (model) {
      try {
        plan = await planWithModel(input.question, model, input.signal);
      } catch (error) {
        plan = heuristicPlan(input.question);
        warnings.push(
          `${error instanceof AiProviderError ? error.message : "Perencanaan AI gagal."} Penelusuran memakai rujukan yang kamu tulis saja.`
        );
      }
    } else {
      plan = heuristicPlan(input.question);
    }

    for (const ref of plan.references) {
      if (input.signal?.aborted) break;
      const label = `${ref.regulation} ${ref.article}`;
      let raw: LegacyRecord;
      try {
        raw = await deps.adapters.inspectArticle({
          peraturan: ref.regulation,
          pasal: ref.article,
          sertakan_putusan_mk: false,
          maks_karakter: 4_000,
        });
      } catch (error) {
        attempted.push(`${label}: gagal dibuka (${error instanceof Error ? error.message.slice(0, 120) : "galat"}).`);
        continue;
      }
      const excerpts: LegacyRecord[] = Array.isArray(raw.pasal?.kutipan) ? raw.pasal.kutipan : [];
      const sourceUrl = text(raw.peraturan?.url_pdf) || text(raw.peraturan?.url);
      if (raw.ditemukan === false || !raw.peraturan) {
        attempted.push(`${label}: tidak ditemukan persis. ${text(raw.catatan)}`.trim());
        continue;
      }
      const retrievedAt = new Date().toISOString();
      const authority = text(raw.sumber) || "Sumber hukum resmi";
      const opened = excerpts
        .filter((excerpt) => text(excerpt.teks) && sourceUrl)
        .map((excerpt) =>
          createEvidence({
            documentId: `${raw.sumber === "JDIH Mahkamah Agung RI" ? "jdih-ma" : "bpk"}:${text(raw.peraturan?.id) || sourceUrl}`,
            text: text(excerpt.teks),
            locator: { article: ref.article, ...(excerpt.halaman ? { page: Number(excerpt.halaman) } : {}) },
            provenance: {
              sourceName: authority,
              sourceUrl,
              authority,
              retrievedAt,
              indexVersion: process.env.HUKUM_INDEX_VERSION || "legacy-live",
              verificationStatus: "verified_snapshot",
            },
          })
        );
      evidence.push(...opened);
      sources.push({
        kind: raw.sumber === "JDIH Mahkamah Agung RI" ? "ma-product" : "regulation",
        reference: label,
        title: text(raw.peraturan?.judul) || ref.regulation,
        authority,
        status: text(raw.peraturan?.status) || null,
        effectiveFrom: text(raw.peraturan?.tanggal_berlaku) || null,
        url: text(raw.peraturan?.url) || null,
        pdfUrl: text(raw.peraturan?.url_pdf) || null,
        amendedBy: relationNames(raw, "Diubah dengan"),
        revokedBy: relationNames(raw, "Dicabut dengan"),
        warnings: unique(Array.isArray(raw.peringatan) ? raw.peringatan : [], 6),
        evidenceIds: opened.map((item) => item.id),
      });
      attempted.push(
        opened.length
          ? `${label}: dibuka, ${opened.length} kutipan dari PDF resmi.`
          : `${label}: peraturannya ditemukan, tetapi frasa ${ref.article} tidak ditemukan persis di PDF-nya.`
      );
    }

    if (plan.shariaTopic && !input.signal?.aborted) {
      try {
        const raw = await deps.adapters.researchSharia({ akad: plan.shariaTopic });
        const main = raw.fatwa_utama as LegacyRecord | undefined;
        const pages: LegacyRecord[] = Array.isArray(raw.ketentuan_fatwa_utama?.isi) ? raw.ketentuan_fatwa_utama.isi : [];
        const pdfUrl = text(raw.ketentuan_fatwa_utama?.url_pdf) || text(main?.url_pdf);
        const viewUrl = text(raw.ketentuan_fatwa_utama?.url_tampilan) || text(main?.url_pdf);
        if (main && text(main.nomor)) {
          const retrievedAt = new Date().toISOString();
          const opened = pages
            .filter((page) => text(page.teks) && pdfUrl)
            .map((page) =>
              createEvidence({
                documentId: `dsn:${text(main.nomor)}`,
                text: text(page.teks),
                locator: { section: "Menetapkan", ...(page.halaman ? { page: Number(page.halaman) } : {}) },
                provenance: {
                  sourceName: "DSN-MUI",
                  sourceUrl: pdfUrl,
                  authority: "Dewan Syariah Nasional MUI",
                  retrievedAt,
                  indexVersion: process.env.HUKUM_INDEX_VERSION || "legacy-live",
                  verificationStatus: "verified_snapshot",
                },
              })
            );
          evidence.push(...opened);
          sources.push({
            kind: "fatwa",
            reference: `Fatwa ${text(main.nomor)}`,
            title: text(main.judul) || `Fatwa ${text(main.nomor)}`,
            authority: "Dewan Syariah Nasional MUI",
            status: null,
            effectiveFrom: null,
            url: viewUrl || null,
            pdfUrl: pdfUrl || null,
            amendedBy: [],
            revokedBy: [],
            warnings: unique(
              [
                text(raw.fatwa_dsn?.catatan),
                "Teks Arab pada PDF fatwa DSN dapat rusak karena font non-Unicode; jangan mengutip dalil dari kutipan ini.",
              ],
              3
            ),
            evidenceIds: opened.map((item) => item.id),
          });
          attempted.push(`Fatwa DSN untuk "${plan.shariaTopic}": ${text(main.nomor)} dibuka, ${opened.length} halaman ketentuan.`);
        } else {
          attempted.push(`Fatwa DSN untuk "${plan.shariaTopic}": tidak ada yang cocok.`);
        }
      } catch (error) {
        attempted.push(`Fatwa DSN untuk "${plan.shariaTopic}": gagal dibuka (${error instanceof Error ? error.message.slice(0, 120) : "galat"}).`);
      }
    }

    // Pencarian teks bebas hanya memakai kata kunci yang disusun perencana AI.
    // Tanpa AI, pertanyaan mentah tidak pernah dikirim ke situs sumber: isinya
    // bisa memuat hal pribadi, dan halaman hasil pencarian memantulkan kata
    // kuncinya lalu tersimpan di cache.
    let candidates: AskCandidate[] = [];
    if (evidence.length === 0 && plan.mode === "ai" && plan.searchQuery && !input.signal?.aborted) {
      try {
        const search = await deps.service.searchLegalSources({
          query: plan.searchQuery,
          sources: ["regulation"],
          pageSize: 6,
        });
        candidates = search.documents.map((doc) => ({
          title: doc.title,
          documentType: doc.documentType,
          number: doc.number,
          year: doc.year,
          status: doc.status,
          url: doc.canonicalUrl,
        }));
        attempted.push(`Pencarian peraturan "${plan.searchQuery.slice(0, 80)}": ${candidates.length} kandidat, belum dibuka.`);
        warnings.push(...search.warnings);
      } catch (error) {
        attempted.push(`Pencarian peraturan gagal (${error instanceof Error ? error.message.slice(0, 120) : "galat"}).`);
      }
    }

    for (const source of sources) {
      if (source.revokedBy.length || /tidak berlaku|dicabut/i.test(source.status ?? "")) {
        warnings.push(`${source.title} berstatus "${source.status ?? "dicabut"}". Jangan dipakai sebagai hukum yang berlaku tanpa memeriksa penggantinya.`);
      } else if (source.amendedBy.length) {
        warnings.push(`${source.title} pernah diubah (${source.amendedBy.join(", ")}). Kutipan berasal dari naskah asli; periksa perubahannya.`);
      }
    }

    let result: ResearchResult;
    let aiUsed = false;
    if (model && evidence.length > 0) {
      try {
        result = await synthesizeEvidenceFirst(
          { question: input.question, evidence, signal: input.signal },
          evidenceProviderFromModel(model)
        );
        aiUsed = true;
        result = { ...result, warnings: unique([...warnings, ...result.warnings], 20) };
      } catch (error) {
        warnings.push(
          `${error instanceof AiProviderError ? error.message : "Penjelasan AI gagal disusun."} Kutipan resmi tetap ditampilkan.`
        );
        result = verbatimResult(input.question, evidence, warnings);
      }
    } else {
      if (!model && evidence.length > 0) warnings.push("Penjelasan AI tidak aktif. Yang tampil adalah kutipan resmi apa adanya.");
      if (evidence.length === 0) {
        warnings.push(
          plan.mode === "heuristic"
            ? "Belum ada kutipan resmi yang dibuka. Sebut nomor peraturan dan pasalnya (mis. \"UU 27/2022 Pasal 46\"), atau aktifkan AI agar Pasla mengusulkan rujukan."
            : "Rujukan yang diusulkan tidak menghasilkan kutipan resmi. Pasla tidak menebak jawaban tanpa bukti."
        );
      }
      result = verbatimResult(input.question, evidence, warnings);
    }

    return {
      result,
      sources,
      candidates,
      plan,
      attempted,
      ai: model ? { provider: model.provider, model: model.model, used: aiUsed } : null,
      limits: deps.limits ?? [],
    };
  };
}

function verbatimResult(question: string, evidence: Evidence[], warnings: string[]): ResearchResult {
  return createResearchResult({
    query: question,
    evidence,
    claims: evidence.map((item) => ({ text: item.text, evidenceIds: [item.id] })),
    ...(evidence.length ? { summary: `Ditemukan ${evidence.length} kutipan resmi. Baca kutipan beserta sumbernya di bawah.` } : {}),
    warnings: unique(warnings, 20),
  });
}

export type AskFunction = ReturnType<typeof createAsk>;
