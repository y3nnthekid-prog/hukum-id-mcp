import { createHash } from "node:crypto";

/**
 * Potongan (passage): satuan bukti yang lebih kecil dari halaman PDF.
 *
 * Naskah peraturan dipecah per pasal, melintasi batas halaman bila pasalnya bersambung. Setiap
 * potongan menyimpan halaman awal dan akhir serta offset tiap halaman di dalam teksnya, sehingga
 * sebuah kutipan bisa ditunjuk sampai halaman yang tepat. Batang tubuh dibedakan dari Penjelasan:
 * "Pasal 7" di Penjelasan bukan norma, melainkan tafsir resmi pembentuk undang-undang.
 */

export type Page = { halaman: number; teks: string };

export type PassageLocator = {
  pasal?: string;
  bagian: "pembukaan" | "batang-tubuh" | "penjelasan" | "lampiran";
  halamanAwal: number;
  halamanAkhir: number;
  /**
   * Untuk undang-undang perubahan atau omnibus: peraturan yang pasalnya sedang diubah oleh
   * potongan ini, mis. "UU 21/2008" untuk "Pasal 26" di dalam UU 4/2023.
   */
  mengubah?: string;
};

export type Passage = {
  id: string;
  documentId: string;
  locator: PassageLocator;
  text: string;
  /** Offset awal setiap halaman di dalam `text`, urut naik. */
  pageStarts: Array<{ halaman: number; offset: number }>;
  contentHash: string;
};

// Judul pasal berdiri sendiri pada satu baris. Toleran terhadap salah baca OCR yang sudah terlihat
// di naskah resmi ("Pasai 624", "Pasal 1O"), dan menerima pasal Romawi undang-undang perubahan
// ("Pasal I" memuat perubahan, "Pasal II" ketentuan penutup). Lapisan teks resmi kadang menghapus
// spasinya ("Pasal222" pada UU 7/2017).
const ARTICLE_HEADING = /^[ \t]*Pasa[li][ \t]*(\d(?:[ \t]*[\dOl]){0,3}(?:[ \t]*[A-Z])?|[IVX]{1,6})[ \t]*$/gm;
// Varian OCR ini terlihat pada salinan resmi UU27/2022. Tetap hanya judul satu baris;
// teks sumber tidak diperbaiki atau diganti oleh pengenalan batas bagian.
const EXPLANATION_HEADING = /^[ \t]*(?:PENJELASAN|PENJEI,ASAN)[ \t]*$/gm;
const ATTACHMENT_HEADING = /^[ \t]*LAMPIRAN\b/gm;

/**
 * Posisi judul bagian yang baru dihitung SESUDAH pasal pertama. Naskah yang memang berupa lampiran
 * (KHES dan KHI dibuka dengan "LAMPIRAN") atau yang punya daftar isi berjudul "PENJELASAN" tidak
 * boleh membuat seluruh pasalnya terbaca sebagai lampiran atau penjelasan.
 */
function headingAfter(text: string, pattern: RegExp, from: number) {
  for (const match of text.matchAll(pattern)) if (match.index > from) return match.index;
  return -1;
}

export function contentHash(text: string) {
  return createHash("sha256").update(text.normalize("NFC")).digest("hex");
}

function passageId(documentId: string, locator: PassageLocator, hash: string, offset: number) {
  const identity = JSON.stringify({
    documentId,
    bagian: locator.bagian,
    pasal: locator.pasal ?? null,
    mengubah: locator.mengubah ?? null,
    hash,
    // Judul dan isi yang identik dapat berulang, bahkan pada halaman yang sama.
    offset,
  });
  return `ps_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

type Mark = { offset: number; pasal?: string; bagian: PassageLocator["bagian"]; mengubah?: string };

// "Beberapa ketentuan dalam Undang-Undang Nomor 21 Tahun 2008 ... diubah". Lapisan OCR kerap
// membaca angka 1 sebagai "l" dan 0 sebagai "O", jadi nomor dan tahun dinormalkan.
const AMENDMENT_INTRO =
  /(?:Beberapa\s+ketentuan|Ketentuan)\s+dalam\s+(Undang\s*-\s*Undang|Peraturan\s+Pemerintah\s+Pengganti\s+Undang\s*-\s*Undang|Peraturan\s+Pemerintah)\s+Nomor\s+([0-9lIO]{1,4})\s+Tahun\s+([0-9lIO]{4})/g;
const CONTEXT_RESET = /^[ \t]*(?:BAB|Bagian)\s+[A-Z][\w ]*$/gm;

function ocrDigits(value: string) {
  return value.replace(/[lI]/g, "1").replace(/O/g, "0");
}

function amendedName(kind: string) {
  if (/Pengganti/i.test(kind)) return "Perppu";
  if (/Pemerintah/i.test(kind)) return "PP";
  return "UU";
}

/**
 * Pecah halaman-halaman sebuah naskah menjadi potongan per pasal.
 *
 * Judul pasal dikenali hanya bila berdiri sendiri pada satu baris ("Pasal 7"), sehingga rujukan
 * silang di tengah kalimat tidak memotong potongan. Nomor pasal yang mundur atau berulang di
 * batang tubuh (misalnya pasal yang dikutip di dalam pasal perubahan "Ketentuan Pasal 26 diubah")
 * tetap dipotong, tetapi tidak pernah menimpa locator pasal lain karena id memuat sidik isinya.
 */
export function segmentPages(documentId: string, pages: Page[]): Passage[] {
  let text = "";
  const pageStarts: Array<{ halaman: number; offset: number }> = [];
  for (const page of pages) {
    if (text) text += "\n";
    pageStarts.push({ halaman: page.halaman, offset: text.length });
    text += page.teks;
  }
  if (!text.trim()) return [];

  const firstArticle = text.search(new RegExp(ARTICLE_HEADING.source, "m"));
  const explanationAt = firstArticle === -1 ? -1 : headingAfter(text, EXPLANATION_HEADING, firstArticle);
  const attachmentAt = firstArticle === -1 ? -1 : headingAfter(text, ATTACHMENT_HEADING, firstArticle);
  const sectionAt = (offset: number): PassageLocator["bagian"] => {
    if (attachmentAt !== -1 && offset >= attachmentAt && (explanationAt === -1 || attachmentAt > explanationAt || offset < explanationAt)) {
      return "lampiran";
    }
    if (explanationAt !== -1 && offset >= explanationAt) return "penjelasan";
    return "batang-tubuh";
  };

  const contexts: Array<{ offset: number; target: string | null }> = [];
  for (const match of text.matchAll(AMENDMENT_INTRO)) {
    contexts.push({
      offset: match.index,
      target: `${amendedName(match[1]!)} ${Number(ocrDigits(match[2]!))}/${ocrDigits(match[3]!)}`,
    });
  }
  for (const match of text.matchAll(CONTEXT_RESET)) contexts.push({ offset: match.index, target: null });
  // Pasal Romawi undang-undang perubahan ("Pasal II") menutup blok perubahan sebelumnya.
  for (const match of text.matchAll(ARTICLE_HEADING)) {
    if (/^[IVX]+$/.test(match[1]!)) contexts.push({ offset: match.index, target: null });
  }
  contexts.sort((a, b) => a.offset - b.offset);
  const amendedAt = (offset: number) => {
    let target: string | null = null;
    for (const context of contexts) {
      if (context.offset > offset) break;
      target = context.target;
    }
    return target;
  };

  const marks: Mark[] = [{ offset: 0, bagian: "pembukaan" }];
  for (const match of text.matchAll(ARTICLE_HEADING)) {
    const roman = /^[IVX]+$/.test(match[1]!);
    const bagian = sectionAt(match.index);
    const target = bagian === "batang-tubuh" && !roman ? amendedAt(match.index) : null;
    marks.push({
      offset: match.index,
      pasal: `Pasal ${roman ? match[1]! : ocrDigits(match[1]!).replace(/[ \t]/g, "").toUpperCase()}`,
      bagian,
      ...(target ? { mengubah: target } : {}),
    });
  }
  if (explanationAt !== -1) marks.push({ offset: explanationAt, bagian: "penjelasan" });
  if (attachmentAt !== -1) marks.push({ offset: attachmentAt, bagian: "lampiran" });
  marks.sort((a, b) => a.offset - b.offset || (a.pasal ? 1 : -1));

  const passages: Passage[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]!;
    const end = marks[i + 1]?.offset ?? text.length;
    const raw = text.slice(mark.offset, end);
    if (!raw.trim()) continue;
    const local = pageStarts
      .filter((page, index) => {
        const pageEnd = pageStarts[index + 1]?.offset ?? text.length;
        return pageEnd > mark.offset && page.offset < end;
      })
      .map((page) => ({ halaman: page.halaman, offset: Math.max(0, page.offset - mark.offset) }));
    const locator: PassageLocator = {
      ...(mark.pasal ? { pasal: mark.pasal } : {}),
      ...(mark.mengubah ? { mengubah: mark.mengubah } : {}),
      bagian: mark.bagian,
      halamanAwal: local[0]!.halaman,
      halamanAkhir: local[local.length - 1]!.halaman,
    };
    const hash = contentHash(raw);
    passages.push({ id: passageId(documentId, locator, hash, mark.offset), documentId, locator, text: raw, pageStarts: local, contentHash: hash });
  }
  return passages;
}

/** Halaman tempat sebuah offset di dalam potongan berada. */
export function pageAt(passage: Passage, offset: number) {
  let page = passage.pageStarts[0]!.halaman;
  for (const start of passage.pageStarts) {
    if (start.offset <= offset) page = start.halaman;
    else break;
  }
  return page;
}

/** Ayat terdekat sebelum offset, mis. "(2)", bila pasalnya berayat. OCR kerap membaca ")" sebagai "t". */
export function ayatAt(passage: Passage, offset: number) {
  let found: string | null = null;
  for (const match of passage.text.slice(0, offset + 1).matchAll(/^[ \t]*\((\d{1,3}[a-z]?)[)t]/gm)) found = match[1]!;
  return found;
}

/**
 * Potongan batang tubuh untuk satu pasal; Penjelasan pasal itu dikembalikan terpisah. Pasal yang
 * dikutip di dalam blok perubahan peraturan lain tidak pernah dianggap pasal naskah ini, kecuali
 * `mengubah` diminta secara eksplisit (untuk menelusuri perubahan peraturan lain).
 */
export function findArticle(passages: Passage[], pasal: string, mengubah?: string) {
  const want = pasal.replace(/\s+/g, " ").trim().toLowerCase();
  const target = mengubah?.toLowerCase();
  const matches = passages.filter(
    (passage) =>
      passage.locator.pasal?.toLowerCase() === want && passage.locator.mengubah?.toLowerCase() === target
  );
  return {
    norma: matches.filter((passage) => passage.locator.bagian === "batang-tubuh"),
    penjelasan: matches.filter((passage) => passage.locator.bagian === "penjelasan"),
  };
}
