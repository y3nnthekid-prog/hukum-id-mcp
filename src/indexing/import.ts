import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolveSafeImportPath } from "../khes.js";
import { halamanPdf, PDF_LIMITS } from "../pdf.js";
import { type CorpusMeta, CorpusIndex } from "./corpus.js";
import { segmentPages, type Page } from "../core/passages.js";

/** Strict body-only audit; contents pages require manual curation. No legal attestation. */
export function inspectKhiBooks(pages: Page[]) {
  const text = pages.map(page => page.teks).join("\n");
  if (/^[ \t]*DAFTAR[ \t]+ISI\b/im.test(text)) throw new Error("KHI_CONTENTS_REVIEW: naskah dengan daftar isi memerlukan kurasi manual sebelum impor.");
  const explanation = text.search(/^[ \t]*PENJELASAN\b[^\n]*$/im);
  const body = explanation < 0 ? text : text.slice(0, explanation);
  const articles = segmentPages("khi-audit", [{ halaman: 1, teks: body }]).filter(passage => passage.locator.bagian === "batang-tubuh" && passage.locator.pasal);
  const hasBodyText = (raw: string) => {
    // Segment tails can include the next book/chapter heading; it is not article prose.
    const content = raw.replace(/^[^\n]*(?:\n|$)/, "").split(/^[ \t]*(?:BUKU[ \t]+[IVX]+|BAB[ \t]+[IVX]+|Bagian[ \t]+Ke[a-z]+)[ \t]*$/m)[0] ?? "";
    return /\p{L}/u.test(content);
  };
  if (articles.length !== 229 || articles.some((passage, index) => passage.locator.pasal !== `Pasal ${index + 1}` || !hasBodyText(passage.text))) throw new Error("KHI_ARTICLE_COVERAGE: urutan pasal 1-229 belum lengkap, kosong atau berulang.");
  let offset = 0;
  const books = pages.flatMap(page => {
    const matches = [...page.teks.matchAll(/^[ \t]*BUKU[ \t]+(III|II|I)[ \t]*$/gm)].map(match => ({ buku: match[1]!, halaman: page.halaman, offset: offset + match.index, end: offset + match.index + match[0].length }));
    offset += page.teks.length + 1;
    return matches;
  }).filter(book => book.offset < body.length);
  const expected = [{ buku: "I", first: "1", title: /HUKUM\s+PERKAWINAN/ }, { buku: "II", first: "171", title: /HUKUM\s+KEWARISAN/ }, { buku: "III", first: "215", title: /HUKUM\s+PERWAKAFAN/ }];
  if (books.length !== 3 || books.some((book, index) => {
    const want = expected[index]!;
    const remainder = body.slice(book.end);
    const next = segmentPages("khi-book-audit", [{ halaman: book.halaman, teks: remainder }]).find(passage => passage.locator.pasal);
    return book.buku !== want.buku || next?.locator.pasal !== `Pasal ${want.first}` || !want.title.test(remainder.slice(0, next ? remainder.indexOf(next.text) : 0));
  })) throw new Error("KHI_BOOK_BOUNDARY: batas Buku I-III belum cocok dengan pasal 1/171/215.");
  return books.map(({ buku, halaman }) => ({ buku, halaman }));
}

export async function importCorpusPdf(input: Omit<CorpusMeta, "fileHash" | "buku"> & { file: string; root?: string; expectedHash?: string }, corpus: CorpusIndex) {
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || !/(?:^|\.)go\.id$/.test(url.hostname) || url.username || url.password) throw new Error("Sumber impor harus URL resmi pemerintah melalui HTTPS.");
  if (/^putusan-/.test(input.jenis) && !input.anonim) throw new Error("Impor putusan mensyaratkan salinan yang diperiksa anonimisasi oleh pengimpor.");
  const filename = await resolveSafeImportPath(input.file, { root: input.root ?? process.env.HUKUM_IMPORT_ROOT ?? process.cwd() });
  if ((await stat(filename)).size > PDF_LIMITS.maxBytes) throw new Error("PDF_BYTE_LIMIT");
  const bytes = await readFile(filename);
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Berkas bukan PDF.");
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedHash && fileHash !== input.expectedHash) throw new Error("Sidik berkas berbeda dari manifest impor.");
  const extracted = await halamanPdf({ buffer: bytes } as any);
  const pages = extracted.halaman as Page[];
  if (extracted.extraction_health?.status === "no_text_layer") throw new Error("PDF memerlukan OCR dan pemeriksaan manusia sebelum impor.");
  const all = pages.map((p) => p.teks).join("\n");
  const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (input.jenis === "khi" && !/kompilasi\s+hukum\s+islam/i.test(all)) throw new Error("Judul KHI tidak ditemukan di naskah.");
  if (/^putusan-/.test(input.jenis) && !compact(all).includes(compact(input.rujukan))) throw new Error("Nomor putusan tidak cocok dengan naskah.");
  const buku = input.jenis === "khi" ? inspectKhiBooks(pages) : pages.flatMap((page) => [...page.teks.matchAll(/\bBUKU\s+(III|II|I)\b/g)].map((match) => ({ buku: match[1]!, halaman: page.halaman })));
  const { file: _file, root: _root, expectedHash: _hash, ...meta } = input;
  const extractionHealth = extracted.extraction_health;
  return corpus.replace({ ...meta, fileHash, buku, extractionHealth, complete: input.complete === true && extractionHealth?.status === "ok" }, pages);
}
