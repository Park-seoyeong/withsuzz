import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';

// 마이그레이션을 실행하지 않은 빈 D1을 흉내 낸다. 독립 배포 모드는 첫 요청에서 표를 만든다.
function emptyDB(){const sql=new DatabaseSync(':memory:');return {prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};}};}
function fixture(extra={}){
 const env={STANDALONE:'1',ADMIN_PASSWORD:'standalone-test-password',AGENT_TOKEN:'agent-token-for-tests-0123456789',DB:emptyDB(),...extra};
 const send=(path,{body,headers={},method}={})=>worker.fetch(new Request('https://withsuzz.example.workers.dev'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
 return {env,send};
}
async function login(f){const r=await f.send('/api/login',{body:{password:'standalone-test-password'}});assert.equal(r.status,200);return r.headers.get('Set-Cookie').split(';')[0];}

test('독립 배포는 빈 DB에 표를 만들고, 외부 신원 헤더 대신 관리자 비밀번호와 세션으로만 들어간다',async()=>{
 const f=fixture();
 assert.equal((await f.send('/api/state',{headers:{'oai-authenticated-user-id':'owner'}})).status,401);
 assert.equal((await f.send('/api/login',{body:{password:'wrong'}})).status,401);
 const cookie=await login(f);
 const state=await f.send('/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);
 assert.equal((await f.send('/api/state',{headers:{Cookie:cookie,'oai-authenticated-user-id':'someone-else'}})).status,200);
 const page=await f.send('/');assert.equal(page.status,200);assert.match(await page.text(),/password/);
 assert.equal((await f.send('/api/action',{body:{action:'saveItem',item:{title:'x'}},headers:{Cookie:cookie,Origin:'https://evil.example'}})).status,403);
});

test('자동화 경로와 /mcp는 세션이나 맞는 AGENT_TOKEN 없이는 열리지 않는다',async()=>{
 const f=fixture();
 for(const path of ['/api/naver-sync','/api/publishing-agent','/api/editor-assistant','/api/manager-review','/api/trends-agent'])assert.equal((await f.send(path)).status,401,path);
 assert.equal((await f.send('/api/naver-sync',{headers:{Authorization:'Bearer wrong-token'}})).status,401);
 const ok=await f.send('/api/naver-sync',{headers:{Authorization:'Bearer agent-token-for-tests-0123456789'}});assert.equal(ok.status,200);
 const cookie=await login(f);assert.equal((await f.send('/api/naver-sync',{headers:{Cookie:cookie}})).status,200);
 const rpc={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
 assert.equal((await f.send('/mcp',{body:rpc,headers:{'oai-authenticated-user-id':'owner'}})).status,401);
 assert.equal((await f.send('/mcp',{body:rpc,headers:{Cookie:cookie}})).status,401);
 assert.equal((await f.send('/mcp',{body:rpc,headers:{Authorization:'Bearer agent-token-for-tests-0123456789'}})).status,200);
 const call=await (await f.send('/mcp',{body:{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'suzz_list_writing_requests',arguments:{}}},headers:{Authorization:'Bearer agent-token-for-tests-0123456789'}})).json();assert.equal(call.result.isError,false);
 const none=fixture({AGENT_TOKEN:undefined});assert.equal((await none.send('/api/naver-sync',{headers:{Authorization:'Bearer anything'}})).status,401);
});

test('전체 자료 백업 JSON으로 복원하고, 기존 자료는 덮어쓰기 확인 없이 바꾸지 않는다',async()=>{
 const f=fixture(),cookie=await login(f),h={Cookie:cookie};
 assert.equal((await f.send('/api/restore',{body:'not json',headers:h})).status,400);
 assert.equal((await f.send('/api/restore',{body:{app:'other',state:{}},headers:h})).status,400);
 assert.equal((await f.send('/api/restore',{body:{app:'withsuzz-manager',state:{items:[]}}})).status,401);
 const backup={exportedAt:'2026-10-06T10:00:00.000Z',app:'withsuzz-manager',state:{version:1,settings:{characterName:'써즈',dailyTarget:3},items:[{id:'a',title:'상하이 맛집',status:'게시됨'}],sponsors:[],lessons:[],tasks:[],metrics:[],events:[],rewards:[],xp:240,files:[{id:'f1',key:'files/f1',name:'사진.jpg',type:'image/jpeg',size:10}],prompts:[{id:'p',name:'기본형',text:'메뉴 중심',version:1}]}};
 const done=await (await f.send('/api/restore',{body:backup,headers:h})).json();
 assert.equal(done.result.items,1);assert.equal(done.result.attachmentsToReupload,1);
 let s=(await (await f.send('/api/state',{headers:h})).json()).state;
 assert.equal(s.xp,240);assert.equal(s.settings.dailyTarget,3);assert.equal(s.settings.maxDaily,4);assert.equal(s.prompts[0].name,'기본형');assert.deepEqual(s.sponsors,[]);assert.match(s.events[0].message,/다시 올려야/);
 const second={...backup,state:{...backup.state,items:[{id:'b',title:'대련 교통'}]}};
 assert.equal((await f.send('/api/restore',{body:second,headers:h})).status,409);
 s=(await (await f.send('/api/state',{headers:h})).json()).state;assert.equal(s.items[0].title,'상하이 맛집');
 assert.equal((await f.send('/api/restore',{body:{...second,replace:true},headers:h})).status,200);
 s=(await (await f.send('/api/state',{headers:h})).json()).state;assert.equal(s.items.length,1);assert.equal(s.items[0].title,'대련 교통');
 assert.equal((await f.send('/api/state',{headers:h})).status,200);
});
