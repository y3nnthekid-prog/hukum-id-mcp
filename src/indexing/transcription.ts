import { z } from 'zod';
import { contentHash } from '../core/passages.js';
import { inspectKhiBooks } from './import.js';

const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const Transcription=z.object({
  v:z.literal(1),sourceHash:Hash,sourcePages:z.tuple([z.number().int().min(1),z.number().int().max(600)]),
  pages:z.array(z.object({halaman:z.number().int().min(1).max(600),teks:z.string().min(1).max(30000),imageHash:Hash}).strict()).min(1).max(600),
  reviews:z.array(z.object({pass:z.union([z.literal(1),z.literal(2)]),reviewer:z.string().trim().min(1).max(120),reviewedAt:z.iso.datetime(),textHash:Hash,sourceHash:Hash,issues:z.array(z.string().max(500)).max(100)}).strict()).length(2),
}).strict();

export type TranscriptionProvenance={sourceHash:string;transcriptionHash:string;sourcePages:[number,number];reviewKind:'telaah AI berbasis sumber';reviews:Array<{pass:1|2;reviewer:string;reviewedAt:string}>};

/** Pemeriksaan ini memvalidasi catatan kurasi, bukan membuktikan penelaah membaca gambar. */
export function validateTranscription(raw:unknown,sourceHash:string,totalPages:number,khi:boolean) {
  const data=Transcription.parse(raw);
  if(data.sourceHash!==sourceHash)throw Error('TRANSCRIPTION_SOURCE_HASH');
  const [first,last]=data.sourcePages;
  if(last<first||last>totalPages||data.pages.length!==last-first+1||data.pages.some((page,i)=>page.halaman!==first+i))throw Error('TRANSCRIPTION_PAGE_COVERAGE');
  const textHash=contentHash(JSON.stringify(data.pages));
  if(new Set(data.reviews.map(r=>r.pass)).size!==2||data.reviews.some(r=>r.textHash!==textHash||r.sourceHash!==sourceHash||r.issues.length))throw Error('TRANSCRIPTION_REVIEW_HASH_OR_UNRESOLVED');
  const pages=data.pages.map(({halaman,teks})=>({halaman,teks}));
  if(khi)inspectKhiBooks(pages);
  const provenance:TranscriptionProvenance={sourceHash,transcriptionHash:contentHash(JSON.stringify(data)),sourcePages:data.sourcePages,reviewKind:'telaah AI berbasis sumber',reviews:data.reviews.map(({pass,reviewer,reviewedAt})=>({pass,reviewer,reviewedAt}))};
  return {pages,provenance};
}
