/** Direct-core integration pilot, deliberately NOT discovery or a legal-quality evaluation. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAzurePilotModel, AZURE_PASLA, publicPilotPin } from "../eval/azure-pasla.js";
import { frozenPilotSource } from "../eval/azure-pilot-source.js";
import { rencanaLaporan, saringLaporan } from "../src/core/laporan.js";
import { sintesisBagian } from "../src/core/sintesis.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";

const limitations = ["Preselected public source; no discovery/recall measurement", "One synthetic question; no held-out dataset", "Direct core calls, not public API/account/UI integration", "No independent calibrated judge or human legal labels", "No temperature zero; GPT-5 mini reasoning model", "One frozen signed passage, not full source-snapshot attestation", "Cost estimates are not an Azure billing statement or account spending cap"];
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!;
  if (!["--run", "--runs", "--max-usd", "--max-calls", "--source-file", "--profile"].includes(key) || args.has(key)) throw new Error("AZURE_PILOT_ARGUMENT");
  args.set(key, key === "--run" ? "true" : process.argv[++index] ?? "");
}
const runCount = Number(args.get("--runs") ?? 3);
const maxUsd = Number(args.get("--max-usd") ?? 1);
const maxCalls = Number(args.get("--max-calls") ?? 9);
const profile = args.get("--profile") ?? "core";
if (profile !== "core" && profile !== "low-4096") throw new Error("AZURE_PILOT_ARGUMENT");
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 3 || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 1 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 9) throw new Error("AZURE_PILOT_ARGUMENT");
if (!args.has("--run")) {
  console.log(JSON.stringify({ mode: "preflight", ...AZURE_PASLA, profile, runs: runCount, maxCalls, maxUsd, paidCalls: 0, qualityGatePassed: false, limitations }));
} else {
  if (process.env.EVAL_CONFIRM_PAID !== "pasla-azure-pilot-usd1" || !process.env.AZURE_OPENAI_API_KEY || !process.env.EVAL_PUBLIC_KEY_FILE) throw new Error("AZURE_PILOT_AUTHORIZATION");
  const pilot = createAzurePilotModel({ apiKey: process.env.AZURE_OPENAI_API_KEY, maxUsd, maxCalls, profile });
  const pin = publicPilotPin(await readFile(process.env.EVAL_PUBLIC_KEY_FILE, "utf8"));
  const signer = createSigner(generateSigningKey()); // ephemeral local test signer, never persisted
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  const folder = path.resolve(import.meta.dirname, "../eval/hasil", `azure-pilot-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(folder, { recursive: true });
  const runs: Array<Record<string, unknown>> = [];
  const trace = { mode: "integration-pilot", startedAt: new Date().toISOString(), plannedRuns: runCount, qualityGatePassed: false, heldOutUsed: false, productionChanged: false, limitations, localSignerPublicKey: signer.publicKeyPem, runs };
  const save = async (state: string, errorCode?: string) => writeFile(path.join(folder, "trace.json"), JSON.stringify({ ...trace, updatedAt: new Date().toISOString(), state, ...(errorCode ? { errorCode } : {}), budget: pilot.summary() }, null, 2));
  let stage = "SOURCE";
  let lastStart = 0;
  const paced = async <T>(work: () => Promise<T>) => {
    await delay(Math.max(0, 65000 - (Date.now() - lastStart)), undefined, { signal });
    lastStart = Date.now();
    return work();
  };
  function assertLocalSignature(item: { tanda: Parameters<typeof verifySignature>[1] }) {
    const { tanda, ...data } = item;
    if (!verifySignature(data, tanda, [signer.publicKeyPem])) throw new Error("LOCAL_SIGNATURE");
  }
  try {
    await save("preparing-source");
    let frozenInput: string;
    if (args.has("--source-file")) {
      frozenInput = await readFile(args.get("--source-file")!, "utf8");
    } else {
    const response = await fetch("https://api.pasla.tech/v2/sumber/potongan", { method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), headers: { "content-type": "application/json" }, body: JSON.stringify({ rujukan: [{ jenis: "peraturan", rujukan: "PERMA 14/2016", pasal: "Pasal 2" }] }) });
    if (!response.ok || !response.body) throw new Error("SOURCE_HTTP");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 100000) { await reader.cancel(); throw new Error("SOURCE_SIZE"); } chunks.push(next.value); }
    } finally { reader.releaseLock(); }
    frozenInput = JSON.stringify({ source: JSON.parse(Buffer.concat(chunks).toString("utf8")), publicKeyPem: pin });
    }
    const { passage, frozen } = frozenPilotSource(frozenInput, pin);
    await writeFile(path.join(folder, "source.json"), frozen, { flag: "wx" });
    Object.assign(trace, { sourceSha256: createHash("sha256").update(frozen).digest("hex"), sourceContentHash: passage.contentHash });
    const pertanyaan = "Bagaimana bentuk pengajuan perkara ekonomi syariah menurut sumber yang disediakan?";
    for (let number = 1; number <= runCount; number++) {
      const run: Record<string, unknown> = { number }; runs.push(run);
      stage = "PLAN";
      const plan = await paced(() => rencanaLaporan({ pertanyaan, rumpun: "hes", model: pilot.model, signer, signal }));
      assertLocalSignature(plan); run.plan = plan; await save("running");
      console.log(JSON.stringify({ run: number, stage, calls: pilot.summary().calls }));
      stage = "SCREEN";
      const screening = await paced(() => saringLaporan({ kandidat: [{ id: "preselected-perma-2", judul: passage.judul, statusBuka: "dibuka", potongan: [passage] }], rencana: plan.rencana, model: pilot.model, signer, publicKeysPem: [pin], signal }));
      assertLocalSignature(screening); run.screening = screening; await save("running");
      console.log(JSON.stringify({ run: number, stage, calls: pilot.summary().calls, included: screening.metode.layak }));
      if (!screening.hasil.some(item => item.keputusan === "masukkan")) { run.synthesisSkipped = "No source accepted by screening"; continue; }
      stage = "SYNTHESIS";
      const synthesis = await paced(() => sintesisBagian({ pertanyaan, bagian: plan.rencana.bagian[0]!, potongan: [passage], model: pilot.model, signer, publicKeysPem: [pin], signal }));
      assertLocalSignature(synthesis); run.synthesis = synthesis; await save("running");
      console.log(JSON.stringify({ run: number, stage, calls: pilot.summary().calls, accepted: synthesis.kalimat.length, rejected: synthesis.dibuang.length }));
    }
    await save("completed"); console.log(JSON.stringify({ state: "completed", folder, budget: pilot.summary(), qualityGatePassed: false }));
  } catch {
    // Never persist provider error bodies, headers, credentials or uncontrolled exception strings.
    await save("stopped", `AZURE_PILOT_${stage}_FAILED`);
    console.log(JSON.stringify({ state: "stopped", stage, folder, budget: pilot.summary(), qualityGatePassed: false }));
    process.exitCode = 1;
  }
}
