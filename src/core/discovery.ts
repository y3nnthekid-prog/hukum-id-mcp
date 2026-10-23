type Hit={judul?:unknown;title?:unknown;cuplikan?:unknown;rujukan?:unknown;url?:unknown;pasal?:unknown};
const common=new Set(['undang','peraturan','indonesia','tahun','nomor','pasal','tentang','dengan','untuk','dalam','yang','atau','saya','sudah','belum','bagaimana']);
/** Rank the actual local and publisher hits together; local OR matches must not
 * exhaust the result limit before publisher hits have even been considered. */
export function mergeDiscovery<L extends Hit,R extends Hit>(query:string,local:L[],remote:R[],limit:number):Array<L|R>{
 const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].filter(t=>!common.has(t));
 const score=(hit:L|R)=>{const title=String(hit.judul??hit.title??'').toLowerCase(),snippet=String(hit.cuplikan??'').toLowerCase();return terms.reduce((n,t)=>n+(title.includes(t)?4:0)+(snippet.includes(t)?1:0),0);};
 const rows=[...local.map(hit=>({hit,pool:'local'})),...remote.map(hit=>({hit,pool:'remote'}))].map((row,index)=>({...row,index,score:score(row.hit)})).sort((a,b)=>b.score-a.score||a.index-b.index);
 const seen=new Set<string>();const unique=rows.filter(({hit})=>{const key=JSON.stringify([hit.rujukan??null,hit.url??null,hit.pasal??null,String(hit.judul??hit.title??'')]);if(seen.has(key))return false;seen.add(key);return true;});
 // Preserve both discovery routes even when title matches in one pool dominate.
 const quota=Math.ceil(limit/2),counts=new Map<string,number>(),selected:typeof unique=[];
 if(local.length&&remote.length)for(const row of unique){const used=counts.get(row.pool)??0;if(used<quota&&selected.length<limit){selected.push(row);counts.set(row.pool,used+1);}}
 for(const row of unique)if(selected.length<limit&&!selected.includes(row))selected.push(row);
 return selected.sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.hit);
}
