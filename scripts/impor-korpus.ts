import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { importCorpusPdf } from "../src/indexing/import.js";
const Manifest = z.object({ id: z.string().min(1).max(100), jenis: z.enum(["khi", "khes", "qanun", "peraturan", "putusan-mk", "putusan-ma"]), judul: z.string().min(4).max(500), rujukan: z.string().min(2).max(120), sourceUrl: z.url(), retrievedAt: z.iso.datetime(), importedBy: z.string().min(1).max(100), file: z.string().min(1), anonim: z.boolean().optional(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const manifestFile = process.argv[2];
if (!manifestFile) throw new Error("Pakai: npx tsx scripts/impor-korpus.ts <manifest.json>");
const manifest = Manifest.parse(JSON.parse(await readFile(manifestFile, "utf8")));
const target = path.resolve(process.env.HUKUM_CORPUS_PATH ?? ".cache/research.sqlite");
await mkdir(path.dirname(target), { recursive: true });
const corpus = new CorpusIndex(target);
try { console.log(JSON.stringify(await importCorpusPdf(manifest as Parameters<typeof importCorpusPdf>[0], corpus))); }
finally { corpus.close(); }
