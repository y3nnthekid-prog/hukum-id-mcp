import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { setTimeout as delay } from 'node:timers/promises';
import { syntheticAudit } from '../core/chat-audit.js';
import { ChatInputSchema, runChat } from '../core/chat.js';
import { verifyAnyChatTicket, type ChatTicket, type TanyaTicket } from '../core/chat-ticket.js';
import { createAzureModel, createAzureTanyaModel, TANYA_PRICE } from '../ai/azure.js';
import { runTanya } from '../core/tanya.js';
import type { TanyaLedger } from '../core/tanya-ledger.js';
import type { createManagedClaims } from '../core/managed-ai.js';
import type { JsonModel } from '../ai/json-model.js';
import type { Signer } from '../core/sign.js';
import type { TelusurService } from '../core/telusur.js';
import type { SumberService } from '../core/sumber.js';

export type ChatEngine={key:string;claims:ReturnType<typeof createManagedClaims>;rpm:number;tpm:number};
export type TanyaEngine={key:string;ledger:TanyaLedger;monitorToken?:string|undefined};
// Worst case for one call: 40k input bytes (>= tokens) and 4096 output tokens.
export const TANYA_RESERVE_MICRO=Math.ceil(40000*TANYA_PRICE.inputMicroPerToken+4096*TANYA_PRICE.outputMicroPerToken);
const tanyaCost=(input:number,output:number)=>Math.ceil(input*TANYA_PRICE.inputMicroPerToken+output*TANYA_PRICE.outputMicroPerToken);
type Env={Variables:{traceId:string;userId:string|null}};
export function registerChat(app:Hono<Env>,deps:{chat?:ChatEngine|undefined;tanya?:TanyaEngine|undefined;stepTickets?:{secret:string;audience:string}|undefined;telusur?:TelusurService|undefined;sumber?:SumberService|undefined;signer?:Signer|undefined}) {
 app.get('/v2/chat/status',c=>{c.header('cache-control','no-store');const ready=!!(deps.chat&&deps.stepTickets&&deps.telusur&&deps.sumber&&deps.signer),cooldown=deps.chat?.claims.cooldownUntil()??0;
  const services=!!(deps.stepTickets&&deps.telusur&&deps.sumber&&deps.signer),tanya=deps.tanya&&services?deps.tanya.ledger.status():null;
  return c.json({available:ready&&cooldown<=Math.floor(Date.now()/1000),...(ready&&cooldown>Math.floor(Date.now()/1000)?{nextAllowedAt:cooldown}:{}),...(tanya?{tanya:{available:tanya.nextAllowedAt===null&&tanya.dayRemainingMicro>=TANYA_RESERVE_MICRO&&tanya.monthRemainingMicro>=TANYA_RESERVE_MICRO,nextAllowedAt:tanya.nextAllowedAt,
   // Sisa anggaran hanya untuk pemantau yang membawa token rahasia.
   ...(deps.tanya?.monitorToken&&c.req.header('x-pasla-pemantau')===deps.tanya.monitorToken?{dayRemainingMicro:tanya.dayRemainingMicro,monthRemainingMicro:tanya.monthRemainingMicro}:{})}}:{})});});
 app.post('/v2/chat/turn',async c=>{
  if(!(deps.chat||deps.tanya)||!deps.stepTickets||!deps.telusur||!deps.sumber||!deps.signer)return c.json({error:{code:'CHAT_DISABLED'}},503);
  let size=0;const chunks:Uint8Array[]=[];const reader=c.req.raw.body?.getReader();
  if(!reader)return c.json({error:{code:'CHAT_INPUT'}},422);
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>30000){await reader.cancel();return c.json({error:{code:'CHAT_SIZE'}},413);}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  let input:ReturnType<typeof ChatInputSchema.parse>;let anyTicket:ChatTicket|TanyaTicket;
  try{input=ChatInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));anyTicket=verifyAnyChatTicket(c.req.header('x-pasla-chat-ticket')??'',deps.stepTickets.secret,deps.stepTickets.audience,input);}catch{return c.json({error:{code:'CHAT_TICKET'}},401);}
  const signer=deps.signer,telusur=deps.telusur,sumber=deps.sumber;
  if(anyTicket.v===4){
   const tanya=deps.tanya;if(!tanya)return c.json({error:{code:'CHAT_DISABLED'}},503);
   return tanyaTurn(c,{input,ticket:anyTicket,tanya,signer,telusur,sumber});
  }
  const config=deps.chat;if(!config)return c.json({error:{code:'CHAT_DISABLED'}},503);
  const ticket=anyTicket;
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
     try{return await azure.model.generate({...request,signal});}finally{const summary=azure.summary(),usage=summary.usage;inputTokens+=usage.reduce((n,row)=>n+row.prompt_tokens,0);outputTokens+=usage.reduce((n,row)=>n+row.completion_tokens,0);if(summary.lastFailure){failureCode=summary.lastFailure;issues=summary.validationIssues;}if(summary.lastFailure==='HTTP_429')config.claims.deferUntil(Math.floor(Date.now()/1000)+(summary.retryAfterSeconds??60));if(summary.lastFailure===null||summary.lastFailure?.startsWith('HTTP_'))config.claims.finish(jti);}
    }};
    const result=await runChat(input,{audit:syntheticAudit(input,process.env.PASLA_CHAT_SYNTHETIC_AUDIT),model,telusur,sumber,signer,keys:[signer.publicKeyPem],signal,progress:stage=>{phase=stage;return send({type:'progress',stage}).then(()=>undefined);}});
    const usage={calls,inputTokens,outputTokens,elapsedMs:Date.now()-start};
    const receipt={v:1,kind:'chat_usage',profile:ticket.profile,campaign:ticket.campaign,conversationId:input.conversationId,turnId:input.turnId,version:input.version,inputHash:ticket.inputHash,...usage};
    await send({type:'result',data:result,usage,usageReceipt:{...receipt,tanda:signer.sign(receipt)}});
   }catch(cause){if(signal.aborted)failureCode='CHAT_INTERRUPTED';else if(cause instanceof Error&&['CHAT_WIRE_LIMIT','CHAT_CONTEXT_LIMIT','CHAT_WHOLE_QUOTE','CHAT_SOURCE_READING','CHAT_FACTS_SOURCE','MANAGED_BUSY','MANAGED_RATE','MANAGED_REPLAY'].includes(cause.message))failureCode=cause.message;
    console.warn(JSON.stringify({event:'chat_turn_failed',turnId:input.turnId,phase,code:failureCode,issues,calls,inputTokens,outputTokens,elapsedMs:Date.now()-start}));
    await send({type:'error',code:failureCode,...(failureCode==='HTTP_429'?{nextAllowedAt:config.claims.nextAllowedAt()}:{}),usage:{calls,inputTokens,outputTokens,elapsedMs:Date.now()-start}}).catch(()=>undefined);}
   finally{clearInterval(heartbeat);}
  },async()=>undefined);
 });
}

type TanyaTurn={input:ReturnType<typeof ChatInputSchema.parse>;ticket:TanyaTicket;tanya:TanyaEngine;signer:Signer;telusur:TelusurService;sumber:SumberService};
/** One public answer. The ledger is touched only when the model is actually called. */
function tanyaTurn(c:any,{input,ticket,tanya,signer,telusur,sumber}:TanyaTurn){
 c.header('content-type','application/x-ndjson');c.header('cache-control','no-store');
 return stream(c,async output=>{
  const abort=new AbortController();output.onAbort(()=>abort.abort());
  const signal=AbortSignal.any([c.req.raw.signal,abort.signal,AbortSignal.timeout(180000)]);
  const send=(event:unknown)=>output.write(JSON.stringify(event)+'\n');
  let calls=0,inputTokens=0,outputTokens=0,costMicro=0,failureCode='CHAT_FAILED',phase='searching';const start=Date.now();
  const heartbeat=setInterval(()=>{void send({type:'progress',stage:'working'}).catch(()=>abort.abort());},10000);
  const usage=()=>({calls,inputTokens,outputTokens,costMicro,elapsedMs:Date.now()-start});
  const receipt=()=>{const body={v:2,kind:'tanya_usage',profile:ticket.profile,conversationId:input.conversationId,turnId:input.turnId,version:input.version,inputHash:ticket.inputHash,...usage()};return {...body,tanda:signer.sign(body)};};
  try{
   const azure=createAzureTanyaModel({apiKey:tanya.key,maxUsd:1,maxInputTokens:40000});
   const model:JsonModel={provider:azure.model.provider,model:azure.model.model,async generate(request){
    signal.throwIfAborted();if(calls>=1)throw new Error('CHAT_CALL_LIMIT');
    tanya.ledger.admit(ticket.jti,TANYA_RESERVE_MICRO);calls++;
    try{return await azure.model.generate({...request,signal});}
    finally{
     const summary=azure.summary();
     inputTokens=summary.usage.reduce((n,row)=>n+row.prompt_tokens,0);outputTokens=summary.usage.reduce((n,row)=>n+row.completion_tokens,0);
     if(summary.lastFailure)failureCode=summary.lastFailure;
     if(summary.lastFailure==='HTTP_429')tanya.ledger.deferUntil(Math.floor(Date.now()/1000)+(summary.retryAfterSeconds??60));
     // Measured usage settles exactly. A rejected HTTP call is not billed; an unknown network outcome keeps the full hold.
     // Tidak pernah dikirim (mis. batas input lokal) atau ditolak HTTP: tidak ditagih. Hasil jaringan tak pasti: tahan penuh.
     costMicro=summary.usage.length?tanyaCost(inputTokens,outputTokens):summary.calls===0||summary.lastFailure?.startsWith('HTTP_')?0:TANYA_RESERVE_MICRO;
     tanya.ledger.settle(ticket.jti,costMicro);
    }
   }};
   // Penuh, sibuk atau dibatasi: tolak sebelum mencari sumber supaya pengguna tidak menunggu sia-sia.
   const penolakan=tanya.ledger.precheck(TANYA_RESERVE_MICRO);if(penolakan)throw new Error(penolakan);
   const result=await runTanya(input,{model,telusur,sumber,signer,keys:[signer.publicKeyPem],signal,progress:stage=>{phase=stage;return send({type:'progress',stage}).then(()=>undefined);}});
   await send({type:'result',data:result,usage:usage(),usageReceipt:receipt()});
  }catch(cause){
   if(signal.aborted)failureCode='CHAT_INTERRUPTED';else if(cause instanceof Error&&/^(?:TANYA_|CHAT_)/.test(cause.message))failureCode=cause.message;
   console.warn(JSON.stringify({event:'tanya_turn_failed',turnId:input.turnId,phase,code:failureCode,...usage()}));
   await send({type:'error',code:failureCode,usage:usage(),usageReceipt:receipt(),...(failureCode==='TANYA_RATE'||failureCode==='HTTP_429'?{nextAllowedAt:tanya.ledger.status().nextAllowedAt}:{})}).catch(()=>undefined);
  }finally{clearInterval(heartbeat);}
 },async()=>undefined);
}
