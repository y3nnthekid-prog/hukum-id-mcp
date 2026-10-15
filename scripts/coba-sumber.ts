// Uji asap manual lapisan buka-sumber v2 terhadap sumber asli (memakai cache bila ada).
import { periksaPasal } from "../src/alur.js";
import { detailPeraturan } from "../src/bpk.js";
import { ambilAyat, hadisBerderajat } from "../src/dalil.js";
import { teksFatwaDsn } from "../src/dsn.js";
import { lokasiNaskahKhes } from "../src/khes.js";
import { halamanPdf } from "../src/pdf.js";
import { cariTurats } from "../src/turats.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { contentHash } from "../src/core/passages.js";
import { createSumberService, signedPart, type RujukanBuka } from "../src/core/sumber.js";

const signer = createSigner(generateSigningKey());
const service = createSumberService(
  {
    inspectArticle: periksaPasal as any,
    regulationDetail: detailPeraturan as any,
    pdfPages: halamanPdf as any,
    fatwaText: teksFatwaDsn as any,
    khesLocation: lokasiNaskahKhes as any,
    verse: ambilAyat as any,
    gradedHadith: hadisBerderajat as any,
    turats: cariTurats as any,
  },
  signer
);
const refs: RujukanBuka[] = JSON.parse(process.argv[2] ?? "[]");
for (const ref of refs) {
  const result = await service.buka(ref);
  console.log(`\n== ${JSON.stringify(ref)} -> ${result.status} ${result.alasan ?? ""}`);
  for (const p of result.potongan) {
    const sah = verifySignature(signedPart(p), p.tanda, [signer.publicKeyPem]) && contentHash(p.text) === p.contentHash;
    console.log(`  ${p.rujukan} | ${p.lapisan.join(",")} | hlm ${p.locator.halamanAwal ?? "-"} | ${p.verificationStatus} ${p.retrievedAt.slice(0, 10)} | tanda ${sah ? "sah" : "TIDAK SAH"} | ${JSON.stringify(p.text.slice(0, 110))}`);
  }
  for (const w of result.peringatan.slice(0, 3)) console.log(`  ! ${w.slice(0, 160)}`);
}
