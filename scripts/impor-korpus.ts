import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CorpusManifest } from "../src/indexing/manifest.js";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { importCorpusPdf } from "../src/indexing/import.js";
const manifestFile = process.argv[2];
if (!manifestFile) throw new Error("Pakai: npx tsx scripts/impor-korpus.ts <manifest.json>");
const manifest = CorpusManifest.parse(JSON.parse(await readFile(manifestFile, "utf8")));
const target = path.resolve(process.env.HUKUM_CORPUS_PATH ?? ".cache/research.sqlite");
await mkdir(path.dirname(target), { recursive: true });
const corpus = new CorpusIndex(target);
try { console.log(JSON.stringify(await importCorpusPdf(manifest as Parameters<typeof importCorpusPdf>[0], corpus))); }
finally { corpus.close(); }
