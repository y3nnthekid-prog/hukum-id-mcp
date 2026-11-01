import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requestHash } from './step-ticket.js';

const Id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const Schema=z.object({v:z.literal(3),iss:z.literal('https://riset.pasla.pages.dev'),aud:z.string().url(),sub:Id,conversationId:Id,turnId:Id,inputHash:z.string().regex(/^[a-f0-9]{64}$/),profile:z.literal('pasla-chat-low4096-v1'),campaign:z.literal('chat-preview-20261023'),maxCalls:z.literal(3),maxInputTokens:z.literal(20000),maxOutputTokens:z.literal(4096),jti:z.string().regex(/^[\w-]{43}$/),iat:z.number().int(),exp:z.number().int()}).strict();
// Public Tanya: one GPT-5.1 call per answer. Budgets live in the web and engine ledgers, not in the ticket.
const TanyaSchema=z.object({v:z.literal(4),iss:z.enum(['https://pasla.tech','https://riset.pasla.pages.dev']),aud:z.string().url(),sub:Id,conversationId:Id,turnId:Id,inputHash:z.string().regex(/^[a-f0-9]{64}$/),profile:z.literal('pasla-tanya-v1'),jti:z.string().regex(/^[\w-]{43}$/),iat:z.number().int(),exp:z.number().int()}).strict();
export type ChatTicket=z.infer<typeof Schema>;
export type TanyaTicket=z.infer<typeof TanyaSchema>;
function verifyAny(encoded:string,secret:string,aud:string,input:{conversationId:string;turnId:string},clock:()=>number) {
 if(secret.length<43||encoded.length>2500)throw new Error('CHAT_TICKET');
 const parts=encoded.split('.');if(parts.length!==2||parts.some(p=>! /^[\w-]+$/.test(p)))throw new Error('CHAT_TICKET');
 const expected=createHmac('sha256',secret).update(parts[0]!).digest();const actual=Buffer.from(parts[1]!,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('CHAT_TICKET');
 const raw=JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8'));
 const t:ChatTicket|TanyaTicket=raw?.v===4?TanyaSchema.parse(raw):Schema.parse(raw);const now=clock();
 if(t.aud!==aud||t.inputHash!==requestHash(input)||t.conversationId!==input.conversationId||t.turnId!==input.turnId||t.exp<=now||t.iat>now+5||t.exp-t.iat>360||t.exp<=t.iat)throw new Error('CHAT_TICKET');return t;
}
export function verifyChatTicket(encoded:string,secret:string,aud:string,input:{conversationId:string;turnId:string},clock=()=>Math.floor(Date.now()/1000)):ChatTicket {
 const t=verifyAny(encoded,secret,aud,input,clock);if(t.v!==3)throw new Error('CHAT_TICKET');return t;
}
/** Tiket v4 untuk membaca hasil giliran yang sudah selesai. Isi pertanyaan tidak ikut dikirim,
 * jadi yang dicocokkan: tanda HMAC, audiens, masa berlaku, dan turnId; inputHash dicocokkan ke hasil tersimpan. */
export function verifyTanyaReadTicket(encoded:string,secret:string,aud:string,turnId:string,clock=()=>Math.floor(Date.now()/1000)):TanyaTicket {
 if(secret.length<43||encoded.length>2500)throw new Error('CHAT_TICKET');
 const parts=encoded.split('.');if(parts.length!==2||parts.some(p=>! /^[\w-]+$/.test(p)))throw new Error('CHAT_TICKET');
 const expected=createHmac('sha256',secret).update(parts[0]!).digest();const actual=Buffer.from(parts[1]!,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('CHAT_TICKET');
 const t=TanyaSchema.parse(JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8')));const now=clock();
 if(t.aud!==aud||t.turnId!==turnId||t.exp<=now||t.iat>now+5||t.exp-t.iat>360)throw new Error('CHAT_TICKET');return t;
}
export function verifyAnyChatTicket(encoded:string,secret:string,aud:string,input:{conversationId:string;turnId:string},clock=()=>Math.floor(Date.now()/1000)) {
 return verifyAny(encoded,secret,aud,input,clock);
}
