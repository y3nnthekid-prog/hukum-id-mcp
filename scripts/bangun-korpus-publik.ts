import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { importCorpusPdf } from "../src/indexing/import.js";

/**
 * Bangun korpus chat publik dari docs/korpus-publik-v1.json.
 * Hanya entri dengan impor.hasil "masuk" yang diimpor. Status dan relasi berasal dari manifest
 * yang diperiksa lewat JDIH BPK; skrip ini tidak menilai keberlakuan.
 * Pakai: npx tsx scripts/bangun-korpus-publik.ts [manifest] [--tulis]
 */
type Entri = {
  id: string; rujukan: string; judul: string; jenis: "peraturan" | "putusan-mk"; sourceUrl: string;
  sha256: string | null; berkas: string | null; retrievedAt: string | null; statusKorpus: string;
  amendedBy: string[]; revokedBy: string[]; anonim?: boolean; pasalPenutup?: string;
  impor: { hasil: string; jumlahPotongan?: number; kesehatanEkstraksi?: string; complete?: boolean; cakupanPasal?: unknown };
};
const args = process.argv.slice(2);
const manifestFile = args.find((arg) => !arg.startsWith("--")) ?? "docs/korpus-publik-v1.json";
const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as { dokumen: Entri[] };
const root = path.resolve(process.env.HUKUM_IMPORT_ROOT ?? path.join(os.homedir(), ".cache/hukum-id-mcp/korpus-publik-v1/pdf"));
const target = path.resolve(process.env.HUKUM_CORPUS_PATH ?? path.join(os.homedir(), ".cache/hukum-id-mcp/korpus-publik-v1.sqlite"));
if (path.basename(target) === "research.sqlite") throw new Error("Korpus publik tidak boleh menimpa research.sqlite.");
await mkdir(path.dirname(target), { recursive: true });

const corpus = new CorpusIndex(target);
try {
  for (const entri of manifest.dokumen.filter((item) => item.impor.hasil === "masuk")) {
    if (!entri.berkas || !entri.sha256 || !entri.retrievedAt) throw new Error(`${entri.id}: berkas, sha256 dan retrievedAt wajib untuk impor.`);
    const input = {
      id: entri.id, jenis: entri.jenis, judul: entri.judul, rujukan: entri.rujukan, sourceUrl: entri.sourceUrl,
      retrievedAt: entri.retrievedAt, importedBy: "korpus-publik-v1", file: entri.berkas, root, expectedHash: entri.sha256,
      status: entri.statusKorpus, diubahDengan: entri.amendedBy, dicabutDengan: entri.revokedBy,
      ...(entri.anonim ? { anonim: true } : {}),
    };
    let hasil = await importCorpusPdf({ ...input, complete: false }, corpus);
    // Lengkap hanya bila pasal batang tubuh berurutan dari Pasal 1 sampai pasal penutup yang
    // dicatat manifest dari naskahnya. Undang-undang perubahan tidak diberi pasalPenutup.
    const cakupan = articleCoverage(target, entri.id);
    if (entri.pasalPenutup && cakupan.berurutan && cakupan.terakhir === entri.pasalPenutup) hasil = await importCorpusPdf({ ...input, complete: true }, corpus);
    const meta = documentMeta(target, entri.id);
    entri.impor = { ...entri.impor, jumlahPotongan: hasil.jumlahPotongan, kesehatanEkstraksi: meta.extractionHealth?.status ?? "tidak tercatat", complete: meta.complete === true, cakupanPasal: cakupan };
    console.log(JSON.stringify({ id: entri.id, ...entri.impor }));
  }
} finally { corpus.close(); }
if (args.includes("--tulis")) await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");

function documentMeta(file: string, id: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return JSON.parse(String(db.prepare("SELECT metadata FROM documents WHERE id = ?").get(id)?.metadata)) as { complete?: boolean; extractionHealth?: { status: string } }; }
  finally { db.close(); }
}
function articleCoverage(file: string, id: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT json_extract(metadata, '$.passage.locator.pasal') AS pasal FROM passages WHERE document_id = ? AND json_extract(metadata, '$.passage.locator.bagian') = 'batang-tubuh' AND json_extract(metadata, '$.passage.locator.mengubah') IS NULL AND json_extract(metadata, '$.passage.locator.pasal') IS NOT NULL ORDER BY rowid").all(id);
    const numbers = rows.map((row) => String(row.pasal).replace(/^Pasal\s+/i, "")).filter((label) => /^\d+$/.test(label)).map(Number);
    const unik = [...new Set(numbers)];
    const berurutan = unik.length > 0 && unik.every((value, index) => value === index + 1);
    // Judul pasal yang rusak di lapisan teks membuat pasal itu menyatu dengan pasal sebelumnya.
    const ada = new Set(unik), tertinggi = Math.max(0, ...unik);
    const tidakTerpisah = Array.from({ length: tertinggi }, (_, index) => index + 1).filter((value) => !ada.has(value));
    return { jumlah: unik.length, berurutan, terakhir: unik.length ? `Pasal ${unik[unik.length - 1]}` : null, ...(tidakTerpisah.length && tidakTerpisah.length <= 10 ? { tidakTerpisah } : {}) };
  } finally { db.close(); }
}
