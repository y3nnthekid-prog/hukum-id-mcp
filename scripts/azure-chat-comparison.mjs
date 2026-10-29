import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,chmod,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export const COMPARISON_PROFILES=Object.freeze({gpt51:{holdMicro:197880,deployment:'pasla-compare-51'},mini:{holdMicro:39576,deployment:'pasla-chat'}});
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function fingerprintRelease(root){
 const hash=createHash('sha256');let bytes=0,files=0;
 const add=async name=>{const data=await readFile(root+'/'+name);bytes+=data.length;if(++files>2000||bytes>20000000)throw Error('COMPARISON_BUILD_SIZE');hash.update(name+'\0').update(data).update('\0');};
 const walk=async name=>{for(const item of (await readdir(root+'/'+name,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){if(item.isSymbolicLink())throw Error('COMPARISON_BUILD_LINK');if(item.isDirectory())await walk(name+'/'+item.name);else if(item.isFile())await add(name+'/'+item.name);}};
 await walk('dist');for(const name of ['package.json','package-lock.json','pdf-profile.json'])await add(name);return hash.digest('hex');
}
export function validateReservation(r,freezeHash,revision,buildHash,runnerHash){
 const profile=COMPARISON_PROFILES[r?.profile];
 if(!profile||r.v!==1||r.kind!=='pasla-operator-comparison'||r.status!=='confirmed'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(r.id??'')||r.campaign!=='chat-preview-20261023'||r.maxCalls!==3||r.maxInputTokens!==20000||r.maxOutputTokens!==4096||r.holdMicro!==profile.holdMicro||r.freezeHash!==freezeHash||r.revision!==revision||!/^[a-f0-9]{7}$/.test(revision)||r.caseId!=='belanja-01'||!Number.isFinite(Date.parse(r.confirmedAt))||! /^[a-f0-9]{64}$/.test(buildHash??'')||! /^[a-f0-9]{64}$/.test(runnerHash??'')||r.buildHash!==buildHash||r.runnerHash!==runnerHash)throw Error('COMPARISON_AUTHORIZATION');
 for(const name of ['reserved_micro','reserved_calls','gross_reserved_calls'])if(!Number.isSafeInteger(r.before?.[name])||!Number.isSafeInteger(r.after?.[name]))throw Error('COMPARISON_COUNTERS');
 if(r.before.reserved_micro<0||r.before.reserved_calls<0||r.before.gross_reserved_calls<r.before.reserved_calls||r.after.reserved_micro!==r.before.reserved_micro+r.holdMicro||r.after.reserved_calls!==r.before.reserved_calls+3||r.after.gross_reserved_calls!==r.before.gross_reserved_calls+3||r.after.reserved_micro>10000000||r.after.reserved_calls>300||r.after.gross_reserved_calls>300)throw Error('COMPARISON_COUNTERS');
 return profile;
}
/** A confirmed reservation authorizes exactly its own permanent trial ID.
 * Claim rows never expire; a crash or failed result cannot reissue the trial. */
export function claimTrial(db,r,manifestHash,time){
 validateReservation(r,r.freezeHash,r.revision,r.buildHash,r.runnerHash);
 // A renamed/copied receipt is still the same financial allocation. Mutable
 // trial IDs, timestamps, fixture paths and signatures cannot create new credit.
 const allocation=digest(JSON.stringify([r.campaign,...['reserved_micro','reserved_calls','gross_reserved_calls'].flatMap(name=>[r.before[name],r.after[name]])]));
 db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS comparison_trials(id TEXT PRIMARY KEY,allocation_hash TEXT NOT NULL UNIQUE,manifest_hash TEXT NOT NULL UNIQUE,profile TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('claimed','completed','failed')),calls INTEGER NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 3))");
 db.exec('BEGIN IMMEDIATE');
 try{db.prepare("INSERT INTO comparison_trials(id,allocation_hash,manifest_hash,profile,created_at,state) VALUES(?,?,?,?,?,'claimed')").run(r.id,allocation,manifestHash,r.profile,time);db.exec('COMMIT');}
 catch{db.exec('ROLLBACK');throw Error('COMPARISON_REPLAY');}
}

async function main(){
 const [mode,receiptFile,freezeFile,release]=process.argv.slice(2);
 if(mode!=='--run'||!/^\/opt\/pasla-preview\/releases\/[a-f0-9]{7}$/.test(release??''))throw Error('COMPARISON_ARGS');
 const revision=release.split('/').at(-1),receiptBytes=await readFile(receiptFile),freezeBytes=await readFile(freezeFile);
 if(receiptBytes.length>5000||freezeBytes.length>500000)throw Error('COMPARISON_SIZE');
 const receipt=JSON.parse(receiptBytes),frozen=JSON.parse(freezeBytes);validateReservation(receipt,digest(freezeBytes),revision,await fingerprintRelease(release),digest(await readFile(new URL(import.meta.url))));
 if(frozen.v!==1||frozen.kind!=='synthetic-chat-comparison-freeze'||frozen.case!==receipt.caseId||frozen.date!==new Date().toISOString().slice(0,10)||frozen.input?.messages?.length!==1||frozen.input.messages[0].role!=='user'||!Array.isArray(frozen.serviceLog)||frozen.serviceLog.length!==8)throw Error('COMPARISON_FREEZE');
 const load=path=>import(pathToFileURL(release+'/dist/'+path).href);
 const [{runChat,ChatInputSchema},{createAzureComparisonModel,createAzureModel,publicPilotPin},{createSigner,generateSigningKey,canonicalJson},{createManagedClaims}]=await Promise.all([load('core/chat.js'),load('ai/azure.js'),load('core/sign.js'),load('core/managed-ai.js')]);
 publicPilotPin(frozen.publicKey);
 const input=ChatInputSchema.parse({...frozen.input,turnId:receipt.id});
 const environment=await readFile('/etc/pasla-preview-managed.env','utf8');
 const value=name=>{const row=environment.split(/\r?\n/).find(line=>line.startsWith(name+'='));if(!row)throw Error('COMPARISON_ENV');const raw=row.slice(name.length+1);return raw.replace(/^(['"])(.*)\1$/u,'$2');};
 const key=value('PASLA_AZURE_OPENAI_KEY'),claimsPath=value('PASLA_MANAGED_CLAIMS_FILE');
 if(claimsPath!=='/var/lib/pasla-preview/managed-claims.sqlite')throw Error('COMPARISON_GATE');
 const directory='/var/lib/pasla-preview/comparison';await mkdir(directory,{recursive:true,mode:0o700});
 const dbFile=directory+'/trials.sqlite',db=new DatabaseSync(dbFile,{allowExtension:false});await chmod(dbFile,0o600);
 claimTrial(db,receipt,digest(receiptBytes),Math.floor(Date.now()/1000));
 const claims=createManagedClaims(claimsPath),signal=AbortSignal.timeout(330000),start=Date.now(),signer=createSigner(generateSigningKey());
 const factory=receipt.profile==='gpt51'?createAzureComparisonModel:createAzureModel;
 const azure=factory({apiKey:key,maxUsd:receipt.holdMicro/1e6,maxCalls:3,maxInputTokens:20000,...(receipt.profile==='mini'?{profile:'low-4096'}:{})});
 let stage=0,sourceIndex=0,answer=null,audit=null,failure=null;const stageHashes=[];
 const service=(path,body)=>{const row=frozen.serviceLog[sourceIndex++];if(!row||row.path!==path||canonicalJson(row.body)!==canonicalJson(body))throw Error('COMPARISON_SOURCE_ORDER');return row.data;};
 const model={provider:azure.model.provider,model:azure.model.model,async generate(request){
  stage++;if(stage===1)return request.schema.parse(frozen.plan);
  if(sourceIndex!==frozen.serviceLog.length)throw Error('COMPARISON_SOURCE_INCOMPLETE');
  stageHashes.push({stage,sha256:digest(canonicalJson({system:request.system,user:request.user,schema:request.schema.toJSONSchema()}))});
  const wait=Math.max(0,claims.nextAllowedAt()*1000-Date.now());if(wait>60000)throw Error('COMPARISON_QUEUE');if(wait)await delay(wait,undefined,{signal});
  signal.throwIfAborted();const next=db.prepare("SELECT calls FROM comparison_trials WHERE id=? AND state='claimed'").get(receipt.id);
  if(!next||next.calls>=3)throw Error('COMPARISON_CALLS');
  const jti=createHash('sha256').update(receipt.id+':'+next.calls).digest('base64url');
  claims.claim(jti,Math.floor(Date.now()/1000)+120,Math.max(1,Math.ceil(24096*60/100000)));
  const slot=db.prepare("UPDATE comparison_trials SET calls=calls+1 WHERE id=? AND state='claimed' AND calls=? AND calls<3 RETURNING calls").get(receipt.id,next.calls);
  if(!slot)throw Error('COMPARISON_SLOT');
  try{return await azure.model.generate({...request,signal});}
  finally{const summary=azure.summary();if(summary.lastFailure==='HTTP_429')claims.deferUntil(Math.floor(Date.now()/1000)+(summary.retryAfterSeconds??60));if(summary.lastFailure===null||summary.lastFailure?.startsWith('HTTP_'))claims.finish(jti);}
 }};
 try{answer=await runChat(input,{model,signer,keys:[frozen.publicKey],signal,progress:async()=>{},audit:value=>{audit=value;},telusur:async body=>service('/v2/telusur',body),sumber:{buka:async ref=>service('/v2/sumber/potongan',{rujukan:[ref]})[0]}});}
 catch{failure=azure.summary().lastFailure??(signal.aborted?'INTERRUPTED':'COMPARISON_LOCAL_FAILURE');}
 const artifact={v:1,kind:'operator-comparison-diagnostic',id:receipt.id,profile:receipt.profile,revision,caseId:receipt.caseId,freezeHash:receipt.freezeHash,reservedSlots:3,holdMicro:receipt.holdMicro,actual:azure.summary(),elapsedMs:Date.now()-start,stageHashes,failure,answer,audit,diagnosticPublicKey:signer.publicKeyPem,acceptance:'Not owner-session acceptance; planning and source responses are frozen. Unused slots and uncertain costs remain fully reserved.'};
 const file=directory+'/'+receipt.id+'.json';
 try{await writeFile(file,JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});db.prepare("UPDATE comparison_trials SET state=? WHERE id=? AND state='claimed'").run(answer?'completed':'failed',receipt.id);}
 finally{claims.close();db.close();}
 console.log(JSON.stringify({trialId:receipt.id,profile:receipt.profile,file,completed:!!answer,calls:artifact.actual.calls,reservedSlots:3,holdMicro:receipt.holdMicro,usageEstimateUsd:artifact.actual.estimatedUsageUsd,sourcedBlocks:answer?.blocks.filter(block=>block.citations.length).length??0,failure,elapsedMs:artifact.elapsedMs}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('COMPARISON_OPERATOR_FAILED_NO_RETRY');process.exitCode=1;});
