import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../worker/domain.mjs';
import {buildManagerReview} from '../worker/reviews.mjs';
import {keywordRecommendations} from '../worker/recommendations.mjs';
const at='2026-10-12T00:20:00Z',day='2026-10-12';
test('주간 리포트는 직전 완료된 주를 사용하고 중복 실행으로 메모리·리포트를 늘리지 않는다',()=>{
 const s=initialState();s.items=[{id:'a',channel:'blog',publishedAt:'2026-10-05T12:00:00+09:00',status:'게시됨'},{id:'b',channel:'blog',publishedAt:'2026-10-12T12:00:00+09:00',status:'게시됨'}];
 const r=buildManagerReview(s,'weekly',day,at);assert.equal(r.report.start,'2026-10-05');assert.equal(r.report.end,'2026-10-11');assert.equal(r.report.counts.manual,1);assert.equal(r.report.visitorAverage,null);assert.equal(s.memory.length,1);assert.equal(s.recommendationProfile,undefined);assert.equal(buildManagerReview(s,'weekly',day,at).duplicate,true);assert.equal(s.memory.length,1);assert.equal(s.managerReports.length,1);
});
test('네이버 미집계 날짜·검색어 비율을 방문자 수로 바꾸지 않고 실패 사유를 남긴다',()=>{
 const s=initialState();s.naverStats={keywordDate:'2026-10-05',visitors:[{date:'2026-10-05',count:100},{date:'2026-10-06',count:200}],keywords:[{keyword:'대련 날씨',percentage:1.15}]};s.naverSync={status:'확인 필요',message:'재로그인 필요'};
 const r=buildManagerReview(s,'weekly',day,at).report;assert.equal(r.visitorDays,2);assert.equal(r.visitorAverage,150);assert.equal(r.keywords[0].percentage,1.15);assert.ok(r.warnings.some(w=>w.includes('재로그인')));assert.equal(s.metrics.length,0);
});
test('같은 출처의 글감ID 지표가 3개 이상일 때만 제한된 소재 참고점수를 반영한다',()=>{
 const s=initialState();s.items=[{id:'a',topic:'날씨·시기',channel:'blog',status:'게시됨'},{id:'b',topic:'숙소',channel:'blog',status:'게시됨'},{id:'c',topic:'숙소',channel:'blog',status:'게시됨'}];
 s.metrics=s.items.map((i,n)=>({itemId:i.id,channel:'blog',source:'naver-post',date:'2026-10-10',visits:n===0?100:1}));s.metrics.push({itemId:'unlinked',channel:'blog',source:'naver-post',date:'2026-10-10',visits:999999});
 buildManagerReview(s,'weekly',day,at);assert.equal(s.recommendationProfile.sampleSize,3);assert.ok(s.recommendationProfile.topicBoost['날씨·시기']>0);assert.ok(s.recommendationProfile.topicBoost['날씨·시기']<=4);assert.equal(s.settings.editorRules,initialState().settings.editorRules);
 s.naverStats={keywordDate:'2026-10-11',keywords:[{keyword:'대련 날씨',percentage:1}]};s.items.push({id:'new',title:'대련 날씨',region:'대련',topic:'날씨·시기',channel:'blog',status:'아이디어'});
 assert.ok(keywordRecommendations(s,day).existing[0].reasons.some(r=>r.includes('실제 글별')));
});
test('다른 성과 출처를 섞어 기준 표본을 채우지 않는다',()=>{
 const s=initialState();s.items=['a','b','c'].map(id=>({id,topic:'날씨',channel:'blog',status:'게시됨'}));s.metrics=s.items.map((i,n)=>({itemId:i.id,source:'different-'+n,channel:'blog',date:'2026-10-10',visits:100}));buildManagerReview(s,'weekly',day,at);assert.equal(s.recommendationProfile,undefined);
});
test('일찍 저장한 리포트가 있어도 저녁에 바뀐 작업을 같은 기록에 갱신한다',()=>{
 const s=initialState();buildManagerReview(s,'daily',day,at);
 s.items.push({id:'a',channel:'blog',status:'게시됨',publishedAt:'2026-10-12T16:00:00+09:00'});
 const r=buildManagerReview(s,'daily',day,'2026-10-12T09:00:00Z');assert.equal(r.duplicate,false);assert.equal(r.report.counts.manual,1);assert.equal(s.managerReports.length,1);assert.equal(buildManagerReview(s,'daily',day,'2026-10-12T09:01:00Z').duplicate,true);
});
