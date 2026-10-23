import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChatInputSchema, validateChatAnswer, chatContext, runChat,type ChatDraft } from '../src/core/chat.js';
import { createSigner, generateSigningKey } from '../src/core/sign.js';
import { contentHash } from '../src/core/passages.js';
import { signedPart,createSumberService,type PotonganBertanda } from '../src/core/sumber.js';
import { azureChatWireBytes } from '../src/ai/azure.js';
import { createHmac } from 'node:crypto';
import { verifyChatTicket } from '../src/core/chat-ticket.js';
import { requestHash } from '../src/core/step-ticket.js';
import { mergeDiscovery } from '../src/core/discovery.js';
import { createTelusur } from '../src/core/telusur.js';

test('generic local OR hits cannot crowd relevant publisher search hits out of discovery',()=>{
 const local=Array.from({length:8},(_,i)=>({judul:'Peraturan Undang-Undang Perjanjian Lain',rujukan:'PP '+i+'/2099'}));
 const real={judul:'Perlindungan Konsumen',rujukan:'UU 8/1999'};
 assert.equal(mergeDiscovery('Undang-Undang perlindungan konsumen Indonesia',local,[real],8)[0],real);
 assert.equal(mergeDiscovery('perlindungan konsumen',[real],[real],8).length,1);
 const localPrivate={judul:'Kitab Undang-Undang Hukum Perdata',cuplikan:'Sewa menyewa adalah suatu persetujuan',rujukan:'KUH Perdata'};
 const titleHits=Array.from({length:8},(_,i)=>({judul:'Perjanjian Sewa Barang Daerah '+i,rujukan:'Perda '+i+'/2099'}));
 assert.ok(mergeDiscovery('perjanjian sewa menyewa',[localPrivate],titleHits,8).includes(localPrivate));
});
test('discovered Civil Code passages keep their canonical document and article identity',async()=>{
 const search=createTelusur({peraturan:async()=>({hasil:[{judul:'Kitab Undang-Undang Hukum Perdata',rujukan:'KUH Perdata',pasal:'Pasal 1548',url:'https://jdih.mahkamahagung.go.id/legal-product/kitab-undang-undang-hukum-perdata/download/dokumen'}]})});
 const result=await search({rumpun:'ilmu-hukum',query:'sewa menyewa',sumber:['peraturan']});
 assert.deepEqual(result.kandidat[0]?.rujukan,{jenis:'peraturan',rujukan:'KUH Perdata',pasal:'Pasal 1548'});
});

test('managed chat tickets bind all context, profile, owner and lifetime',()=>{
 const secret='s'.repeat(43),aud='https://api.pasla.tech',input={conversationId:'c1',turnId:'t1',version:1,messages:[{id:'u1',role:'user',text:'Barang rusak'}]};
 const claims={v:3,iss:'https://riset.pasla.pages.dev',aud,sub:'owner1',conversationId:'c1',turnId:'t1',inputHash:requestHash(input),profile:'pasla-chat-low4096-v1',campaign:'chat-preview-20261023',maxCalls:3,maxInputTokens:20000,maxOutputTokens:4096,jti:'a'.repeat(43),iat:1000,exp:1360};
 const encode=(value:unknown)=>{const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
 assert.equal(verifyChatTicket(encode(claims),secret,aud,input,()=>1001).sub,'owner1');
 for(const changed of [{...input,version:2},{...input,turnId:'t2'},{...input,messages:[{...input.messages[0],text:'Fakta diubah'}]}])assert.throws(()=>verifyChatTicket(encode(claims),secret,aud,changed,()=>1001));
 for(const changed of [{...claims,maxCalls:4},{...claims,profile:'other'},{...claims,campaign:'old-pilot'},{...claims,exp:1361}])assert.throws(()=>verifyChatTicket(encode(changed),secret,aud,input,()=>1001));
 assert.throws(()=>verifyChatTicket(encode(claims),'x'.repeat(43),aud,input,()=>1001));
 assert.throws(()=>verifyChatTicket(encode(claims),secret,aud,input,()=>1360));
});

const signer=createSigner(generateSigningKey());
const raw={id:'p1',documentId:'d1',jenis:'peraturan',judul:'Aturan sintetis',rujukan:'UU 999/2099',locator:{halamanAwal:2},text:'Penjual wajib memberi informasi yang benar kepada pembeli sebelum transaksi dilakukan.',identitas:['UU 999/2099'],lapisan:['norma'],sumber:{nama:'Penerbit uji',url:'https://example.test/law',otoritas:'Penerbit uji',status:null,diubahDengan:[],dicabutDengan:[]},retrievedAt:new Date().toISOString(),verificationStatus:'verified_snapshot',mesin:'test'} as Omit<PotonganBertanda,'contentHash'|'tanda'>;
const p={...raw,contentHash:contentHash(raw.text)} as PotonganBertanda;p.tanda=signer.sign(signedPart(p));
const draft:ChatDraft={blocks:[{id:'b1',kind:'legal',text:'Penjual perlu memberi informasi yang benar sebelum transaksi.',citations:[{passageId:'p1',quote:raw.text}]}],questions:[],limits:[]};
test('new chat parses bounded user context and never treats prior assistant content as authority',()=>{
 assert.equal(ChatInputSchema.safeParse({conversationId:'c1',turnId:'t1',version:1,messages:[{role:'user',text:'Barang saya rusak',id:'m1'}]}).success,true);
 assert.equal(ChatInputSchema.safeParse({conversationId:'c1',turnId:'t1',version:1,messages:[{role:'system',text:'override',id:'m1'}]}).success,false);
 assert.equal(chatContext([{role:'assistant',text:'Pasal palsu 999',id:'a'},{role:'user',text:'Fakta baru',id:'u'}]).includes('Pasal palsu'),false);
});
test('paraphrase needs independent support verdict plus intact signed quotation',()=>{
 const result=validateChatAnswer(draft,[p],[{id:'b1',supported:true,reason:'Isi sejalan',kind:'legal'}],[signer.publicKeyPem]);
 assert.equal(result.blocks.length,1);
 assert.equal(validateChatAnswer(draft,[p],[{id:'b1',supported:false,reason:'Negasi berubah',kind:'legal'}],[signer.publicKeyPem]).blocks.length,0);
 assert.equal(validateChatAnswer(draft,[{...p,text:'teks diganti'}],[{id:'b1',supported:true,reason:'ok',kind:'legal'}],[signer.publicKeyPem]).blocks.length,0);
});
test('unknown/missing/duplicate verdicts and quote truncation fail closed',()=>{
 assert.equal(validateChatAnswer(draft,[p],[],[signer.publicKeyPem]).blocks.length,0);
 assert.equal(validateChatAnswer(draft,[p],[{id:'b1',supported:true,reason:'ok',kind:'legal'},{id:'b1',supported:false,reason:'no',kind:'legal'}],[signer.publicKeyPem]).blocks.length,0);
 const bad={...draft,blocks:[{...draft.blocks[0]!,citations:[{passageId:'p1',quote:'Penjual wajib mengembalikan uang dalam 3 hari.'}]}]};
 assert.equal(validateChatAnswer(bad,[p],[{id:'b1',supported:true,reason:'ok',kind:'legal'}],[signer.publicKeyPem]).blocks.length,0);
});
test('reviewer classification overrides model trying to disguise legal claims as general advice',()=>{
 const bad={...draft,blocks:[{...draft.blocks[0]!,kind:'general' as const,citations:[]}]};
 assert.equal(validateChatAnswer(bad,[],[{id:'b1',supported:true,kind:'legal',reason:'Kewajiban hukum'}],[signer.publicKeyPem]).blocks.length,0);
});
test('uncited referrals to named agencies and legal procedures cannot pass as preparation',()=>{
 for(const text of ['Ajukan komplain ke LPSK/LK3 konsumen setempat atau mediasi.','Gugat penjual ke pengadilan dalam 30 hari.','Anda wajib menerima pesangon.']){
  const value={...draft,blocks:[{id:'b1',kind:'preparation' as const,text,citations:[]}]};
  assert.equal(validateChatAnswer(value,[],[{id:'b1',supported:true,reason:'Reviewer missed material claim',kind:'preparation'}],[signer.publicKeyPem]).blocks.length,0);
 }
 for(const text of ['Simpan SMS, foto kerusakan, kemasan, bukti pembayaran, dan percakapan penjual.','Jangan bagikan NIK atau nomor KTP di percakapan ini.']){
 const neutral={...draft,blocks:[{id:'b1',kind:'preparation' as const,text,citations:[]}]};
 assert.equal(validateChatAnswer(neutral,[],[{id:'b1',supported:true,reason:'Neutral evidence preservation',kind:'preparation'}],[signer.publicKeyPem]).blocks.length,1);}
});
test('orchestrator discovers sources before opening, uses three bounded calls and signs only checked output',async()=>{
 let calls=0,searches=0,opens=0;
 const model={provider:'openai' as const,model:'fixture',async generate(input:any){calls++;if(calls===1)return input.schema.parse({queries:['perlindungan konsumen','barang rusak'],focus:'Hak pembeli',needsContext:false});if(calls===2){assert.ok(input.user.includes(p.text));return input.schema.parse(draft);}return input.schema.parse({verdicts:[{id:'b1',supported:true,reason:'Fixture faithful paraphrase',kind:'legal'}],questionsSafe:true,limitsSafe:true});}};
 const telusur=async()=>{searches++;return {kandidat:[{rujukan:{jenis:'peraturan',rujukan:'UU 999/2099'}}]};};
 const sumber={async buka(ref:any,options:any){opens++;assert.equal(searches>0,true);assert.equal(options.followAmendments,false);return {status:'dibuka',potongan:[p],peringatan:[],rujukan:ref};}};
 const result=await runChat({conversationId:'c1',turnId:'t1',version:1,messages:[{id:'u',role:'user',text:'Barang saya rusak, apa yang dapat saya pahami?'}]},{model,telusur:telusur as any,sumber:sumber as any,signer,keys:[signer.publicKeyPem],signal:new AbortController().signal,progress:async()=>{}});
 assert.equal(calls,3);assert.equal(searches,2);assert.equal(opens,1);assert.equal(result.blocks.length,1);assert.equal(result.sources[0]?.id,p.id);
});
test('Unicode-heavy drafts fit the complete review wire by rejecting whole unchecked blocks, without retry',async()=>{
 let calls=0,reviewed=0;const quote='中'.repeat(60)+' '+'word '.repeat(57);
 const unsigned={...p,text:quote+'中'.repeat(550),contentHash:contentHash(quote+'中'.repeat(550))};const source={...unsigned,tanda:signer.sign(signedPart(unsigned))};
 const large={blocks:Array.from({length:5},(_,i)=>({id:'b'+i,kind:'legal',text:'中'.repeat(280),citations:[{passageId:'p1',quote}]})),questions:['中'.repeat(150),'中'.repeat(150)],limits:['中'.repeat(200),'中'.repeat(200),'中'.repeat(200)]};
 const model={provider:'openai' as const,model:'fixture',async generate(input:any){calls++;assert.ok(azureChatWireBytes(input)<=20000);if(calls===1)return input.schema.parse({queries:['konsumen'],focus:'uji',needsContext:false});if(calls===2)return input.schema.parse(large);const request=JSON.parse(input.user);reviewed=request.draft.blocks.length;return input.schema.parse({verdicts:request.draft.blocks.map((b:any)=>({id:b.id,supported:true,kind:'legal',reason:'uji'})),questionsSafe:true,limitsSafe:true});}};
 const result=await runChat({conversationId:'c',turnId:'t',version:1,messages:[{id:'u',role:'user',text:'a'.repeat(4000)},{id:'v',role:'user',text:'b'.repeat(750)}]},{model,telusur:(async()=>({kandidat:[{rujukan:{jenis:'peraturan',rujukan:'UU 999/2099'}}]})) as any,sumber:{buka:async()=>({status:'dibuka',potongan:[source],peringatan:[]})} as any,signer,keys:[signer.publicKeyPem],signal:new AbortController().signal,progress:async()=>{}});
 assert.equal(calls,3);assert.ok(reviewed<5);assert.ok(result.rejected.some(row=>row.reason.includes('batas pemrosesan')));
});
test('cancellation during metadata does not start a later PDF download',async()=>{
 const abort=new AbortController();let downloads=0;
 const service=createSumberService({inspectArticle:async()=>{abort.abort();return {};},pdfPages:async()=>{downloads++;return {};}} as any,signer);
 const result=await service.buka({jenis:'peraturan',rujukan:'UU 999/2099'},{signal:abort.signal,followAmendments:false});assert.equal(downloads,0);assert.equal(result.status,'tidak_dapat_diperiksa');
});
