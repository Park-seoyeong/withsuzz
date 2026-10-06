import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';

async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 const env={ADMIN_PASSWORD:'pw-test',DB:{prepare(q){let a=[];return {bind(...x){a=x;return this;},async first(){return sql.prepare(q).get(...a)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...a).changes}};}};}}};
 const req=(p,b,c='')=>new Request('https://t.local'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner',Cookie:c},...(b?{body:JSON.stringify(b)}:{})});
 const cookie=(await worker.fetch(req('/api/login',{password:'pw-test'}),env)).headers.get('Set-Cookie').split(';')[0];
 const act=async b=>{const r=await worker.fetch(req('/api/action',b,cookie),env);return {status:r.status,data:await r.json()};};
 const state=async()=>(await (await worker.fetch(req('/api/state',null,cookie),env)).json());
 return {act,state};
}
const prepare=async(f,when='2099-10-07T09:00')=>{const item=(await f.act({action:'saveItem',item:{title:'제주 억새 명소',draft:'안녕하세요, 써즈입니다.\n\n새별오름 억새를 보고 왔어요.',channel:'blog',type:'info'}})).data.result;const r=await f.act({action:'preparePublication',itemId:item.id,requestId:crypto.randomUUID(),scheduledAt:when,reviewed:true,images:[]});return {item,jobId:r.data.result.jobId};};

test('직접 예약 기록은 확인 체크가 있어야 하고 글감을 예약됨으로 바꾼다',async()=>{
 const f=await fixture(),{item,jobId}=await prepare(f);
 assert.equal((await f.act({action:'reserveManual',jobId})).status,400);
 const ok=await f.act({action:'reserveManual',jobId,confirmed:true,note:'여행 카테고리'});assert.equal(ok.status,200);assert.equal(ok.data.result.status,'예약 확인됨');
 const s=await f.state();const job=s.publishing.jobs.find(j=>j.id===jobId);
 assert.equal(job.receipt.method,'manual');assert.equal(s.state.items.find(i=>i.id===item.id).status,'예약됨');assert.equal(s.state.items.find(i=>i.id===item.id).date,'2099-10-07');
 assert.equal((await f.act({action:'reserveManual',jobId,confirmed:true})).status,409,'같은 준비를 두 번 기록하지 않는다');
 assert.equal(s.state.xp,0,'예약만으로는 발행 경험치를 주지 않는다');
});

test('게시 확인은 써즈 블로그 글 주소만 받고 한 번만 경험치를 준다',async()=>{
 const f=await fixture(),{item,jobId}=await prepare(f);
 await f.act({action:'reserveManual',jobId,confirmed:true});
 assert.equal((await f.act({action:'publishedManual',jobId,postUrl:'https://blog.naver.com/other/224000000001'})).status,400);
 assert.equal((await f.act({action:'publishedManual',jobId,postUrl:'https://example.com/withsuzz/1'})).status,400);
 const ok=await f.act({action:'publishedManual',jobId,postUrl:'https://m.blog.naver.com/PostView.naver?blogId=withsuzz&logNo=224000000001'});assert.equal(ok.status,200);
 assert.equal(ok.data.result.postUrl,'https://blog.naver.com/withsuzz/224000000001');
 const s=await f.state(),i=s.state.items.find(x=>x.id===item.id);assert.equal(i.status,'게시됨');assert.equal(i.url,'https://blog.naver.com/withsuzz/224000000001');assert.equal(s.state.xp,30);
 assert.equal((await f.act({action:'publishedManual',jobId,postUrl:'https://blog.naver.com/withsuzz/224000000001'})).status,409);
 const other=await prepare(f,'2099-10-08T09:00');
 assert.equal((await f.act({action:'publishedManual',jobId:other.jobId,postUrl:'https://blog.naver.com/withsuzz/224000000001'})).status,409,'한 게시글을 두 준비에 연결하지 않는다');
});
