import assert from "node:assert/strict";
import test from "node:test";

import { lapisanSah, validateAnalysis, validateSentence, type SumberKalimat } from "../src/core/validator.js";

const pasal7: SumberKalimat = {
  jenis: "peraturan",
  bagian: "batang-tubuh",
  identitas: ["UU 16/2019", "UU 1/1974", "Pasal 7"],
  text:
    "Pasal 7\n(1) Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 (sembilan belas) tahun.\n(2) Dalam hal terjadi penyimpangan terhadap ketentuan umur sebagaimana dimaksud pada ayat (1), orang tua pihak pria dan/atau orang tua pihak wanita dapat meminta dispensasi kepada Pengadilan dengan alasan sangat mendesak disertai bukti-bukti pendukung yang cukup.",
};
const quote1 = "Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 (sembilan belas) tahun";

test("a faithful sentence with an exact quote passes and is located", () => {
  const result = validateSentence({
    kalimat: "Menurut Pasal 7 UU 1/1974, perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 tahun.",
    kutipan: quote1,
    lapisan: "norma",
    sumber: pasal7,
  });
  assert.equal(result.ok, true);
});

test("each kind of unfaithful sentence is rejected with its own reason", () => {
  const cases: Array<[string, string, string]> = [
    ["Perkawinan diizinkan bila pria dan wanita sudah mencapai umur 16 tahun.", quote1, "ANGKA_TIDAK_DIDUKUNG"],
    ["Perkawinan tidak diizinkan apabila pria dan wanita sudah mencapai umur 19 tahun.", quote1, "NEGASI_BERBEDA"],
    ["Perkawinan wajib dilakukan apabila pria dan wanita sudah mencapai umur 19 tahun.", quote1, "MODALITAS_TIDAK_DIDUKUNG"],
    ["Pasal 9 UU 1/1974 membolehkan perkawinan pada umur 19 tahun.", quote1, "RUJUKAN_TIDAK_DIDUKUNG"],
    ["Perkawinan anak di bawah umur selalu dipidana penjara oleh pengadilan negeri.", quote1, "KATA_TIDAK_DIDUKUNG"],
    ["Perkawinan diizinkan pada umur 19 tahun.", "umur 19 (sembilan belas) tahun", "KUTIPAN_TERLALU_PENDEK"],
    ["Perkawinan diizinkan pada umur 18 tahun.", "Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 18 tahun", "KUTIPAN_TIDAK_ADA"],
  ];
  for (const [kalimat, kutipan, alasan] of cases) {
    const result = validateSentence({ kalimat, kutipan, lapisan: "norma", sumber: pasal7 });
    assert.equal(result.ok, false, kalimat);
    assert.equal(!result.ok && result.alasan, alasan, kalimat);
  }
});

test("authority layers: a fatwa or KHI can never be presented as a binding norm", () => {
  assert.deepEqual(lapisanSah({ jenis: "fatwa" }), ["pedoman"]);
  assert.deepEqual(lapisanSah({ jenis: "khi" }), ["pedoman"]);
  assert.deepEqual(lapisanSah({ jenis: "peraturan", bagian: "penjelasan" }), ["tafsir-resmi"]);
  const fatwa: SumberKalimat = {
    jenis: "fatwa",
    identitas: ["04/DSN-MUI/IV/2000"],
    text: "Bank membeli barang yang diperlukan nasabah atas nama bank sendiri, dan pembelian ini harus sah dan bebas riba.",
  };
  const result = validateSentence({
    kalimat: "Bank membeli barang yang diperlukan nasabah atas nama bank sendiri.",
    kutipan: "Bank membeli barang yang diperlukan nasabah atas nama bank sendiri",
    lapisan: "norma",
    sumber: fatwa,
  });
  assert.equal(!result.ok && result.alasan, "LAPISAN_TIDAK_SESUAI");
  assert.equal(
    validateSentence({
      kalimat: "Menurut Fatwa 04/DSN-MUI/IV/2000, bank membeli barang yang diperlukan nasabah atas nama bank sendiri.",
      kutipan: "Bank membeli barang yang diperlukan nasabah atas nama bank sendiri",
      lapisan: "pedoman",
      sumber: fatwa,
    }).ok,
    true
  );
});

test("AI analysis may only build on validated sentences and cannot introduce new legal references", () => {
  const lolos = new Set(["k1", "k2"]);
  assert.equal(validateAnalysis({ kalimat: "Kedua ketentuan ini saling melengkapi.", merujuk: ["k1", "k2"], lolos }).ok, true);
  assert.equal(validateAnalysis({ kalimat: "Kedua ketentuan ini saling melengkapi.", merujuk: [], lolos }).ok, false);
  assert.equal(validateAnalysis({ kalimat: "Ini sejalan dengan Pasal 28B UUD.", merujuk: ["k1"], lolos }).ok, false);
  assert.equal(validateAnalysis({ kalimat: "Ini diperkuat UU 35/2014.", merujuk: ["k1"], lolos }).ok, false);
});
