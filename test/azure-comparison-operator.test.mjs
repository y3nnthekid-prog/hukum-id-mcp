import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,unlinkSync,rmdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateReservation as verifyReservation,claimTrial,digest,fingerprintRelease} from '../scripts/azure-chat-comparison.mjs';
const id='b37b90ea-d47d-4d6c-9697-e38c44096e93',hash='a'.repeat(64),revision='123abcd';
const buildHash='b'.repeat(64),runnerHash='c'.repeat(64);
const validateReservation=(value,freezeHash,rev)=>verifyReservation(value,freezeHash,rev,buildHash,runnerHash);
const receipt=()=>({v:1,kind:'pasla-operator-comparison',status:'confirmed',id,campaign:'chat-preview-20261023',profile:'gpt51',maxCalls:3,maxInputTokens:20000,maxOutputTokens:4096,holdMicro:197880,freezeHash:hash,revision,buildHash,runnerHash,caseId:'belanja-01',confirmedAt:new Date().toISOString(),before:{reserved_micro:2414136,reserved_calls:175,gross_reserved_calls:183},after:{reserved_micro:2612016,reserved_calls:178,gross_reserved_calls:186}});
test('comparison authorization binds stronger tariff, fixed slots, fixture, revision and confirmed campaign reservation',()=>{
 assert.equal(validateReservation(receipt(),hash,revision).deployment,'pasla-compare-51');
 for(const patch of [{buildHash:'d'.repeat(64)},{runnerHash:'e'.repeat(64)}])assert.throws(()=>validateReservation({...receipt(),...patch},hash,revision));
 for(const patch of [{status:'prepared'},{profile:'gpt52'},{maxCalls:4},{holdMicro:39576},{campaign:'old-pilot'},{freezeHash:'b'.repeat(64)},{caseId:'private-research'},{revision:'7654321'},{maxOutputTokens:8192},{maxInputTokens:20001},{id:'not-a-reservation'}])assert.throws(()=>validateReservation({...receipt(),...patch},hash,revision));
 for(const after of [{...receipt().after,reserved_micro:2612015},{...receipt().after,reserved_calls:179},{...receipt().after,gross_reserved_calls:185},{reserved_micro:10000001,reserved_calls:178,gross_reserved_calls:186}])assert.throws(()=>validateReservation({...receipt(),after},hash,revision));
 assert.throws(()=>validateReservation({...receipt(),before:{reserved_micro:0,reserved_calls:299,gross_reserved_calls:299},after:{reserved_micro:197880,reserved_calls:302,gross_reserved_calls:302}},hash,revision));
 assert.throws(()=>validateReservation({...receipt(),before:{reserved_micro:0,reserved_calls:175,gross_reserved_calls:299},after:{reserved_micro:197880,reserved_calls:178,gross_reserved_calls:302}},hash,revision));
});
test('a changed executable at the same release path changes its fingerprint before dispatch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pasla-build-'));mkdirSync(join(dir,'dist'));const files=['package.json','package-lock.json','pdf-profile.json','dist/module.js'];for(const file of files)writeFileSync(join(dir,file),'original');
 try{const first=await fingerprintRelease(dir);assert.equal(await fingerprintRelease(dir),first);writeFileSync(join(dir,'dist/module.js'),'changed at same revision');assert.notEqual(await fingerprintRelease(dir),first);}
 finally{for(const file of files)unlinkSync(join(dir,file));rmdirSync(join(dir,'dist'));rmdirSync(dir);}
});
test('a confirmed reservation is single-use even after failure and process restart; copying its authorization does not create a new trial',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pasla-comparison-')),file=join(dir,'trials.sqlite');let db=new DatabaseSync(file,{allowExtension:false});
 try{claimTrial(db,receipt(),'m'.repeat(64),1000);assert.throws(()=>claimTrial(db,receipt(),'m'.repeat(64),1001));db.prepare("UPDATE comparison_trials SET state='failed' WHERE id=?").run(id);db.close();db=new DatabaseSync(file,{allowExtension:false});assert.throws(()=>claimTrial(db,receipt(),'m'.repeat(64),1002));const copied={...receipt(),id:'5b12a393-a10d-4ba0-88d5-f30f532eb7b2'};assert.throws(()=>claimTrial(db,copied,digest(JSON.stringify(copied)),1003));assert.equal(db.prepare('SELECT count(*) AS n FROM comparison_trials').get().n,1);}
 finally{db.close();unlinkSync(file);rmdirSync(dir);}
});
