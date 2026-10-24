import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { ChatInput } from './chat.js';
/** Explicit short-lived synthetic test capture, separate from operational logs.
 * Exact full message content hash fences out any changed/private conversation.
 * Never captures tickets, keys, HTTP headers or model request context.
 */
export function syntheticAudit(input:ChatInput,raw:string|undefined,clock:()=>number=Date.now):((artifact:unknown)=>void)|undefined {
 try{
  const now=clock();
  const c=JSON.parse(raw??'null');
  if(!c||c.conversationId!==input.conversationId||c.version!==input.version||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+900000||typeof c.file!=='string'||!/^\/var\/lib\/pasla-preview\/synthetic-audit-[a-f0-9]{16}\.json$/.test(c.file))return;
  const digest=createHash('sha256').update(JSON.stringify(input.messages.map(({role,text})=>({role,text})))).digest('hex');
  if(c.messagesHash!==digest)return;
  return artifact=>{try{if(clock()>=c.expiresAt)return;const bytes=JSON.stringify({kind:'synthetic-chat-debug-v1',conversationId:input.conversationId,turnId:input.turnId,version:input.version,artifact});if(Buffer.byteLength(bytes)<=100000)writeFileSync(c.file,bytes,{flag:'wx',mode:0o600});}catch{/* Debug capture never changes delivery or invokes a model. */}};
 }catch{return;}
}
