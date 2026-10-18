import assert from "node:assert/strict";
import test from "node:test";
import { evalKeyFingerprint, runV2Flow } from "../eval/v2-flow.js";
import { createSigner, generateSigningKey } from "../src/core/sign.js";
import { createSumberService } from "../src/core/sumber.js";

const signer = createSigner(generateSigningKey());
const text = "Bahan sintetis yang hanya digunakan untuk pemeriksaan alur evaluasi bertanda tangan.";
const unused = async () => { throw new Error("Unexpected adapter"); };
const sources = createSumberService({ inspectArticle: unused, regulationDetail: unused, pdfPages: unused, fatwaText: unused, khesLocation: unused, gradedHadith: unused, turats: unused, verse: async () => ({ terjemah: text, rujukan: "Fixture" }) }, signer);
const plan = { isu: "Isu sintetis", subpertanyaan: ["Apa isi bahan sintetis?"], penelusuran: [{ kueri: "bahan sintetis", sumber: ["ayat"] }], kriteria: { masukkan: ["Relevan"], keluarkan: [], sertakanHistoris: false }, bagian: [{ judul: "Uji", fokus: "Isi bahan" }] };
const signed = <T extends object>(value: T) => ({ ...value, tanda: signer.sign(value) });
function fixture({ tamper = false, exclude = false, padded = false } = {}) {
  const calls: string[] = [];
  const ports = {
    async plan(input: unknown) { calls.push("plan"); assert.deepEqual(input, { pertanyaan: "Pertanyaan sintetis?", rumpun: "hes" }); return signed({ pertanyaan: "Pertanyaan sintetis?", rumpun: "hes", rencana: padded ? { ...plan, bagian: [{ judul: " Uji ", fokus: " Isi bahan " }] } : plan }); },
    async search() { calls.push("search"); return { kandidat: [{ id: "c1", judul: "Fixture", rujukan: { jenis: "ayat", surah: 1, ayat: 1 } }] }; },
    async open(ref: unknown) { calls.push("open"); assert.deepEqual(ref, { jenis: "ayat", surah: 1, ayat: 1 }); const result = await sources.buka(ref as never); if (tamper) result.potongan[0]!.text = "Forged"; return result; },
    async screen() { calls.push("screen"); return signed({ hasil: [{ id: "c1", keputusan: exclude ? "keluarkan" : "masukkan" }] }); },
    async synthesize(input: { bagian: { judul: string; fokus: string }; potongan: Array<{ text: string; id: string; contentHash: string }> }) { calls.push("synthesize"); assert.equal(input.potongan[0]!.text, text); assert.deepEqual(input.bagian, { judul: "Uji", fokus: "Isi bahan" }); return signed({ ...input, potongan: input.potongan.map(p => ({ id: p.id, contentHash: p.contentHash })), kalimat: [] }); },
  };
  return { ports, calls };
}
test("v2 evaluation discovers sources without receiving expected references", async () => {
  const { ports, calls } = fixture();
  const question = { pertanyaan: "Pertanyaan sintetis?", rumpun: "hes", rujukan_wajib: [{ jenis: "khi", pasal: "Pasal 999" }] };
  const result = await runV2Flow(question as never, ports as never, [signer.publicKeyPem]);
  assert.deepEqual(calls, ["plan", "search", "open", "screen", "synthesize"]);
  assert.equal(result.opened.length, 1);
  assert.equal(result.sections.length, 1);
});
test("v2 evaluation rejects altered evidence before screening or synthesis", async () => {
  const { ports, calls } = fixture({ tamper: true });
  await assert.rejects(runV2Flow({ pertanyaan: "Pertanyaan sintetis?", rumpun: "hes" }, ports as never, [signer.publicKeyPem]), /EVAL_PASSAGE/);
  assert.deepEqual(calls, ["plan", "search", "open"]);
});
test("excluded sources do not reach synthesis and empty evidence is recorded", async () => {
  const { ports, calls } = fixture({ exclude: true });
  const result = await runV2Flow({ pertanyaan: "Pertanyaan sintetis?", rumpun: "hes" }, ports as never, [signer.publicKeyPem]);
  assert.deepEqual(calls, ["plan", "search", "open", "screen"]);
  assert.equal(result.sections.length, 0);
  assert.equal(result.selected.length, 0);
});
test("ticket input uses the same trimmed question and section fields as the API", async () => {
  const { ports } = fixture({ padded: true });
  const result = await runV2Flow({ pertanyaan: " Pertanyaan sintetis? ", rumpun: "hes" }, ports as never, [signer.publicKeyPem]);
  assert.equal(result.sections.length, 1);
});
test("public-key pins compare canonical Ed25519 identity across Windows line endings", () => {
  const fingerprint = evalKeyFingerprint(signer.publicKeyPem);
  assert.ok(fingerprint);
  assert.equal(evalKeyFingerprint(signer.publicKeyPem.replaceAll("\n", "\r\n")), fingerprint);
  assert.notEqual(evalKeyFingerprint(createSigner(generateSigningKey()).publicKeyPem), fingerprint);
  assert.equal(evalKeyFingerprint("not a public key"), null);
});
