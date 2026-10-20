import { canonicalize, findQuote } from "./canonical.js";

/**
 * Validator kalimat sintesis.
 *
 * Kutipan yang persis ada di sumber hanya membuktikan kutipannya ada, belum membuktikan kalimat
 * yang ditulis di atasnya setia. Karena itu setiap kalimat diperiksa terhadap kutipannya sendiri:
 * negasi dan modalitas harus sejalan, setiap angka dan rujukan hukum dalam kalimat harus muncul di
 * kutipan (atau menjadi identitas sumbernya sendiri), dan sebagian besar kata isinya harus berasal
 * dari kutipan. Lapisan otoritas yang diklaim kalimat juga harus cocok dengan jenis sumbernya.
 *
 * Setiap penolakan memakai kode alasan yang tetap, supaya bisa ditampilkan dan diaudit di Metode.
 */

export type Lapisan = "norma" | "tafsir-resmi" | "praktik" | "pedoman" | "dalil" | "fikih-doktrin";

export type JenisSumber =
  | "peraturan"
  | "qanun"
  | "putusan-mk"
  | "putusan-ma"
  | "khi"
  | "khes"
  | "fatwa"
  | "ayat"
  | "hadis"
  | "turats"
  | "literatur";

export type SumberKalimat = {
  jenis: JenisSumber;
  /** "batang-tubuh" | "penjelasan" | ... untuk peraturan; dipakai memisahkan norma dari tafsir. */
  bagian?: string;
  /** Identitas yang boleh disebut kalimat tanpa harus ada di kutipan, mis. ["UU 1/1974", "Pasal 7"]. */
  identitas: string[];
  text: string;
};

export type AlasanTolak =
  | "KUTIPAN_TIDAK_ADA"
  | "KUTIPAN_TERLALU_PENDEK"
  | "NEGASI_BERBEDA"
  | "MODALITAS_TIDAK_DIDUKUNG"
  | "ANGKA_TIDAK_DIDUKUNG"
  | "RUJUKAN_TIDAK_DIDUKUNG"
  | "KATA_TIDAK_DIDUKUNG"
  | "LAPISAN_TIDAK_SESUAI";

export type HasilValidasi =
  | { ok: true; start: number; end: number }
  | { ok: false; alasan: AlasanTolak; rincian: string };

const MIN_QUOTE_WORDS = 8;
const MIN_CONTENT_OVERLAP = 0.6;

/** Lapisan yang sah untuk tiap jenis sumber. Fatwa dan KHI tidak pernah menjadi "norma". */
export function lapisanSah(sumber: Pick<SumberKalimat, "jenis" | "bagian">): Lapisan[] {
  switch (sumber.jenis) {
    case "peraturan":
    case "qanun":
      return sumber.bagian === "penjelasan" ? ["tafsir-resmi"] : ["norma"];
    case "putusan-mk":
      return ["tafsir-resmi"];
    case "putusan-ma":
      return ["praktik"];
    case "khi":
    case "khes":
    case "fatwa":
      return ["pedoman"];
    case "ayat":
    case "hadis":
      return ["dalil"];
    case "turats":
    case "literatur":
      return ["fikih-doktrin"];
  }
}

const NEGATION = new Set(["tidak", "bukan", "belum", "tanpa", "jangan", "tak"]);
const MODALITY: Array<Set<string>> = [
  new Set(["wajib", "diwajibkan", "mewajibkan", "harus", "keharusan", "kewajiban"]),
  new Set(["dilarang", "melarang", "larangan", "haram", "diharamkan"]),
  new Set(["boleh", "dapat", "dibolehkan", "diperbolehkan", "berhak", "mubah", "halal"]),
  new Set(["batal", "dibatalkan", "tidak sah"]),
  new Set(["sah", "keabsahan"]),
  new Set(["dicabut", "mencabut", "tidak berlaku"]),
  new Set(["sunnah", "dianjurkan", "mustahab"]),
  new Set(["makruh"]),
];
const STOP = new Set([
  "adalah", "akan", "atas", "atau", "bagi", "bahwa", "dalam", "dan", "dari", "dengan", "di", "hal", "harus",
  "ini", "itu", "jika", "juga", "ke", "kepada", "maka", "menurut", "merupakan", "oleh", "pada", "para", "sebagai",
  "sebagaimana", "secara", "serta", "suatu", "tersebut", "untuk", "yaitu", "yakni", "yang", "telah", "dapat",
  "ditetapkan", "diatur", "mengatur", "menetapkan", "menyatakan", "disebutkan", "ketentuan", "berdasarkan",
  "sesuai", "setiap", "seorang", "sebuah", "ia", "mereka", "tersebut",
]);

// Dicocokkan pada teks KANONIK: tanda hubung di antara huruf sudah dibuang ("DSN-MUI" menjadi
// "dsnmui", "Undang-Undang" menjadi "undangundang").
const REFERENCE =
  /\b(?:pasal\s+\d{1,4}[a-z]?|ayat\s+\(\d{1,3}\)|(?:uu|undangundang|pp|peraturan pemerintah|perpres|perppu|perpu|pojk|seojk|pbi|perma|sema|qanun(?:\s+aceh)?)\s+(?:nomor\s+)?\d{1,4}\s*(?:\/|\s+tahun\s+)\s*\d{4}|\d{1,4}\/puu-?[ivxl]+\/\d{4}|\d{1,3}\/dsn-?mui\/[ivx]+\/\d{4})/giu;

function words(text: string) {
  return canonicalize(text).text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normRef(value: string) {
  return canonicalize(value)
    .text.replace(/\bnomor\s+/g, "")
    .replace(/\s+tahun\s+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/qanun aceh/g, "qanun")
    .replace(/^undangundang\b/, "uu")
    .replace(/^peraturan pemerintah\b/, "pp")
    .trim();
}

function modalityGroups(text: string) {
  const canonical = ` ${canonicalize(text).text} `;
  const tokens = new Set(words(text));
  return MODALITY.map((group, index) =>
    [...group].some((word) => (word.includes(" ") ? canonical.includes(` ${word} `) : tokens.has(word))) ? index : -1
  ).filter((index) => index >= 0);
}

export function validateSentence(input: {
  kalimat: string;
  kutipan: string;
  lapisan: Lapisan;
  sumber: SumberKalimat;
}): HasilValidasi {
  const { kalimat, kutipan, lapisan, sumber } = input;

  if (!lapisanSah(sumber).includes(lapisan)) {
    return {
      ok: false,
      alasan: "LAPISAN_TIDAK_SESUAI",
      rincian: `Sumber jenis ${sumber.jenis}${sumber.bagian ? ` (${sumber.bagian})` : ""} tidak bisa menjadi dasar lapisan "${lapisan}".`,
    };
  }

  const match = findQuote(sumber.text, kutipan);
  if (!match) return { ok: false, alasan: "KUTIPAN_TIDAK_ADA", rincian: "Kutipan tidak ada persis di potongan sumber." };

  const quoteWords = words(kutipan);
  const sourceWords = words(sumber.text);
  if (quoteWords.length < MIN_QUOTE_WORDS && quoteWords.length < sourceWords.length * 0.9) {
    return { ok: false, alasan: "KUTIPAN_TERLALU_PENDEK", rincian: `Kutipan ${quoteWords.length} kata; minimal ${MIN_QUOTE_WORDS}.` };
  }

  const sentenceWords = words(kalimat);
  const quoteSet = new Set(quoteWords);
  const sentenceNegated = sentenceWords.some((word) => NEGATION.has(word));
  const quoteNegated = quoteWords.some((word) => NEGATION.has(word));
  if (sentenceNegated !== quoteNegated) {
    return { ok: false, alasan: "NEGASI_BERBEDA", rincian: "Kalimat dan kutipan tidak sama-sama menyangkal atau sama-sama tidak." };
  }

  const quoteModality = new Set(modalityGroups(kutipan));
  const unsupportedModality = modalityGroups(kalimat).filter((group) => !quoteModality.has(group));
  if (unsupportedModality.length) {
    return { ok: false, alasan: "MODALITAS_TIDAK_DIDUKUNG", rincian: "Kalimat memuat kewajiban, larangan, atau kebolehan yang tidak ada di kutipan." };
  }

  const identity = sumber.identitas.map(normRef);
  const quoteRefs = new Set([...canonicalize(kutipan).text.matchAll(REFERENCE)].map((m) => normRef(m[0])));
  const sentenceRefs = [...canonicalize(kalimat).text.matchAll(REFERENCE)].map((m) => normRef(m[0]));
  const strayRef = sentenceRefs.find((ref) => !quoteRefs.has(ref) && !identity.includes(ref));
  if (strayRef) {
    return { ok: false, alasan: "RUJUKAN_TIDAK_DIDUKUNG", rincian: `Rujukan "${strayRef}" tidak ada di kutipan maupun identitas sumbernya.` };
  }

  const identityWords = new Set(identity.flatMap((value) => value.match(/[\p{L}\p{N}]+/gu) ?? []));
  const refWords = new Set(sentenceRefs.flatMap((value) => value.match(/[\p{L}\p{N}]+/gu) ?? []));
  const strayNumber = sentenceWords.find(
    // Angka identitas sumber (mis. "16" dari "UU 16/2019") hanya sah bila kalimat menyebutnya
    // sebagai rujukan; angka lepas seperti "umur 16 tahun" harus ada di kutipan.
    (word) => /^\d+$/.test(word) && !quoteSet.has(word) && !refWords.has(word)
  );
  if (strayNumber) {
    return { ok: false, alasan: "ANGKA_TIDAK_DIDUKUNG", rincian: `Angka ${strayNumber} tidak ada di kutipan.` };
  }

  const content = sentenceWords.filter(
    (word) => word.length > 2 && !STOP.has(word) && !identityWords.has(word) && !refWords.has(word) && !/^\d+$/.test(word)
  );
  if (content.length) {
    const supported = content.filter((word) => quoteSet.has(word) || [...quoteSet].some((q) => q.length > 4 && (q.startsWith(word) || word.startsWith(q))));
    const overlap = supported.length / content.length;
    if (overlap < MIN_CONTENT_OVERLAP) {
      return {
        ok: false,
        alasan: "KATA_TIDAK_DIDUKUNG",
        rincian: `Hanya ${Math.round(overlap * 100)}% kata isi kalimat berasal dari kutipan; minimal ${MIN_CONTENT_OVERLAP * 100}%.`,
      };
    }
  }

  return { ok: true, start: match.start, end: match.end };
}

/**
 * Analisis tidak boleh mendapat kebebasan menambah kesimpulan hanya karena ID rujukannya sah.
 * Tanpa pemeriksa semantik, terima hanya perangkaian utuh kutipan yang sudah lolos; bukan
 * gabungan kosakata semua sumber, yang dapat memindahkan kewajiban/negasi ke subjek lain.
 * Ini pemeriksaan konservatif atas dukungan teks, bukan pembuktian kebenaran penafsiran.
 */
export function validateAnalysis(input: { kalimat: string; merujuk: string[]; lolos: Set<string>; bukti?: ReadonlyMap<string, string> }): HasilValidasi {
  if (!input.merujuk.length || !input.merujuk.every((id) => input.lolos.has(id))) {
    return { ok: false, alasan: "RUJUKAN_TIDAK_DIDUKUNG", rincian: "Analisis harus merujuk kalimat bersumber yang sudah lolos validasi." };
  }
  const ref = canonicalize(input.kalimat).text.match(REFERENCE);
  if (ref) return { ok: false, alasan: "RUJUKAN_TIDAK_DIDUKUNG", rincian: `Analisis tidak boleh memperkenalkan rujukan "${ref[0]}".` };
  // Jangan memakai canonicalize(): penghapus header PDF dapat menghapus nama pelaku.
  const normalize = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "").trim();
  const evidence = input.merujuk.map((id) => input.bukti?.get(id));
  if (evidence.some((text) => !text)) return { ok: false, alasan: "RUJUKAN_TIDAK_DIDUKUNG", rincian: "Teks bukti analisis tidak tersedia; ID rujukan saja tidak cukup." };
  // Titik koma adalah satu-satunya pemisah perangkaian. Jangan memecah titik desimal,
  // singkatan, atau syarat di dalam kutipan lalu menganggap potongannya kalimat lengkap.
  const quotes = evidence.map((text) => normalize(text!));
  // Cocokkan kutipan utuh dahulu, sehingga titik koma asli di dalam bukti tidak terpotong.
  const pending = [normalize(input.kalimat)];
  const visited = new Set<string>();
  let supported = false;
  while (pending.length) {
    const rest = pending.pop()!;
    if (visited.has(rest)) continue;
    visited.add(rest);
    if (quotes.includes(rest) && rest) { supported = true; break; }
    for (const quote of quotes) {
      if (quote && rest.startsWith(`${quote};`)) pending.push(rest.slice(quote.length + 1).trim());
    }
  }
  if (!supported) {
    return { ok: false, alasan: "KATA_TIDAK_DIDUKUNG", rincian: "Analisis menambah atau mengubah isi kutipan yang dirujuk. Periksa hubungan, syarat, angka, kewajiban, dan negasinya pada sumber." };
  }
  return { ok: true, start: 0, end: 0 };
}
