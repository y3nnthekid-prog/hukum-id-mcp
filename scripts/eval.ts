/**
 * Harness evaluasi enam rumpun.
 *
 *   npx tsx scripts/eval.ts --api http://127.0.0.1:3001 [--rumpun hes] [--putaran 3] [--tertahan]
 *
 * Kunci AI (opsional) dibaca dari EVAL_AI_PROVIDER, EVAL_AI_MODEL, dan EVAL_AI_KEY. Nilainya hanya
 * dikirim sebagai header ke server yang diuji; laporan hanya mencatat penyedia dan modelnya.
 *
 * Supaya hasilnya bisa diulang, jalankan server yang diuji dengan snapshot beku:
 *   HUKUM_CACHE_DIR=<folder snapshot> HUKUM_CACHE_BEKU=1 HUKUM_LURING=1 npm run start:api
 * Putaran pertama untuk merekam snapshot dijalankan tanpa HUKUM_LURING.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeRegulation } from "../src/ai/planner.js";
import { BerkasSetSchema, type Butir, type Rujukan } from "../eval/skema.js";

type Source = {
  kind: string;
  reference: string;
  status: string | null;
  revokedBy?: string[];
  evidenceIds?: string[];
};
type AskData = {
  result: { status: string; claims: unknown[]; evidence: unknown[] };
  sources: Source[];
  attempted: string[];
  plan: { mode: string };
};

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i]!;
  if (!key.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args.set(key.slice(2), next && !next.startsWith("--") ? (i += 1, next) : "1");
}

const API = args.get("api") ?? "http://127.0.0.1:3001";
const ONLY = args.get("rumpun");
const RUNS = Math.max(1, Math.min(5, Number(args.get("putaran") ?? 1)));
const WITH_HELD_OUT = args.has("tertahan");
const ROOT = path.resolve(import.meta.dirname, "..", "eval");

function wilson(passed: number, total: number) {
  if (total === 0) return { rendah: 0, tinggi: 0 };
  const z = 1.96;
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { rendah: Math.max(0, (centre - margin) / denom), tinggi: Math.min(1, (centre + margin) / denom) };
}

function regulationKey(value: string) {
  return (normalizeRegulation(value) ?? value).toLowerCase().replace(/\s+/g, " ");
}

function sourceFor(ref: Rujukan, sources: Source[]): Source | undefined {
  if (ref.jenis === "peraturan" || ref.jenis === "qanun") {
    const key = regulationKey(ref.rujukan);
    return sources.find((source) => {
      const label = source.reference.toLowerCase();
      if (!label.startsWith(key)) return false;
      return ref.pasal ? new RegExp(`\\b${ref.pasal.toLowerCase()}(?![0-9a-z])`).test(label) : true;
    });
  }
  if (ref.jenis === "fatwa") {
    return sources.find((source) => source.kind === "fatwa" && source.reference.includes(ref.nomor));
  }
  // Ayat, hadis, turats, KHES/KHI, putusan, dan literatur belum dibuka oleh /v1/ask. Butir
  // semacam ini sengaja dihitung terlewat: angkanya menjadi garis dasar untuk API v2.
  return undefined;
}

function opened(source: Source | undefined) {
  return Boolean(source && (source.evidenceIds?.length ?? 0) > 0);
}

function statusMatches(expected: string, actual: string | null) {
  if (!actual) return false;
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const revoked = (value: string) => /tidak berlaku|dicabut/.test(norm(value));
  return revoked(expected) === revoked(actual);
}

async function ask(question: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const provider = process.env.EVAL_AI_PROVIDER;
  const key = process.env.EVAL_AI_KEY;
  if (provider && key) {
    headers["x-pasla-ai-provider"] = provider;
    headers["x-pasla-ai-key"] = key;
    if (process.env.EVAL_AI_MODEL) headers["x-pasla-ai-model"] = process.env.EVAL_AI_MODEL;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${API}/v1/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question, useAi: Boolean(provider && key) }),
    });
    if (response.status === 503 || response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 20);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    const body = (await response.json()) as { data?: AskData; error?: { code: string } };
    if (!response.ok || !body.data) throw new Error(`HTTP ${response.status} ${body.error?.code ?? ""}`.trim());
    return body.data;
  }
  throw new Error("Server terus sibuk.");
}

type Score = {
  id: string;
  rumpun: string;
  harapan: string;
  jebakan?: string | undefined;
  wajib: number;
  ditemukan: number;
  statusDinilai: number;
  statusBenar: number;
  jebakanLulus: boolean | null;
  galat?: string;
  terlewat: string[];
};

function describe(ref: Rujukan) {
  switch (ref.jenis) {
    case "peraturan":
    case "qanun":
      return `${ref.rujukan}${ref.pasal ? ` ${ref.pasal}` : ""}`;
    case "fatwa":
    case "putusan-mk":
      return `${ref.jenis} ${ref.nomor}`;
    case "khes":
    case "khi":
      return `${ref.jenis.toUpperCase()} ${ref.pasal}`;
    case "ayat":
      return `QS ${ref.surah}:${ref.ayat}`;
    case "hadis":
      return `hadis ${ref.id}`;
    case "turats":
      return `${ref.kitab} (${ref.madzhab})`;
    case "literatur":
      return `doi ${ref.doi}`;
  }
}

function score(item: Butir, data: AskData): Score {
  const result: Score = {
    id: item.id,
    rumpun: item.rumpun,
    harapan: item.harapan,
    jebakan: item.jebakan,
    wajib: item.rujukan_wajib.length,
    ditemukan: 0,
    statusDinilai: 0,
    statusBenar: 0,
    jebakanLulus: null,
    terlewat: [],
  };
  for (const ref of item.rujukan_wajib) {
    const source = sourceFor(ref, data.sources);
    if (opened(source)) result.ditemukan += 1;
    else result.terlewat.push(describe(ref));
    if (source && ref.jenis === "peraturan") {
      result.statusDinilai += 1;
      if (statusMatches(ref.status, source.status)) result.statusBenar += 1;
    }
  }

  if (item.jebakan === "nomor-palsu" || item.jebakan === "pasal-tidak-ada" || item.jebakan === "putusan-palsu") {
    // Lulus bila tidak satu pun bukti dibuka dari rujukan karangan itu.
    const fake = item.rujukan_wajib.map((ref) => sourceFor(ref, data.sources)).filter(Boolean);
    result.jebakanLulus = fake.every((source) => !opened(source));
  } else if (item.jebakan === "uu-dicabut") {
    const revokedRefs = item.rujukan_wajib.filter((ref) => ref.jenis === "peraturan");
    result.jebakanLulus = revokedRefs.every((ref) => {
      const source = sourceFor(ref, data.sources);
      return Boolean(source && ((source.revokedBy?.length ?? 0) > 0 || /tidak berlaku|dicabut/i.test(source.status ?? "")));
    });
  }
  return result;
}

async function loadItems() {
  const dir = path.join(ROOT, "rumpun");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const items: Butir[] = [];
  for (const file of files) {
    const parsed = BerkasSetSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    items.push(...parsed.butir);
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`ID butir ganda: ${item.id}`);
    ids.add(item.id);
  }
  return items.filter((item) => (!ONLY || item.rumpun === ONLY) && (WITH_HELD_OUT || !item.tertahan));
}

const items = await loadItems();
const health = await fetch(`${API}/health`).then((response) => response.json() as Promise<{ version?: string }>);
console.log(`Menguji ${items.length} butir x ${RUNS} putaran terhadap ${API} (mesin ${health.version ?? "?"}).`);

const runs: Score[][] = [];
for (let run = 0; run < RUNS; run += 1) {
  const scores: Score[] = [];
  for (const item of items) {
    try {
      scores.push(score(item, await ask(item.pertanyaan)));
    } catch (error) {
      scores.push({
        id: item.id,
        rumpun: item.rumpun,
        harapan: item.harapan,
        jebakan: item.jebakan,
        wajib: item.rujukan_wajib.length,
        ditemukan: 0,
        statusDinilai: 0,
        statusBenar: 0,
        jebakanLulus: item.jebakan ? false : null,
        galat: error instanceof Error ? error.message : String(error),
        terlewat: item.rujukan_wajib.map(describe),
      });
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  runs.push(scores);
}

const all = runs.flat();
const byRumpun = new Map<string, Score[]>();
for (const scoreItem of all) byRumpun.set(scoreItem.rumpun, [...(byRumpun.get(scoreItem.rumpun) ?? []), scoreItem]);

function summary(list: Score[]) {
  const required = list.filter((item) => item.harapan === "jawab");
  const wajib = required.reduce((sum, item) => sum + item.wajib, 0);
  const ditemukan = required.reduce((sum, item) => sum + item.ditemukan, 0);
  const statusDinilai = list.reduce((sum, item) => sum + item.statusDinilai, 0);
  const statusBenar = list.reduce((sum, item) => sum + item.statusBenar, 0);
  const traps = list.filter((item) => item.jebakanLulus !== null);
  const trapsPassed = traps.filter((item) => item.jebakanLulus).length;
  return {
    butir: list.length,
    recall: wajib ? ditemukan / wajib : null,
    recall_ci: wilson(ditemukan, wajib),
    status_benar: statusDinilai ? statusBenar / statusDinilai : null,
    status_dinilai: statusDinilai,
    jebakan_lulus: `${trapsPassed}/${traps.length}`,
    jebakan_ci: wilson(trapsPassed, traps.length),
    galat: list.filter((item) => item.galat).length,
  };
}

const setHash = createHash("sha256")
  .update(JSON.stringify(items.map((item) => item.id)))
  .digest("hex")
  .slice(0, 16);
const report = {
  dijalankan_pada: new Date().toISOString(),
  api: API,
  versi_mesin: health.version ?? null,
  ai: process.env.EVAL_AI_KEY
    ? { penyedia: process.env.EVAL_AI_PROVIDER, model: process.env.EVAL_AI_MODEL ?? "bawaan" }
    : null,
  putaran: RUNS,
  sidik_set: setHash,
  termasuk_tertahan: WITH_HELD_OUT,
  keseluruhan: summary(all),
  per_rumpun: Object.fromEntries([...byRumpun].map(([key, list]) => [key, summary(list)])),
  butir: runs[0],
};

const outDir = path.join(ROOT, "hasil");
await mkdir(outDir, { recursive: true });
const stamp = report.dijalankan_pada.replace(/[:.]/g, "-");
await writeFile(path.join(outDir, `eval-${stamp}.json`), JSON.stringify(report, null, 2));

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
console.log("\nRumpun                 recall   (95% CI)          status   jebakan  galat");
for (const [key, value] of Object.entries(report.per_rumpun)) {
  console.log(
    `${key.padEnd(22)} ${pct(value.recall).padStart(6)}   (${pct(value.recall_ci.rendah)}-${pct(value.recall_ci.tinggi)})`.padEnd(52) +
      `${pct(value.status_benar).padStart(6)}   ${value.jebakan_lulus.padStart(6)}  ${value.galat}`
  );
}
console.log(`\nLaporan: eval/hasil/eval-${stamp}.json`);
