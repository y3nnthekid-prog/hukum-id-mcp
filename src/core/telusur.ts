import { createHash } from "node:crypto";
import { normalizeRegulation } from "../ai/planner.js";
import { OTORITAS_SUMBER, RUMPUN, type JenisTelusur, type RumpunId } from "../rumpun/index.js";
import type { RujukanBuka } from "./sumber.js";

type Raw = Record<string, any>;
export type TelusurAdapters = Partial<Record<JenisTelusur, (query: string, limit: number) => Promise<Raw>>>;
export type Kandidat = {
  id: string; jenis: JenisTelusur; judul: string; url: string | null; cuplikan: string;
  otoritas: string; lapisan: string; status: string | null; verificationStatus: "metadata_only";
  rujukan: RujukanBuka | null; madzhab: string | null; teksPenuh: "perlu_dibuka" | "impor_manual";
};
export type InputTelusur = { rumpun: RumpunId; query: string; sumber?: JenisTelusur[] | undefined; limit?: number | undefined };
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
function publicLink(value: unknown) {
  try { const url = new URL(text(value)); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}
function reference(jenis: JenisTelusur, item: Raw): RujukanBuka | null {
  if (jenis === "khi" && /^Pasal \d{1,4}$/i.test(text(item.pasal))) return { jenis, pasal: item.pasal };
  if (jenis === "qanun" && /^Qanun(?: Aceh)? \d{1,3}\/\d{4}$/i.test(text(item.rujukan))) return { jenis, rujukan: item.rujukan, ...(item.pasal ? { pasal: item.pasal } : {}) };
  if (jenis === "putusan" && item.tersedia === true && /^[a-zA-Z0-9:._-]{1,120}$/.test(text(item.id))) return { jenis, id: item.id };
  if (jenis === "peraturan") {
    const rujukan = /^KUH\s*Perdata$/i.test(text(item.rujukan)) ? 'KUH Perdata' : normalizeRegulation(text(item.rujukan)) || normalizeRegulation(`${text(item.jenis)} ${text(item.nomor)}/${text(item.tahun)}`);
    return rujukan ? { jenis, rujukan, ...(/^Pasal\s+(?:\d{1,4}[A-Z]?|[IVX]{1,6})$/i.test(text(item.pasal)) ? { pasal: text(item.pasal) } : {}) } : null;
  }
  if (jenis === "fatwa" && /^\d{1,3}\/DSN-MUI\/[IVX]+\/\d{4}$/.test(text(item.nomor))) return { jenis, nomor: item.nomor };
  if (jenis === "khes" && /^Pasal \d{1,4}$/i.test(text(item.pasal))) return { jenis, pasal: item.pasal };
  if (jenis === "ayat") {
    const surah = Number(item.surah?.nomor ?? item.surah); const ayat = Number(item.ayat);
    if (surah >= 1 && surah <= 114 && ayat >= 1 && ayat <= 286) return { jenis, surah, ayat };
  }
  if (jenis === "hadis" && /^\d{1,8}$/.test(text(item.id))) return { jenis, id: text(item.id) };
  if (jenis === "turats") {
    if (Number.isSafeInteger(item.book_id) && item.book_id > 0 && item.book_id <= 10000000 && Number.isSafeInteger(item.page_id) && item.page_id >= 0 && item.page_id <= 1000000) return { jenis, bookId: item.book_id, pageId: item.page_id };
    if (text(item.cuplikan)) return { jenis, query: text(item.cuplikan).slice(0, 120), limit: 5 };
  }
  return null;
}
function candidate(jenis: JenisTelusur, item: Raw): Kandidat | null {
  const judul = text(item.judul || item.kitab || item.rujukan || item.nomor || item.title);
  if (!judul) return null;
  const url = publicLink(item.url || item.url_detail || item.doi || item.url_teks_penuh) ??
    (jenis === "turats" && Number.isSafeInteger(Number(item.book_id)) ? `https://app.turath.io/book/${item.book_id}` :
      jenis === "ayat" && item.surah?.nomor && item.ayat ? `https://quran.com/${Number(item.surah.nomor)}/${Number(item.ayat)}` : null);
  const ref = reference(jenis, item);
  return {
    id: `kt_${createHash("sha256").update(JSON.stringify([jenis, url, judul, ref])).digest("hex").slice(0, 24)}`,
    jenis, judul: judul.slice(0, 500), url, cuplikan: text(item.cuplikan || item.abstrak || item.terjemah || item.teks || item.konteks).slice(0, 600),
    lapisan: OTORITAS_SUMBER[jenis].lapisan, otoritas: OTORITAS_SUMBER[jenis].nama,
    status: text(item.status) || null, verificationStatus: "metadata_only", rujukan: ref,
    madzhab: text(item.madzhab) || null, teksPenuh: jenis === "putusan" && !item.tersedia ? "impor_manual" : "perlu_dibuka",
  };
}

export function createTelusur(adapters: TelusurAdapters) {
  return async (input: InputTelusur) => {
    const profil = RUMPUN[input.rumpun];
    const selected: JenisTelusur[] = [...new Set(input.sumber?.length ? input.sumber : profil.sumber)];
    const limit = Math.min(Math.max(input.limit ?? 24, 1), 50);
    const sumber: Array<{ jenis: JenisTelusur; status: "diperiksa" | "belum_tersedia" | "tidak_dapat_diperiksa"; alasan: string | null }> = [];
    const groups = await Promise.all(selected.map(async (jenis) => {
      try {
        const adapter = adapters[jenis];
        if (!adapter) { sumber.push({ jenis, status: "belum_tersedia", alasan: "Adapter atau korpus belum tersedia." }); return []; }
        const raw = await adapter(input.query, limit);
        if (raw.tersedia === false) { sumber.push({ jenis, status: "belum_tersedia", alasan: "Naskah belum diimpor." }); return []; }
        sumber.push({ jenis, status: "diperiksa", alasan: null });
        const items = Array.isArray(raw.hasil) ? raw.hasil : Array.isArray(raw.temuan) ? raw.temuan : [];
        return items.filter((x: unknown) => x !== null && typeof x === "object").slice(0, limit)
          .map((item: Raw) => candidate(jenis, item)).filter((x: Kandidat | null): x is Kandidat => x !== null);
      } catch {
        sumber.push({ jenis, status: "tidak_dapat_diperiksa", alasan: "Sumber gagal dibuka atau sedang membatasi akses otomatis." });
        return [];
      }
    }));
    const kandidat: Kandidat[] = []; const seen = new Set<string>();
    for (let row = 0; row < limit && kandidat.length < limit; row++) {
      for (const group of groups) {
        const item = group[row];
        if (item && !seen.has(item.id) && kandidat.length < limit) { seen.add(item.id); kandidat.push(item); }
      }
    }
    return { rumpun: input.rumpun, kueri: input.query, profil, kandidat, sumber: sumber.sort((a, b) => selected.indexOf(a.jenis) - selected.indexOf(b.jenis)), dicariPada: new Date().toISOString(), peringatan: ["Hasil telusur adalah kandidat. Buka teks sumber sebelum menyusun klaim.", ...profil.cakupan.alasan] };
  };
}
export type TelusurService = ReturnType<typeof createTelusur>;
