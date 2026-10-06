import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initialState} from '../worker/domain.mjs';
import {metricDate,measuredMetric,ownedMetricPostUrl,importMetricRows} from '../worker/metrics.mjs';
import {refreshSignals,refreshRecommendations,chooseRefreshPlan} from '../worker/refresh.mjs';
import {buildManagerReview} from '../worker/reviews.mjs';
const day='2026-10-06',hash=async x=>createHash('sha256').update(x).digest('hex');
const shift=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
function fixture(basis='visits'){
 const s=initialState();s.items.push({id:'old',title:'상하이 9월 날씨',region:'상하이',topic:'날씨·시기',type:'info',channel:'blog',status:'게시됨',publishedAt:'2026-08-01T12:00:00+09:00',date:'2026-08-01',url:'https://blog.naver.com/withsuzz/123456789',notes:'기존에 확인한 경험 메모',draft:'원본 원고는 그대로 둡니다.',updatedAt:'2026-08-01T03:00:00Z'});
 for(let n=1;n<=28;n++)s.metrics.push({itemId:'old',channel:'blog',source:'naver-post',date:shift(day,-n),[basis]:n<=14?10:100,measuredFields:[basis],grain:'day'});
 return s;
}
test('CSV의 빈 값·잘못된 값·실제 0을 구분하고 URL로 정확한 글을 연결한다',()=>{
 const s=fixture();s.metrics=[];const input={date:'2026-10-05',title:'동일 글',url:'https://m.blog.naver.com/withsuzz/123456789',source:'naver-post',visits:'0',clicks:'',searchClicks:'잘못된 값'};
 const r=importMetricRows(s,[input],{blog:'블로그'},'2026-10-06T00:00:00Z');assert.equal(r.count,1);assert.equal(r.invalidFields,1);assert.equal(s.metrics[0].itemId,'old');assert.equal(measuredMetric(s.metrics[0],'visits'),0);assert.equal(measuredMetric(s.metrics[0],'clicks'),null);assert.equal(measuredMetric({visits:0},'visits'),null);assert.equal(measuredMetric({visits:5},'visits'),5);
 const update=importMetricRows(s,[{...input,title:'제목 변경',visits:'1,234',clicks:'2'}],{blog:'블로그'});assert.equal(update.updated,1);assert.equal(s.metrics.length,1);assert.equal(s.metrics[0].visits,1234);assert.equal(s.metrics[0].clicks,2);
 assert.equal(ownedMetricPostUrl('https://user:pass@blog.naver.com/withsuzz/123456789'),'');assert.equal(ownedMetricPostUrl('https://blog.naver.com/other/123456789'),'');assert.equal(metricDate('2026-02-30'),false);
});
test('같은 출처의 실제 일별 자료로 감소를 찾고 계절·측정 기간을 설명한다',()=>{
 const r=refreshSignals(fixture(),day),c=r.candidates[0];assert.equal(r.coverage.comparablePosts,1);assert.equal(c.peak.average,100);assert.equal(c.recent.average,10);assert.equal(c.decline,.9);assert.equal(c.recent.days,14);assert.equal(c.peak.days,14);assert.ok(c.cautions.some(x=>x.includes('현재 월')));assert.equal(c.basisLabel,'방문 유입');
});
test('키워드별 자료·블로그 전체 수치·다른 출처를 섞어 글의 감소를 만들지 않는다',()=>{
 const s=fixture();for(const m of s.metrics)if(m.date<'2026-09-22')m.source='other';assert.equal(refreshSignals(s,day).candidates.length,0);
 const keywords=fixture();keywords.metrics.forEach(m=>m.keyword='상하이 날씨');assert.equal(refreshSignals(keywords,day).candidates.length,0);
 const global=initialState();global.naverStats={visitors:[{date:'2026-10-05',count:0}],keywords:[{keyword:'상하이 날씨',percentage:90}]};assert.equal(refreshSignals(global,day).candidates.length,0);
});
test('누락 날짜는 0이 아니며 신뢰할 수 있는 실제 0은 100% 감소로 계산한다',()=>{
 const s=fixture();s.metrics=s.metrics.filter(m=>m.date<'2026-09-22'||m.date>='2026-09-30');assert.equal(refreshSignals(s,day).candidates.length,0);
 const zeros=fixture();for(const m of zeros.metrics)if(m.date>='2026-09-22')m.visits=0;assert.equal(refreshSignals(zeros,day).candidates[0].decline,1);
 const legacy=fixture();for(const m of legacy.metrics){delete m.measuredFields;if(m.date>='2026-09-22')m.visits=0;}assert.equal(refreshSignals(legacy,day).candidates.length,0);
});
test('중복 자료는 더하지 않고 충돌 날짜를 제외하며 미래·새 글·오래된 최근 자료를 추천하지 않는다',()=>{
 const s=fixture();s.metrics.push({...s.metrics[0]});assert.equal(refreshSignals(s,day).candidates[0].recent.average,10);s.metrics.push({...s.metrics[0],visits:999});assert.equal(refreshSignals(s,day).candidates[0].recent.days,13);assert.ok(refreshSignals(s,day).candidates[0].cautions.some(x=>x.includes('충돌')));
 s.metrics.push({...s.metrics[0],date:day,visits:999999});assert.equal(refreshSignals(s,day).candidates[0].recent.average,10);
 const young=fixture();young.items[0].publishedAt='2026-09-30T00:00:00+09:00';assert.equal(refreshSignals(young,day).candidates.length,0);
 const stale=fixture();stale.metrics=stale.metrics.filter(m=>m.date<'2026-09-29');assert.equal(refreshSignals(stale,day).candidates.length,0);
});
test('조회수는 검색 유입으로 설명하지 않고 검색 클릭 자료가 있으면 우선한다',()=>{
 const views=fixture('views'),c=refreshSignals(views,day).candidates[0];assert.equal(c.basisLabel,'글 조회수');assert.ok(c.cautions.some(x=>x.includes('검색 유입·방문자')));
 views.metrics.push(...fixture('searchClicks').metrics);assert.equal(refreshSignals(views,day).candidates[0].basis,'searchClicks');
});
test('추천 선택은 원본·일정·원고를 보존하고 재작성 기획만 만들며 중복하지 않는다',async()=>{
 const s=fixture(),before=structuredClone(s.items[0]),r=(await refreshRecommendations(s,day,hash)).candidates[0],create=x=>({...x,id:crypto.randomUUID(),createdAt:'2026-10-06T00:00:00Z',updatedAt:'2026-10-06T00:00:00Z'});
 const a=await chooseRefreshPlan(s,r,day,hash,create),b=await chooseRefreshPlan(s,r,day,hash,create);assert.deepEqual(s.items.find(i=>i.id==='old'),before);assert.equal(a.item.status,'아이디어');assert.equal(a.item.draft,'');assert.equal(a.item.date,'');assert.equal(a.item.refreshOf,'old');assert.ok(a.item.notes.includes('기존 경험을 새로'));assert.equal(b.duplicate,true);assert.equal(s.refreshPlans.length,1);assert.equal(s.xp,0);
});
test('추천 후 수치가 바뀌면 오래된 선택을 거절하고 갱신 기획의 새 글 자료를 따로 추적한다',async()=>{
 const s=fixture(),r=(await refreshRecommendations(s,day,hash)).candidates[0],create=x=>({...x,id:crypto.randomUUID()});s.metrics[0].visits=12;await assert.rejects(()=>chooseRefreshPlan(s,r,day,hash,create),/바뀌/);
 const fresh=(await refreshRecommendations(s,day,hash)).candidates[0],p=await chooseRefreshPlan(s,fresh,day,hash,create);p.item.status='게시됨';p.item.publishedAt='2026-10-04T12:00:00+09:00';s.metrics.push({date:'2026-10-05',itemId:p.item.id,source:'naver-post',channel:'blog',visits:0,measuredFields:['visits']});
 const result=await refreshRecommendations(s,day,hash);assert.equal(result.candidates.length,0);assert.equal(result.plans[0].postTotal,0);assert.equal(result.plans[0].postDays,1);assert.equal(result.plans[0].postAverage,0);
});
test('매니저 리포트는 감소 후보를 담고 자료 없는 옛 0을 성과 학습 표본으로 사용하지 않는다',()=>{
 const s=fixture(),r=buildManagerReview(s,'daily',day,'2026-10-06T09:00:00Z').report;assert.equal(r.refresh.candidateCount,1);assert.equal(r.refresh.candidates[0].decline,.9);
 const empty=initialState();empty.items=['a','b','c'].map(id=>({id,channel:'blog',status:'게시됨'}));empty.metrics=empty.items.map(i=>({itemId:i.id,channel:'blog',source:'source',date:'2026-10-05',visits:0}));buildManagerReview(empty,'weekly','2026-10-12','2026-10-12T09:00:00Z');assert.equal(empty.recommendationProfile,undefined);
});
