import test from 'node:test';
import assert from 'node:assert/strict';
import {schedule,award,initialState,analyzeMetrics,today,checks} from '../worker/domain.mjs';
const item=(id,region,date='',extra={})=>({id,title:'글 '+id,channel:'blog',type:'review',region,topic:'교통',status:'아이디어',date,...extra});
test('한국 시간 날짜 경계를 사용한다',()=>assert.equal(today(new Date('2026-10-04T16:01:00Z')),'2026-10-05'));
test('지역을 분산하고 마감·예약·잠근 일정을 보존한다',()=>{const items=[item('fixed','서울','2026-10-06',{locked:true}),item('a','상하이'),item('b','부산'),item('c','제주'),item('d','서울'),item('e','상하이')];const r=schedule(items,{start:'2026-10-05',days:3,daily:2});assert.equal(r.items.find(i=>i.id==='fixed').date,'2026-10-06');assert.equal(new Set(r.items.filter(i=>i.date==='2026-10-05').map(i=>i.region)).size,2);for(const day of ['2026-10-05','2026-10-06','2026-10-07'])assert.ok(r.items.filter(i=>i.date===day).length<=3);});
test('밀린 글을 재배치할 때 직접 작업 4개를 넘지 않으며 자동 글은 별도다',()=>{const items=Array.from({length:18},(_,n)=>item('x'+n,'지역'+n,n<6?'2026-10-04':'2026-10-06'));items.push(item('auto','상하이','2026-10-05',{automatic:true}));const r=schedule(items,{start:'2026-10-05',days:7,onlyOverdue:true});for(const d of new Set(r.items.map(i=>i.date)))assert.ok(r.items.filter(i=>i.date===d&&!i.automatic).length<=4);assert.equal(r.items.find(i=>i.id==='auto').date,'2026-10-05');assert.equal(r.changes.length>0,true);});
test('엠바고 이전에 배치하지 않고 충돌을 알려준다',()=>{const r=schedule([item('a','서울','',{embargo:'2026-10-08T12:00:00+09:00'}),item('b','부산','2026-10-06',{deadline:'2026-10-05'})],{start:'2026-10-05',days:5});assert.ok(r.items.find(i=>i.id==='a').date>='2026-10-08');assert.ok(r.notices.some(n=>n.id==='b'));});
test('지역이 부족할 때 반복 추천 사유가 남는다',()=>{const r=schedule([item('a','상하이'),item('b','상하이'),item('c','상하이')],{start:'2026-10-05',days:3});assert.ok(r.notices.length>0);assert.ok(r.items.every(i=>i.scheduleBasis.includes('검색량 미연결')));});
test('경험치는 한 작업에 한 번만 지급한다',()=>{const s=initialState();assert.ok(award(s,'one',30));assert.equal(award(s,'one',30),false);assert.equal(s.xp,30);});
test('검색 클릭률과 링크 클릭률을 구분하고 분모가 없으면 계산하지 않는다',()=>{const r=analyzeMetrics([{title:'A',visits:100,clicks:10,impressions:200,searchClicks:20,conversions:2,revenue:30},{title:'B',clicks:5}]);assert.equal(r[0].linkCTR,.1);assert.equal(r[0].searchCTR,.1);assert.equal(r[0].cvr,.2);assert.equal(r[1].linkCTR,null);});
test('키워드를 정확한 한 세트로 세고 협찬 금지 표현을 찾는다',()=>{const r=checks({type:'sponsor',keyword:'당산역 맛집 보쌈',keywordCount:2,draft:'당산역 맛집 보쌈\n당산역 맛집 보쌈 내돈내산'});assert.equal(r.keywordCount,2);assert.ok(r.checks.find(c=>c.label==='협찬 금지 표현').state.includes('필요'));});
test('성과 합계는 빈 값·실제 0·출처를 구분하고 불완전한 비율을 계산하지 않는다',()=>{
 const rows=analyzeMetrics([
  {itemId:'A',source:'naver',visits:100,clicks:null,measuredFields:['visits']},
  {itemId:'A',source:'naver',visits:100,clicks:0,measuredFields:['visits','clicks']},
  {itemId:'A',source:'partner',clicks:3,conversions:0,measuredFields:['clicks','conversions']},
  {itemId:'A',source:'naver',keyword:'교통',visits:999,measuredFields:['visits']},
  {itemId:'legacy',visits:0,clicks:0}
 ]);
 const n=rows.find(r=>r.source==='naver'),p=rows.find(r=>r.source==='partner'),l=rows.find(r=>r.id==='legacy');
 assert.equal(n.visits,200);assert.equal(n.clicks,0);assert.equal(n.linkCTR,null);assert.equal(n.measuredCounts.clicks,1);assert.equal(p.visits,null);assert.equal(p.cvr,0);assert.equal(l.visits,null);assert.equal(l.clicks,null);
});
