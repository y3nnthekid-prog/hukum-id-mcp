import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syntheticAudit } from '../src/core/chat-audit.js';
const input={conversationId:'fixture',turnId:'turn',version:7,messages:[{id:'u',role:'user' as const,text:'Synthetic fixture only'}]};
const now=1000000,config={conversationId:'fixture',version:7,expiresAt:now+600000,file:'/var/lib/pasla-preview/synthetic-audit-0123456789abcdef.json',messagesHash:createHash('sha256').update(JSON.stringify(input.messages.map(({role,text})=>({role,text})))).digest('hex')};
test('synthetic capture requires exact conversation version and every message, bounded expiry and pinned path',()=>{
 assert.equal(typeof syntheticAudit(input,JSON.stringify(config),()=>now),'function');
 for(const change of [{conversationId:'other'},{version:8},{expiresAt:now},{expiresAt:now+900001},{messagesHash:'0'.repeat(64)},{file:'/tmp/unpinned.json'}])assert.equal(syntheticAudit(input,JSON.stringify({...config,...change}),()=>now),undefined);
 assert.equal(syntheticAudit({...input,messages:[{...input.messages[0]!,text:'Private changed text'}]},JSON.stringify(config),()=>now),undefined);
 assert.equal(syntheticAudit(input,'malformed',()=>now),undefined);
});
