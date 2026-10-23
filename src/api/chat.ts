import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { setTimeout as delay } from 'node:timers/promises';
import { ChatInputSchema, runChat } from '../core/chat.js';
import { verifyChatTicket } from '../core/chat-ticket.js';
import { createAzureModel } from '../ai/azure.js';
import type { createManagedClaims } from '../core/managed-ai.js';
import type { JsonModel } from '../ai/json-model.js';
import type { Signer } from '../core/sign.js';
import type { TelusurService } from '../core/telusur.js';
import type { SumberService } from '../core/sumber.js';

export type ChatEngine={key:string;claims:ReturnType<typeof createManagedClaims>;rpm:number;tpm:number};
type Env={Variables:{traceId:string;userId:string|null}};
export function registerChat(app:Hono<Env>,deps:{chat?:ChatEngine|undefined;stepTickets?:{secret:string;audience:string}|undefined;telusur?:TelusurService|undefined;sumber?:SumberService|undefined;signer?:Signer|undefined}) {
 app.post('/v2/chat/turn',async c=>{
  const config=deps.chat;
  if(!config||!deps.stepTickets||!deps.telusur||!deps.sumber||!deps.signer)return c.json({error:{code:'CHAT_DISABLED'}},503);
  let size=0;const chunks:Uint8Array[]=[];const reader=c.req.raw.body?.getReader();
  if(!reader)return c.json({error:{code:'CHAT_INPUT'}},422);
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>30000){await reader.cancel();return c.json({error:{code:'CHAT_SIZE'}},413);}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  let input:ReturnType<typeof ChatInputSchema.parse>;let ticket:ReturnType<typeof verifyChatTicket>;
  try{input=ChatInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));ticket=verifyChatTicket(c.req.header('x-pasla-chat-ticket')??'',deps.stepTickets.secret,deps.stepTickets.audience,input);}catch{return c.json({error:{code:'CHAT_TICKET'}},401);}
  const signer=deps.signer,telusur=deps.telusur,sumber=deps.sumber;
  c.header('content-type','application/x-ndjson');c.header('cache-control','no-store');
  return stream(c,async output=>{
   const abort=new AbortController();output.onAbort(()=>abort.abort());
   const signal=AbortSignal.any([c.req.raw.signal,abort.signal,AbortSignal.timeout(330000)]);
   const send=(event:unknown)=>output.write(JSON.stringify(event)+'\n');
   let calls=0;let inputTokens=0,outputTokens=0;const start=Date.now();let phase='understanding';let failureCode='CHAT_FAILED';let issues:unknown[]=[];
   const heartbeat=setInterval(()=>{void send({type:'progress',stage:'working'}).catch(()=>abort.abort());},10000);
   try{
    const model:JsonModel={provider:'openai',model:'azure:pasla-chat:gpt-5-mini:2025-08-07:low-4096',async generate(request){
     signal.throwIfAborted();if(calls>=ticket.maxCalls)throw new Error('CHAT_CALL_LIMIT');
     const wait=Math.max(0,config.claims.nextAllowedAt()*1000-Date.now());
     if(wait){await send({type:'progress',stage:'waiting',nextAllowedAt:config.claims.nextAllowedAt()});await delay(wait,undefined,{signal});}
     const jti=calls===0?ticket.jti:createHash('sha256').update(`${ticket.jti}:${calls}`).digest('base64url');
     // Conservative reservation includes the full 20k input and 4096 output per call.
     const interval=Math.max(1,Math.ceil(60/config.rpm),Math.ceil(24096*60/config.tpm));
     config.claims.claim(jti,Math.floor(Date.now()/1000)+120,interval);calls++;
     const azure=createAzureModel({apiKey:config.key,maxUsd:1,maxCalls:1,maxInputTokens:20000,profile:'low-4096'});
     try{return await azure.model.generate({...request,signal});}finally{const summary=azure.summary(),usage=summary.usage;inputTokens+=usage.reduce((n,row)=>n+row.prompt_tokens,0);outputTokens+=usage.reduce((n,row)=>n+row.completion_tokens,0);if(summary.lastFailure){failureCode=summary.lastFailure;issues=summary.validationIssues;}if(summary.lastFailure===null||summary.lastFailure?.startsWith('HTTP_'))config.claims.finish(jti);}
    }};
    const result=await runChat(input,{model,telusur,sumber,signer,keys:[signer.publicKeyPem],signal,progress:stage=>{phase=stage;return send({type:'progress',stage}).then(()=>undefined);}});
    await send({type:'result',data:result,usage:{calls,inputTokens,outputTokens,elapsedMs:Date.now()-start}});
   }catch(cause){if(signal.aborted)failureCode='CHAT_INTERRUPTED';else if(cause instanceof Error&&['CHAT_WIRE_LIMIT','CHAT_CONTEXT_LIMIT','MANAGED_BUSY','MANAGED_RATE','MANAGED_REPLAY'].includes(cause.message))failureCode=cause.message;
    console.warn(JSON.stringify({event:'chat_turn_failed',turnId:input.turnId,phase,code:failureCode,issues,calls,inputTokens,outputTokens,elapsedMs:Date.now()-start}));
    await send({type:'error',code:failureCode,usage:{calls,inputTokens,outputTokens,elapsedMs:Date.now()-start}}).catch(()=>undefined);}
   finally{clearInterval(heartbeat);}
  },async()=>undefined);
 });
}
