export const JENIS_TELUSUR = ["peraturan", "fatwa", "khes", "khi", "qanun", "putusan", "turats", "ayat", "hadis", "literatur"] as const;
export type JenisTelusur = typeof JENIS_TELUSUR[number];
export type ProfilRumpun = {
  nama: string;
  sumber: JenisTelusur[];
  hierarki: string[];
  contoh: string[];
  bagian: string[];
  cakupan: { status: "terbatas"; alasan: string[] };
};
const coverage = (extra: string[]) => ({ status: "terbatas" as const, alasan: ["Belum melewati gerbang evaluasi rilis dan penelaahan ahli.", ...extra] });
export const RUMPUN = {
  "ilmu-hukum": { nama: "Ilmu Hukum", sumber: ["peraturan", "putusan", "literatur"], hierarki: ["Norma", "Tafsir resmi", "Doktrin"], contoh: ["Pembentukan peraturan", "Perlindungan konsumen"], bagian: ["Ruang lingkup", "Norma dan status", "Tafsir dan praktik", "Batas temuan"], cakupan: coverage(["Teks putusan bergantung pada salinan resmi yang dapat dibuka atau diimpor."]) },
  hes: { nama: "Hukum Ekonomi Syariah", sumber: ["peraturan", "fatwa", "khes", "turats", "ayat", "hadis", "literatur"], hierarki: ["Peraturan", "Fatwa dan KHES sebagai pedoman", "Dalil", "Fikih dan doktrin"], contoh: ["Akad murabahah", "Penyelesaian sengketa ekonomi syariah"], bagian: ["Isu dan batas", "Norma", "Fatwa dan pedoman", "Dalil dan fikih", "Batas temuan"], cakupan: coverage(["Daya ikat fatwa harus diperiksa pada peraturan yang menyerapnya."]) },
  htn: { nama: "Hukum Tata Negara", sumber: ["peraturan", "putusan", "literatur"], hierarki: ["Konstitusi", "Putusan pengujian", "Peraturan", "Doktrin"], contoh: ["Pengujian undang-undang", "Kewenangan lembaga negara"], bagian: ["Isu konstitusional", "Norma", "Putusan dan tafsir", "Batas temuan"], cakupan: coverage(["Metadata putusan tidak menggantikan teks pertimbangan hakim."]) },
  "hukum-keluarga": { nama: "Hukum Keluarga Islam", sumber: ["peraturan", "khi", "putusan", "turats", "ayat", "hadis", "literatur"], hierarki: ["Peraturan", "KHI sebagai pedoman", "Dalil", "Fikih"], contoh: ["Batas usia perkawinan", "Kewarisan"], bagian: ["Isu dan konteks", "Norma", "KHI dan praktik", "Dalil dan fikih", "Batas temuan"], cakupan: coverage(["KHI hanya tersedia setelah naskah resmi diimpor.", "Putusan keluarga wajib berupa salinan yang dianonimkan."]) },
  "pidana-islam": { nama: "Hukum Pidana Islam", sumber: ["peraturan", "qanun", "putusan", "turats", "ayat", "hadis", "literatur"], hierarki: ["Peraturan nasional", "Qanun sesuai wilayah berlakunya", "Dalil", "Fikih jinayah"], contoh: ["Ruang lingkup jinayat", "Hukum acara jinayat"], bagian: ["Isu dan yurisdiksi", "Norma nasional", "Qanun", "Dalil dan fikih", "Batas temuan"], cakupan: coverage(["Cakupan Qanun dan teks putusan bergantung pada sumber yang dapat diperiksa."]) },
  "perbandingan-madzhab": { nama: "Perbandingan Madzhab", sumber: ["turats", "ayat", "hadis", "literatur"], hierarki: ["Dalil", "Pendapat madzhab yang teridentifikasi", "Kajian kontemporer"], contoh: ["Kaidah الضرر يزال", "Perbedaan pendapat dalam akad"], bagian: ["Isu perbandingan", "Dalil", "Pendapat per madzhab", "Persamaan dan perbedaan", "Batas temuan"], cakupan: coverage(["Kitab yang belum dipetakan tidak diberi madzhab hasil tebakan.", "Pendapat fikih tidak dilabeli hukum positif Indonesia."]) },
} satisfies Record<string, ProfilRumpun>;
export type RumpunId = keyof typeof RUMPUN;

export const OTORITAS_SUMBER: Record<JenisTelusur, { nama: string; lapisan: string }> = {
  peraturan: { nama: "JDIH BPK RI", lapisan: "norma" }, qanun: { nama: "JDIH Aceh", lapisan: "norma" },
  putusan: { nama: "Metadata putusan resmi", lapisan: "tafsir-resmi" }, fatwa: { nama: "DSN-MUI", lapisan: "pedoman" },
  khes: { nama: "Salinan KHES yang diimpor", lapisan: "pedoman" }, khi: { nama: "Salinan KHI yang diimpor", lapisan: "pedoman" },
  ayat: { nama: "Teks Al-Quran dan terjemahan sumber", lapisan: "dalil" }, hadis: { nama: "Hadis dengan takhrij dan derajat", lapisan: "dalil" },
  turats: { nama: "Kitab dan penulis yang tercatat", lapisan: "fikih-doktrin" }, literatur: { nama: "OpenAlex, sumber sekunder", lapisan: "fikih-doktrin" },
};
