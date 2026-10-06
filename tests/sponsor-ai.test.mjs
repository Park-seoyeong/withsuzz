import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {normalizeSponsorResult,sponsorChecklist,sponsorPrompt} from '../worker/ai.mjs';

const raw={business:' 성수 라멘집 ',region:'서울',visitDate:'10월 12일',deadline:'2026-10-20',embargo:'2026-10-19T09:00',provided:'라멘 2인분',fee:'',keywords:[{keyword:'성수 라멘',count:'3회'},{keyword:' ',count:''}],mustInclude:['대표 메뉴 사진'],forbidden:['최저가'],disclosure:'라멘 2인분을 제공받아 작성했어요.',links:[],shots:[{shot:'외관',why:'찾아가는 길'}],beforeVisit:['영업시간 확인'],onSite:[],afterVisit:['지도 첨부'],questions:['주차 가능 여부'],conflicts:[],extra:'무시'};

test('협찬 정리 결과는 형식이 틀린 날짜를 버리고 체크리스트로 묶는다',()=>{
 const r=normalizeSponsorResult(raw);
 assert.equal(r.business,'성수 라멘집');assert.equal(r.visitDate,'');assert.equal(r.deadline,'2026-10-20');assert.equal(r.embargo,'2026-10-19T09:00');
 assert.equal(r.keywords.length,1);assert.equal(r.extra,undefined);
 const c=sponsorChecklist(r);
 assert.match(c,/\[필수 촬영\]\n- 외관 — 찾아가는 길/);assert.match(c,/키워드 "성수 라멘" 3회/);assert.match(c,/금지: 최저가/);assert.match(c,/\[업체에 확인할 것\]\n- 주차 가능 여부/);
 assert.doesNotMatch(c,/현장에서 메모/,'빈 구역은 넣지 않는다');
 assert.throws(()=>normalizeSponsorResult(null));
 const p=sponsorPrompt({requirements:'원문',today:'2026-10-06'});assert.match(p.instructions,/추측해서 채우지 않는다/);assert.match(p.data,/원문/);
});

test('협찬 정리 API는 원문이 없으면 거절하고, Claude API 결과를 정리해 돌려준다',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 const env={ADMIN_PASSWORD:'pw-test',ANTHROPIC_API_KEY:'k',DB:{prepare(q){let a=[];return {bind(...x){a=x;return this;},async first(){return sql.prepare(q).get(...a)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...a).changes}};}};}}};
 const req=(p,b,c='')=>new Request('https://t.local'+p,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner',Cookie:c},body:JSON.stringify(b)});
 const cookie=(await worker.fetch(req('/api/login',{password:'pw-test'}),env)).headers.get('Set-Cookie').split(';')[0];
 assert.equal((await worker.fetch(req('/api/ai/sponsor',{requirements:'  '},cookie),env)).status,400);
 const prev=globalThis.fetch;let body;globalThis.fetch=async(u,init)=>{body=JSON.parse(init.body);return Response.json({id:'m',type:'message',role:'assistant',model:'claude-opus-5-5',stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1},content:[{type:'text',text:JSON.stringify(raw)}]});};
 let r;try{r=await worker.fetch(req('/api/ai/sponsor',{title:'라멘',requirements:'성수 라멘집 체험단'},cookie),env);}finally{globalThis.fetch=prev;}
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.result.business,'성수 라멘집');assert.match(d.checklist,/필수 촬영/);
 assert.equal(body.output_config.format.type,'json_schema');assert.match(body.messages[0].content,/성수 라멘집 체험단/);
});
