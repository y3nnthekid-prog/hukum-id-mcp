import { cariPeraturan, detailPeraturan } from "../bpk.js";
import { cariPerma } from "../perma.js";
import { cariFatwaDsn } from "../dsn.js";
import { detailPutusan, telusuriPutusan } from "../ma.js";
import { cariPutusanMK } from "../mk.js";
import { cariLiteratur } from "../scholar.js";
import { periksaPasal, risetAkadSyariah } from "../alur.js";
import { verifikasiKutipan } from "../verifikasi.js";
import { konsolidasiPeraturan } from "../konsolidasi.js";
import { hukumPadaTanggal } from "../analisis.js";
import { cariPasalKhes } from "../khes.js";
import { periksaKesehatanSumber } from "../kesehatan.js";

import type { LegalAdapters } from "./service.js";

export const legacyAdapters: LegalAdapters = {
  searchRegulations: (input) => cariPeraturan(input),
  searchMaProducts: (input) => cariPerma({ query: input.query, tahun: input.tahun, limit: input.limit }),
  searchFatwas: (input) => cariFatwaDsn({ query: input.query, tahun: input.tahun, limit: input.limit }),
  searchMaDecisions: (input) =>
    telusuriPutusan({
      kategori: /syari|akad|fatwa/i.test(input.query ?? "") ? "ekonomi-syari-ah-1" : input.kategori,
      tahun: input.tahun,
      limit: input.limit,
    }),
  searchMkDecisions: (input) => cariPutusanMK({ query: input.query, limit: input.limit }),
  // Legacy modules are JavaScript; validation happens in the typed API/MCP
  // boundary before these compatibility calls.
  searchLiterature: (input) => cariLiteratur(input as any),
  getRegulation: (ref) => detailPeraturan(ref),
  getMaDecision: (ref) => detailPutusan(ref),
  inspectArticle: (input) => periksaPasal(input as any),
  verifyCitations: (input) => verifikasiKutipan(input as any),
  traceRegulation: (input) => konsolidasiPeraturan(input as any),
  lawAtDate: (input) => hukumPadaTanggal(input as any),
  researchSharia: (input) => risetAkadSyariah(input as any),
  inspectKhes: (input) => cariPasalKhes(input),
  sourceStatus: (input) => periksaKesehatanSumber(input),
};
