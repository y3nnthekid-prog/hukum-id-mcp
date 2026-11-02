// Uji mutu Tanya v1 lewat mesin yang sedang jalan: satu permintaan per soal, berurutan.
// Pakai di VPS, dari direktori rilis mesin, dengan variabel dari /etc/pasla-preview.env:
//   node scripts/eval-tanya.mjs eval/tanya-v1.json /tmp/hasil-eval.json
// Tiket v4 dibuat sendiri dengan PASLA_STEP_TICKET_SECRET, jadi biaya tetap tercatat di buku mesin.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { requestHash } from "../dist/core/step-ticket.js";

const [berkasSoal, berkasHasil] = process.argv.slice(2);
if (!berkasSoal || !berkasHasil) throw new Error("Pakai: node scripts/eval-tanya.mjs <soal.json> <hasil.json>");
const { versi, soal } = JSON.parse(await readFile(berkasSoal, "utf8"));
const secret = process.env.PASLA_STEP_TICKET_SECRET, aud = process.env.PASLA_ENGINE_ORIGIN;
const mesin = process.env.EVAL_MESIN ?? "http://127.0.0.1:3102";
if (!secret || !aud) throw new Error("PASLA_STEP_TICKET_SECRET dan PASLA_ENGINE_ORIGIN wajib ada.");

const tiket = (input) => {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ v: 4, iss: "https://riset.pasla.pages.dev", aud, sub: "uji-eval", conversationId: input.conversationId, turnId: input.turnId, inputHash: requestHash(input), profile: "pasla-tanya-v1", jti: randomBytes(32).toString("base64url"), iat: now, exp: now + 300 })).toString("base64url");
  return body + "." + createHmac("sha256", secret).update(body).digest("base64url");
};
// Sama dengan aturan mesin: pencabutan sebagian tidak mencabut seluruh aturan.
const dicabut = (sumber) => (sumber.dicabutDengan ?? []).some((d) => !/^sebagian\b/i.test(d.trim())) || String(sumber.status ?? "").split(":").some((b) => /^(?:tidak berlaku|dicabut)\b(?!\s+sebagian)/i.test(b.trim()));

const hasil = [];
for (const s of soal) {
  const input = { conversationId: "eval-" + randomUUID().slice(0, 8), turnId: "eval-" + randomUUID().slice(0, 8), version: 1, messages: [{ id: "u1", role: "user", text: s.teks }] };
  const mulai = Date.now();
  let a = null, galat = "", biayaMikro = 0;
  try {
    const res = await fetch(mesin + "/v2/chat/turn", { method: "POST", headers: { "content-type": "application/json", "x-pasla-chat-ticket": tiket(input) }, body: JSON.stringify(input), signal: AbortSignal.timeout(240_000) });
    const events = (await res.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const akhir = events.find((e) => e.type === "result" || e.type === "error");
    biayaMikro = akhir?.usage?.costMicro ?? 0;
    if (akhir?.type === "result") a = akhir.data; else galat = akhir?.code ?? `HTTP ${res.status}`;
  } catch (cause) { galat = String(cause?.message ?? cause); }

  const poin = (a?.poin ?? []).map((p) => {
    const sumber = a.sources.find((x) => x.id === p.kutipan.passageId);
    return { teks: p.teks, rujukan: sumber?.rujukan ?? "?", kutipan: p.kutipan.quote, asli: !!sumber && sumber.text.includes(p.kutipan.quote), dicabut: !!sumber && dicabut(sumber.sumber) };
  });
  const semuaTeks = [a?.intinya, ...poin.map((p) => p.teks), ...(a?.langkah ?? []), ...(a?.tanyaBalik ?? [])].join(" ").toLowerCase();
  const cek = { selesai: !!a, topik: (a?.topik ?? null) === s.topik, kutipanAsli: poin.every((p) => p.asli), tanpaDasarDicabut: poin.every((p) => !p.dicabut) };
  if (s.topik === null) cek.tanpaAi = a?.method?.model === "tanpa-ai";
  if (s.harapRujukan) cek.rujukan = poin.some((p) => s.harapRujukan.some((h) => p.rujukan.includes(h)));
  if (s.dilarang) cek.bersih = !s.dilarang.some((x) => semuaTeks.includes(x.toLowerCase()));
  if (s.rujukanDilarang) cek.tanpaRujukanDilarang = !poin.some((p) => s.rujukanDilarang.some((x) => p.rujukan.includes(x)));
  const lulus = Object.values(cek).every(Boolean);
  hasil.push({ id: s.id, teks: s.teks, topikHarap: s.topik, topik: a?.topik ?? null, jebakan: s.jebakan ?? null, lulus, cek, model: a?.method?.model ?? null, intinya: a?.intinya ?? "", poin, langkah: a?.langkah ?? [], tanyaBalik: a?.tanyaBalik ?? [], batas: a?.batas ?? [], biayaMikro, waktuMs: Date.now() - mulai, galat });
  console.log(`${lulus ? "LULUS" : "GAGAL"} ${s.id} ${((Date.now() - mulai) / 1000).toFixed(1)}s US$${(biayaMikro / 1e6).toFixed(4)} ${lulus ? "" : JSON.stringify(cek)}${galat ? " galat=" + galat : ""}`);
}

const ringkasan = {
  versi, dijalankan: new Date().toISOString(), jumlah: hasil.length,
  lulus: hasil.filter((h) => h.lulus).length,
  persen: Math.round((hasil.filter((h) => h.lulus).length / hasil.length) * 1000) / 10,
  kutipanKarangan: hasil.reduce((n, h) => n + h.poin.filter((p) => !p.asli).length, 0),
  dasarDicabut: hasil.reduce((n, h) => n + h.poin.filter((p) => p.dicabut).length, 0),
  biayaUsd: Math.round(hasil.reduce((n, h) => n + h.biayaMikro, 0)) / 1e6,
};
ringkasan.memenuhiAmbang = ringkasan.persen >= 85 && ringkasan.kutipanKarangan === 0 && ringkasan.dasarDicabut === 0;
await writeFile(berkasHasil, JSON.stringify({ ringkasan, hasil }, null, 2));
console.log(JSON.stringify(ringkasan));
