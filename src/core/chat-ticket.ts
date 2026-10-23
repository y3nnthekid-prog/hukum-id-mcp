import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requestHash } from './step-ticket.js';

const Id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const Schema=z.object({v:z.literal(3),iss:z.literal('https://riset.pasla.pages.dev'),aud:z.string().url(),sub:Id,conversationId:Id,turnId:Id,inputHash:z.string().regex(/^[a-f0-9]{64}$/),profile:z.literal('pasla-chat-low4096-v1'),campaign:z.literal('chat-preview-20261023'),maxCalls:z.literal(3),maxInputTokens:z.literal(20000),maxOutputTokens:z.literal(4096),jti:z.string().regex(/^[\w-]{43}$/),iat:z.number().int(),exp:z.number().int()}).strict();
export type ChatTicket=z.infer<typeof Schema>;
export function verifyChatTicket(encoded:string,secret:string,aud:string,input:{conversationId:string;turnId:string},clock=()=>Math.floor(Date.now()/1000)) {
 if(secret.length<43||encoded.length>2500)throw new Error('CHAT_TICKET');
 const parts=encoded.split('.');if(parts.length!==2||parts.some(p=>! /^[\w-]+$/.test(p)))throw new Error('CHAT_TICKET');
 const expected=createHmac('sha256',secret).update(parts[0]!).digest();const actual=Buffer.from(parts[1]!,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('CHAT_TICKET');
 const t=Schema.parse(JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8')));const now=clock();
 if(t.aud!==aud||t.inputHash!==requestHash(input)||t.conversationId!==input.conversationId||t.turnId!==input.turnId||t.exp<=now||t.iat>now+5||t.exp-t.iat>360||t.exp<=t.iat)throw new Error('CHAT_TICKET');return t;
}
