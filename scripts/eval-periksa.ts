/**
 * Periksa set uji: skema, jumlah per rumpun, rujukan yang belum terverifikasi, dan sidik butir
 * tertahan.
 *
 *   npx tsx scripts/eval-periksa.ts            # periksa
 *   npx tsx scripts/eval-periksa.ts --kunci    # tulis ulang eval/tertahan.sha256 (sekali, saat membekukan)
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BerkasSetSchema, type Butir } from "../eval/skema.js";

const ROOT = path.resolve(import.meta.dirname, "..", "eval");
const dir = path.join(ROOT, "rumpun");
const items: Butir[] = [];
let failed = false;

for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
  const parsed = BerkasSetSchema.safeParse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
  if (!parsed.success) {
    failed = true;
    console.error(`${file}: tidak sesuai skema`);
    for (const issue of parsed.error.issues.slice(0, 20)) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  items.push(...parsed.data.butir);
}

const ids = new Map<string, number>();
for (const item of items) ids.set(item.id, (ids.get(item.id) ?? 0) + 1);
for (const [id, count] of ids) {
  if (count > 1) {
    failed = true;
    console.error(`ID ganda: ${id}`);
  }
}

const counts = new Map<string, { jawab: number; jebakan: number; tertahan: number }>();
for (const item of items) {
  const entry = counts.get(item.rumpun) ?? { jawab: 0, jebakan: 0, tertahan: 0 };
  if (item.jebakan) entry.jebakan += 1;
  else entry.jawab += 1;
  if (item.tertahan) entry.tertahan += 1;
  counts.set(item.rumpun, entry);
}
console.log("Rumpun                 jawab  jebakan  tertahan");
for (const [rumpun, entry] of [...counts].sort()) {
  console.log(`${rumpun.padEnd(22)} ${String(entry.jawab).padStart(5)}  ${String(entry.jebakan).padStart(7)}  ${String(entry.tertahan).padStart(8)}`);
}

const unverified = items.filter((item) => /belum (dapat )?diverifikasi|belum terverifikasi/i.test(item.verifikasi.catatan));
if (unverified.length) {
  console.log(`\n${unverified.length} butir memuat rujukan yang belum terverifikasi:`);
  for (const item of unverified) console.log(`  ${item.id}: ${item.verifikasi.catatan.slice(0, 140)}`);
}

const heldOut = items.filter((item) => item.tertahan).sort((a, b) => a.id.localeCompare(b.id));
const digest = createHash("sha256").update(JSON.stringify(heldOut)).digest("hex");
const lockFile = path.join(ROOT, "tertahan.sha256");
if (process.argv.includes("--kunci")) {
  await writeFile(lockFile, `${digest}\n`);
  console.log(`\nSidik ${heldOut.length} butir tertahan dikunci: ${digest}`);
} else {
  const locked = (await readFile(lockFile, "utf8").catch(() => "")).trim();
  if (!locked) console.log("\nSidik butir tertahan belum dikunci (jalankan dengan --kunci saat set dibekukan).");
  else if (locked !== digest) {
    failed = true;
    console.error(`\nButir tertahan berubah sejak dikunci (${locked.slice(0, 12)} != ${digest.slice(0, 12)}).`);
  } else console.log(`\nSidik butir tertahan cocok (${heldOut.length} butir).`);
}

if (failed) process.exitCode = 1;
