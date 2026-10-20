import assert from "node:assert/strict";
import test from "node:test";

import type { JsonModel } from "../src/ai/json-model.js";
import { contentHash } from "../src/core/passages.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { sintesisBagian } from "../src/core/sintesis.js";
import { signedPart, type PotonganBertanda } from "../src/core/sumber.js";

const signer = createSigner(generateSigningKey());
const text =
  "Pasal 7\n(1) Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 (sembilan belas) tahun.\n(2) Dalam hal terjadi penyimpangan terhadap ketentuan umur, orang tua dapat meminta dispensasi kepada Pengadilan dengan alasan sangat mendesak.";

function passage(overrides: Partial<PotonganBertanda> = {}): PotonganBertanda {
  const unsigned = {
    id: "ps_aaaaaaaaaaaaaaaaaaaaaaaa",
    documentId: "bpk:122740",
    jenis: "peraturan" as const,
    judul: "UU 16/2019",
    rujukan: "UU 1/1974 Pasal 7 sebagaimana diubah UU 16/2019",
    locator: { pasal: "Pasal 7", bagian: "batang-tubuh" as const, halamanAwal: 2, halamanAkhir: 3, mengubah: "UU 1/1974" },
    pageStarts: [{ halaman: 2, offset: 0 }, { halaman: 3, offset: 108 }],
    text,
    contentHash: contentHash(text),
    identitas: ["UU 1/1974", "UU 16/2019", "Pasal 7"],
    lapisan: ["norma" as const],
    sumber: { nama: "JDIH BPK RI", url: "https://peraturan.bpk.go.id/x.pdf", otoritas: "JDIH BPK RI", status: "Berlaku", diubahDengan: [], dicabutDengan: [] },
    retrievedAt: "2026-10-16T00:00:00.000Z",
    verificationStatus: "verified_snapshot" as const,
    mesin: "0.8.2",
    ...overrides,
  };
  return { ...unsigned, tanda: signer.sign(signedPart(unsigned)) } as PotonganBertanda;
}

function fakeModel(output: unknown): JsonModel & { calls: number } {
  return {
    provider: "claude",
    model: "uji",
    calls: 0,
    async generate() {
      this.calls += 1;
      return output as never;
    },
  };
}

test("faithful sentences pass with page; unfaithful ones are dropped with a reason; the result is signed", async () => {
  const model = fakeModel({
    kalimat: [
      {
        id: "k1",
        teks: "Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 tahun.",
        lapisan: "norma",
        potongan_id: "ps_aaaaaaaaaaaaaaaaaaaaaaaa",
        kutipan: "Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 (sembilan belas) tahun",
      },
      {
        id: "k2",
        teks: "Orang tua dapat meminta dispensasi kepada Pengadilan dengan alasan sangat mendesak.",
        lapisan: "norma",
        potongan_id: "ps_aaaaaaaaaaaaaaaaaaaaaaaa",
        kutipan: "orang tua dapat meminta dispensasi kepada Pengadilan dengan alasan sangat mendesak",
      },
      {
        id: "k3",
        teks: "Dispensasi wajib dikabulkan bila calon mempelai berumur 16 tahun.",
        lapisan: "norma",
        potongan_id: "ps_aaaaaaaaaaaaaaaaaaaaaaaa",
        kutipan: "orang tua dapat meminta dispensasi kepada Pengadilan dengan alasan sangat mendesak",
      },
      { id: "k4", teks: "Kalimat dari potongan karangan.", lapisan: "norma", potongan_id: "ps_palsu", kutipan: "apa saja" },
    ],
    analisis: [
      { teks: "Kedua ketentuan ini membentuk satu kesatuan pengaturan usia perkawinan.", merujuk: ["k1", "k2"] },
      { teks: "Hal ini sejalan dengan UU 35/2014.", merujuk: ["k1"] },
    ],
  });
  const result = await sintesisBagian({
    pertanyaan: "Berapa batas usia perkawinan?",
    bagian: { judul: "Norma", fokus: "batas usia" },
    potongan: [passage()],
    model,
    signer,
    publicKeysPem: [signer.publicKeyPem],
  });

  assert.deepEqual(result.kalimat.map((item) => item.id), ["k1", "k2"]);
  assert.equal(result.kalimat[0]!.halaman, 2);
  assert.equal(result.kalimat[1]!.halaman, 3);
  assert.deepEqual(result.dibuang.map((item) => [item.id, item.alasan]), [
    ["k3", "MODALITAS_TIDAK_DIDUKUNG"],
    ["k4", "POTONGAN_TIDAK_DIKENAL"],
  ]);
  assert.equal(result.analisis.length, 0);
  assert.equal(result.analisisDibuang.length, 2);
  assert.deepEqual(result.cakupan?.documentIds,['bpk:122740']);
  assert.equal(result.cakupan?.passageIds.length,1);
  assert.ok(result.cakupan?.batas.some(text=>text.includes('cakupan jawaban berkurang')));
  const { tanda, ...unsigned } = result;
  assert.ok(verifySignature(unsigned, tanda, [signer.publicKeyPem]));
  assert.equal(verifySignature({...unsigned,cakupan:{...result.cakupan,documentIds:['palsu']}},tanda,[signer.publicKeyPem]),false);
});

test("forged or tampered passages are rejected before the model ever sees them", async () => {
  const model = fakeModel({ kalimat: [], analisis: [] });
  const tampered = { ...passage(), text: text.replace("19 (sembilan belas)", "16 (enam belas)") };
  const otherSigner = createSigner(generateSigningKey());
  const unsignedForeign = { ...passage() } as Partial<PotonganBertanda>;
  delete unsignedForeign.tanda;
  const foreign = { ...passage(), tanda: otherSigner.sign(signedPart(unsignedForeign as PotonganBertanda)) };
  const relabelled = { ...passage(), lapisan: ["pedoman" as const] };

  const result = await sintesisBagian({
    pertanyaan: "Berapa batas usia perkawinan?",
    bagian: { judul: "Norma", fokus: "batas usia" },
    potongan: [tampered, foreign, relabelled],
    model,
    signer,
    publicKeysPem: [signer.publicKeyPem],
  });
  assert.equal(model.calls, 0);
  assert.equal(result.potonganDitolak.length, 3);
  assert.equal(result.model, null);
  assert.deepEqual(result.kalimat, []);
});
