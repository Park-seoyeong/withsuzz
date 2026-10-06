import test from 'node:test';
import assert from 'node:assert/strict';
import {keywordRecommendations} from '../worker/recommendations.mjs';
import {initialState,schedule} from '../worker/domain.mjs';
const day='2026-10-06';
const draft=(id,title,region,extra={})=>({id,title,region,channel:'blog',type:'info',status:'아이디어',date:'',topic:'날씨·시기',...extra});
const state=(items,keywords=[{keyword:'대련 날씨',percentage:1.15}])=>({...initialState(),items,naverStats:{keywordDate:'2026-10-05',observedAt:'2026-10-05T12:00:00Z',keywords}});

test('날씨 검색어는 같은 지역·검색 의도의 글감에 연결하고 식당·다른 월은 제외한다',()=>{
 const s=state([draft('weather','대련 10월 옷차림','대련'),draft('food','대련 맛집 추천','대련'),draft('wrong','상하이 날씨','상하이'),draft('past','대련 9월 날씨','대련')],[{keyword:'대련 10월 날씨',percentage:1.15}]);
 const r=keywordRecommendations(s,day);assert.deepEqual(r.existing.map(x=>x.itemId),['weather']);assert.equal(r.existing[0].evidence[0].percentage,1.15);assert.equal(r.existing[0].evidence[0].visits,undefined);
});
test('띄어쓰기·동일 키워드 중복은 정리하고 비율을 합치지 않는다',()=>{
 const r=keywordRecommendations(state([draft('a','대련 날씨 옷차림','대련')],[{keyword:'대련날씨',percentage:.8},{keyword:'대련 날씨',percentage:1.15},{keyword:'중국 대련 날씨',percentage:1.01}]),day);
 assert.equal(r.existing.length,1);assert.equal(r.existing[0].evidence.length,2);assert.equal(r.existing[0].evidence[0].percentage,1.15);
});
test('최근 중복과 오늘 지역을 알려주며 준비된 초안을 다른 지역과 분산한다',()=>{
 const s=state([draft('a','대련 날씨','대련'),draft('b','상하이 날씨','상하이'),draft('c','대련 여행','대련',{date:day}),draft('p','대련 날씨','대련',{status:'게시됨',publishedAt:'2026-10-04T12:00:00+09:00'})],[{keyword:'대련 날씨',percentage:2},{keyword:'상하이 날씨',percentage:1}]);
 const r=keywordRecommendations(s,day);assert.equal(r.existing[0].itemId,'b');assert.equal(r.existing.length,2);assert.ok(r.existing.find(x=>x.itemId==='a').cautions.some(x=>x.includes('14일')));assert.ok(r.existing.find(x=>x.itemId==='a').cautions.some(x=>x.includes('지역')));
});
test('새 글감은 기존 예정 글·예약 글과 중복 생성하지 않는다',()=>{
 const s=state([draft('a','대련 날씨','대련',{date:'2026-10-09'}),draft('b','상하이 날씨','상하이',{status:'예약됨',date:'2026-10-10'})],[{keyword:'대련 날씨',percentage:1},{keyword:'상하이 날씨',percentage:1}]);
 const r=keywordRecommendations(s,day);assert.equal(r.existing.length,0);assert.equal(r.ideas.length,0);
});
test('기존 글 관련성을 유입 글 성과로 단정하지 않고 새 기획의 주의점으로 제시한다',()=>{
 const s=state([draft('a','하코네 료칸 후기','하코네',{status:'게시됨',publishedAt:'2026-09-01T12:00:00+09:00'})],[{keyword:'하코네 료칸',percentage:.86}]);
 const r=keywordRecommendations(s,day);assert.equal(r.ideas.length,1);assert.equal(r.ideas[0].relatedPublished[0].id,'a');assert.match(r.ideas[0].title,/비교할 기준/);assert.ok(r.ideas[0].cautions.length);assert.equal(r.ideas[0].trafficDecline,undefined);
});
test('오래된 자료와 미래 날짜·누락을 현재 트렌드로 처리하지 않는다',()=>{
 const s=state([draft('a','대련 날씨','대련')]);s.naverStats.keywordDate='2026-09-01';assert.equal(keywordRecommendations(s,day).stale,true);s.naverStats.keywordDate='2026-10-07';assert.equal(keywordRecommendations(s,day).existing.length,0);assert.equal(keywordRecommendations(initialState(),day).ideas.length,0);
});
test('검색어 가중치를 참고해도 예약·엠바고·지역 분산과 하루 상한은 유지한다',()=>{
 const items=[draft('fixed','예약','서울',{date:day,locked:true}),draft('first','글1','부산'),draft('second','글2','대련'),draft('third','글3','대련'),draft('embargo','글4','제주',{embargo:'2026-10-08T10:00:00+09:00'})];
 const r=schedule(items,{start:day,days:3,daily:2,keywordSignals:{second:20,third:20,embargo:20},keywordDate:'2026-10-05'});
 assert.equal(r.items.find(i=>i.id==='fixed').date,day);assert.equal(r.items.find(i=>i.id==='second').date,day);assert.ok(r.items.find(i=>i.id==='embargo').date>='2026-10-08');assert.ok(r.items.find(i=>i.id==='third').scheduleBasis.includes('네이버 유입'));for(const date of new Set(r.items.map(i=>i.date)))assert.ok(r.items.filter(i=>i.date===date).length<=2);
});
