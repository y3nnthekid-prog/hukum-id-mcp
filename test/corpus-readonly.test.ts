import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CorpusIndex} from '../src/indexing/corpus.js';
test('serverless corpus reader never mutates the published snapshot or allows import writes',()=>{
 const folder=mkdtempSync(join(tmpdir(),'pasla-readonly-')),file=join(folder,'corpus.sqlite');
 const meta={id:'synthetic',jenis:'peraturan' as const,judul:'Sumber sintetis',rujukan:'UU 1/2020',sourceUrl:'https://example.test/source',fileHash:'a'.repeat(64),retrievedAt:'2026-10-29T00:00:00Z',importedBy:'test',complete:true};
 const pages=[{halaman:1,teks:'Pasal 1\nBarang yang rusak merupakan contoh sintetis untuk pengujian.'}];
 const writer=new CorpusIndex(file);writer.replace(meta,pages);writer.close();
 const before=readFileSync(file),reader=new CorpusIndex(file,{readOnly:true});
 try{assert.ok(reader.search('barang rusak','peraturan').hasil.length>0);assert.throws(()=>reader.replace(meta,pages));}
 finally{reader.close();}
 assert.deepEqual(readFileSync(file),before);
 for(const suffix of ['','-wal','-shm'])if(existsSync(file+suffix))unlinkSync(file+suffix);rmdirSync(folder);
});
