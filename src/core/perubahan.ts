import type { RujukanBuka } from "./sumber.js";

/**
 * Pasal UU 13/2003 yang diubah, disisipkan, atau dihapus oleh Pasal 81 Lampiran UU 6/2023.
 * Dibaca dari halaman 548-579 PDF resmi JDIH BPK pada 2 November 2026 (entri korpus uu-6-2023-ketenagakerjaan).
 * Bunyi terbaru pasal yang diubah dibuka dari UU 6/2023; pasal yang dihapus tidak dipakai lagi sebagai dasar.
 */
const daftar = (nomor: string) => new Set(nomor.split(" "));
export const UU13_DIUBAH_UU6 = daftar("13 14 37 42 45 47 49 56 57 58 59 61 61A 64 66 67 77 78 79 84 88 88A 88B 88C 88D 88E 88F 90A 90B 92 92A 94 95 98 151 151A 153 154A 156 157 157A 160 185 186 187 188 190 191A");
export const UU13_DIHAPUS_UU6 = daftar("43 44 46 48 65 89 90 91 96 97 152 154 155 158 159 161 162 163 164 165 166 167 168 169 170 171 172 184");

/** Bagian pasal (dalam Pasal 81 Lampiran UU 6/2023) yang dimaknai ulang amar Putusan MK 168/PUU-XXI/2023, halaman 679-687. */
const MK168: Record<string, string> = {
  "42": "ayat (1) dan (4)", "56": "ayat (3)", "57": "ayat (1)", "64": "ayat (2)", "79": "ayat (2) huruf b dan ayat (5)",
  "88": "ayat (1), (2), dan (3) huruf b", "88C": "", "88D": "ayat (2)", "88F": "", "90A": "", "92": "ayat (1)", "95": "ayat (3)",
  "98": "ayat (1)", "151": "ayat (3) dan (4)", "156": "ayat (2)", "157A": "ayat (3)",
};

const nomorPasal = (pasal: string) => pasal.replace(/^pasal\s+/iu, "").trim().toUpperCase();
const samaRujukan = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.toLowerCase();

/** Rujukan ke bunyi yang berlaku: pasal UU 13/2003 yang diubah dibuka dari UU 6/2023, yang dihapus menjadi null. */
export function versiTerbaru(ref: RujukanBuka): RujukanBuka | null {
  if (ref.jenis !== "peraturan" || !ref.pasal || !samaRujukan(ref.rujukan, "UU 13/2003")) return ref;
  const nomor = nomorPasal(ref.pasal);
  if (UU13_DIHAPUS_UU6.has(nomor)) return null;
  if (UU13_DIUBAH_UU6.has(nomor)) return { jenis: "peraturan", rujukan: "UU 6/2023", pasal: `Pasal ${nomor}` };
  return ref;
}

/** Potongan naskah asli UU 13/2003 yang bunyinya sudah diganti atau dihapus UU 6/2023. */
export function naskahUsang(p: { identitas: string[]; locator: { pasal?: string; mengubah?: string } }) {
  if (!p.locator.pasal || p.locator.mengubah || !samaRujukan(p.identitas[0] ?? "", "UU 13/2003")) return false;
  const nomor = nomorPasal(p.locator.pasal);
  return UU13_DIUBAH_UU6.has(nomor) || UU13_DIHAPUS_UU6.has(nomor);
}

/** Catatan untuk model bila pasal perubahan UU 6/2023 ini dimaknai ulang Putusan MK 168/PUU-XXI/2023. */
export function catatanMk168(p: { identitas: string[]; locator: { pasal?: string; mengubah?: string } }) {
  if (!p.locator.pasal || p.locator.mengubah !== "UU 13/2003" || !samaRujukan(p.identitas[0] ?? "", "UU 6/2023")) return undefined;
  const bagian = MK168[nomorPasal(p.locator.pasal)];
  if (bagian === undefined) return undefined;
  return `Putusan MK 168/PUU-XXI/2023 memaknai ulang ${bagian ? bagian + " " : "sebagian isi "}pasal ini. Jangan menyatakan bunyi bagian itu pasti berlaku persis seperti tertulis; sebutkan bahwa maknanya telah diubah putusan MK.`;
}
