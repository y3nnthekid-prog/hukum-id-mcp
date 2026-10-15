import { z } from "zod";

/**
 * Skema set uji baku enam rumpun.
 *
 * Setiap butir menyimpan pertanyaan, asal topiknya, perilaku yang diharapkan, dan rujukan yang
 * WAJIB ditemukan. Rujukan wajib diverifikasi ke sumber primer lewat hukum-id pada tanggal yang
 * dicatat, bukan ditulis dari ingatan.
 */
export const RumpunSchema = z.enum([
  "ilmu-hukum",
  "hes",
  "htn",
  "hukum-keluarga",
  "pidana-islam",
  "perbandingan-madzhab",
]);

const RegulationRef = z.string().regex(/^[A-Za-z][A-Za-z ]{0,30} \d{1,4}\/\d{4}$/, "bentuk 'UU 1/1974'");
const ArticleRef = z.string().regex(/^Pasal \d{1,4}[A-Z]?$/, "bentuk 'Pasal 7'");

export const RujukanSchema = z.discriminatedUnion("jenis", [
  z.object({
    jenis: z.literal("peraturan"),
    rujukan: RegulationRef,
    pasal: ArticleRef.optional(),
    // Status menurut JDIH BPK pada tanggal verifikasi, mis. "Berlaku" atau "Tidak Berlaku".
    status: z.string().min(1),
    bpk_id: z.string().regex(/^\d+$/).optional(),
    diubah_dengan: z.array(RegulationRef).default([]),
  }),
  z.object({ jenis: z.literal("fatwa"), nomor: z.string().regex(/^\d{2,3}\/DSN-MUI\/[IVX]+\/\d{4}$/) }),
  z.object({ jenis: z.literal("khes"), pasal: ArticleRef }),
  z.object({ jenis: z.literal("khi"), pasal: ArticleRef }),
  z.object({ jenis: z.literal("qanun"), rujukan: RegulationRef, pasal: ArticleRef.optional() }),
  z.object({
    jenis: z.literal("ayat"),
    surah: z.number().int().min(1).max(114),
    ayat: z.union([z.number().int().positive(), z.string().regex(/^\d+-\d+$/)]),
  }),
  z.object({ jenis: z.literal("hadis"), id: z.string().min(1), derajat: z.string().min(1) }),
  z.object({
    jenis: z.literal("turats"),
    book_id: z.number().int().positive(),
    kitab: z.string().min(1),
    madzhab: z.enum(["hanafi", "maliki", "syafii", "hanbali", "muqaran", "lainnya"]),
  }),
  z.object({ jenis: z.literal("putusan-mk"), nomor: z.string().regex(/^\d{1,4}\/PUU-[IVXL]+\/\d{4}$/) }),
  z.object({ jenis: z.literal("literatur"), doi: z.string().min(1) }),
]);

export const ButirSchema = z.object({
  id: z.string().regex(/^[a-z-]+-\d{3}$/),
  rumpun: RumpunSchema,
  pertanyaan: z.string().min(12).max(600),
  topik: z.string().min(3),
  // Dari mana topik ini berasal, mis. "topik baku mata kuliah Fikih Munakahat". Butir tidak
  // disalin dari soal ujian yang berhak cipta.
  asal: z.string().min(3),
  harapan: z.enum(["jawab", "abstain", "koreksi"]),
  jebakan: z
    .enum(["nomor-palsu", "pasal-tidak-ada", "uu-dicabut", "fatwa-diklaim-mengikat", "putusan-palsu"])
    .optional(),
  rujukan_wajib: z.array(RujukanSchema),
  verifikasi: z.object({
    tanggal: z.string().date(),
    alat: z.array(z.string().min(1)).min(1),
    catatan: z.string().default(""),
  }),
  tertahan: z.boolean().default(false),
});

export const BerkasSetSchema = z.object({
  versi: z.literal(1),
  butir: z.array(ButirSchema).min(1),
});

export type Butir = z.infer<typeof ButirSchema>;
export type Rujukan = z.infer<typeof RujukanSchema>;
