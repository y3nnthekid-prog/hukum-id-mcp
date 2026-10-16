import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolveSafeImportPath } from "../khes.js";
import { halamanPdf, PDF_LIMITS } from "../pdf.js";
import { type CorpusMeta, CorpusIndex } from "./corpus.js";
import type { Page } from "../core/passages.js";

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
  const buku = pages.flatMap((page) => [...page.teks.matchAll(/\bBUKU\s+(III|II|I)\b/g)].map((match) => ({ buku: match[1]!, halaman: page.halaman })));
  if (input.jenis === "khi" && new Set(buku.map((b) => b.buku)).size !== 3) throw new Error("Buku I-III KHI belum terbaca lengkap.");
  const { file: _file, root: _root, expectedHash: _hash, ...meta } = input;
  const extractionHealth = extracted.extraction_health;
  return corpus.replace({ ...meta, fileHash, buku, extractionHealth, complete: input.complete === true && extractionHealth?.status === "ok" }, pages);
}
