import { z } from "zod";

/** Rejeksikan salah ejaan agar status/kelengkapan tidak hilang diam-diam saat impor. */
export const CorpusManifest = z.object({
  id: z.string().min(1).max(100),
  jenis: z.enum(["khi", "khes", "qanun", "peraturan", "putusan-mk", "putusan-ma"]),
  judul: z.string().min(4).max(500),
  rujukan: z.string().min(2).max(120),
  sourceUrl: z.url(),
  retrievedAt: z.iso.datetime(),
  importedBy: z.string().min(1).max(100),
  file: z.string().min(1),
  root: z.string().min(1).optional(),
  anonim: z.boolean().optional(),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  diubahDengan: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  dicabutDengan: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  complete: z.boolean().optional(),
  madzhab: z.string().trim().min(1).max(100).optional(),
}).strict();
