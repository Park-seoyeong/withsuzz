import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNaverPosts,saveNaverPosts,naverPostsOverview} from '../worker/naver-posts.mjs';
import {initialState,CHANNELS} from '../worker/domain.mjs';
import {refreshSignals} from '../worker/refresh.mjs';
const day='2026-10-06',now=new Date('2026-10-06T03:00:00Z'),run='https://agent.tinyfish.ai/runs/cfe9d835-5be2-4f05-92c3-cdfcc4c39b6e';
const snapshot=()=>({blogId:'withsuzz',authenticated:true,grain:'day',observedAt:now.toISOString(),runUrl:run,sourceUrl:'https://admin.blog.naver.com/withsuzz/stat/rank_pv',metricDefinition:'게시글별 날짜별 조회수',posts:[{title:'실제 옛 여행 글',url:'https://blog.naver.com/withsuzz/123456789',sourceUrl:'https://blog.stat.naver.com/blog/article/123456789/cv',publishedDate:'2026-08-01',rows:[{date:'2026-10-05',views:0},{date:'2026-10-04',views:30}]}]});
const create=x=>({...x,id:crypto.randomUUID(),publishedAt:'2026-10-06',createdAt:now.toISOString(),updatedAt:now.toISOString()});
test('글별 통계는 소유 링크·일간 값·실제 0을 검증하고 합계/오늘/게시일 이전 값을 거절한다',()=>{
 const s=normalizeNaverPosts(snapshot(),day,now);assert.equal(s.posts[0].rows[1].views,0);assert.equal(s.posts[0].postId,'123456789');
 for(const patch of [{authenticated:false},{grain:'month'},{blogId:'other'},{sourceUrl:'https://admin.blog.naver.com/other/stat/rank_pv'},{observedAt:'2026-10-07T00:00:00Z'},{posts:[{...snapshot().posts[0],url:'https://blog.naver.com/other/123456789'}]},{posts:[{...snapshot().posts[0],sourceUrl:'https://blog.stat.naver.com/blog/article/999/cv'}]}])assert.throws(()=>normalizeNaverPosts({...snapshot(),...patch},day,now));
 for(const row of [{date:day,views:30},{date:'2026-07-31',views:0},{date:'2026-10-05',views:'30'},{date:'2026-02-30',views:3},{date:'2026-10-05',views:-1},{date:'2026-10-05'}])assert.throws(()=>normalizeNaverPosts({...snapshot(),posts:[{...snapshot().posts[0],rows:[row]}]},day,now));
 assert.throws(()=>normalizeNaverPosts({...snapshot(),posts:[{...snapshot().posts[0],rows:[{date:'2026-10-05',views:1},{date:'2026-10-05',views:2}]}]},day,now));
});
test('확인한 원본 링크만 기존 글에 연결하며 원고·상태·일정·방문자·경험치를 보존한다',()=>{
 const s=initialState();s.items=[{id:'old',title:'사용자 제목',channel:'blog',url:'https://m.blog.naver.com/withsuzz/123456789',status:'초안 작성',draft:'내 경험 그대로',date:'2026-10-10'}];s.xp=30;s.naverStats={visitors:[{date:'2026-10-05',count:740}]};s.naverSync={automationId:'preserve'};const original=structuredClone(s);
 const result=saveNaverPosts(s,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS);assert.equal(result.created,0);assert.equal(result.linked,1);assert.deepEqual(s.items,original.items);assert.equal(s.metrics[0].itemId,'old');assert.equal(s.metrics[1].views,0);assert.equal(s.metrics[1].visits,null);assert.equal(s.metrics[0].runUrl,run);assert.equal(s.metrics[0].sourceUrl,snapshot().posts[0].sourceUrl);assert.deepEqual(s.naverStats,original.naverStats);assert.deepEqual(s.naverSync,original.naverSync);assert.equal(s.xp,30);
 assert.equal(saveNaverPosts(s,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS).duplicate,true);assert.equal(s.metrics.length,2);
});
test('새로 발견된 과거 글은 경험/본문/오늘 발행을 만들지 않고 역사 기록으로 보관한다',()=>{
 const s=initialState(),r=saveNaverPosts(s,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS);assert.equal(r.created,1);assert.equal(s.items[0].publishedAt,'2026-08-01');assert.equal(s.items[0].draft,'');assert.equal(s.items[0].locked,true);assert.equal(s.items[0].naverObservedPublished,true);assert.equal(s.xp,0);assert.equal(s.rewards.length,0);
 const unknown=initialState(),input=snapshot();input.posts[0].publishedDate=null;saveNaverPosts(unknown,normalizeNaverPosts(input,day,now),create,CHANNELS);assert.equal(unknown.items[0].publishedAt,undefined);assert.equal(unknown.items[0].date,'');assert.equal(unknown.items[0].publishedDatePrecision,'unknown');assert.equal(unknown.items[0].firstObservedDate,'2026-10-04');
});
test('별도 실행의 같은 날짜는 갱신하고 없는 날짜/수치를 만들지 않으며 이전 실행은 거절한다',()=>{
 const s=initialState();saveNaverPosts(s,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS);
 const next=snapshot();next.runUrl='https://agent.tinyfish.ai/runs/5eb6d931-08c0-4d03-8905-481780be0828';next.observedAt='2026-10-06T03:01:00Z';next.posts[0].rows=[{date:'2026-10-05',views:2}];saveNaverPosts(s,normalizeNaverPosts(next,day,new Date(next.observedAt)),create,CHANNELS);assert.equal(s.metrics.length,2);assert.equal(s.items.length,1);assert.equal(s.metrics.find(m=>m.date==='2026-10-05').views,2);assert.equal(naverPostsOverview(s).posts[0].measurementDays,2);assert.equal(naverPostsOverview(s).stats.runUrls,undefined);
 const stale={...next,runUrl:'https://agent.tinyfish.ai/runs/12345678-abcd-abcd-abcd-123456789012',observedAt:'2026-10-05T03:00:00Z'};assert.throws(()=>saveNaverPosts(s,stale,create,CHANNELS),/오래된/);
});
test('중복 원본 링크가 있으면 임의 연결을 보류하고 제목만 같은 다른 글에 연결하지 않는다',()=>{
 const s=initialState();s.items=[{id:'a',channel:'blog',title:'실제 옛 여행 글',url:snapshot().posts[0].url},{id:'b',channel:'blog',url:snapshot().posts[0].url}];const r=saveNaverPosts(s,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS);assert.equal(r.linked,0);assert.equal(s.metrics.length,0);assert.equal(s.items.length,2);assert.equal(r.warnings.length,1);
 const other=initialState();other.items=[{id:'not-same',title:'실제 옛 여행 글',channel:'blog',draft:'제목만 같음'}];saveNaverPosts(other,normalizeNaverPosts(snapshot(),day,now),create,CHANNELS);assert.equal(other.items.length,2);assert.notEqual(other.metrics[0].itemId,'not-same');
});
test('게시일 미확인 글도 28일 이상 실제 관측 이력이 있을 때만 감소 비교에 사용한다',()=>{
 const s=initialState(),input=snapshot();input.posts[0].publishedDate=null;input.posts[0].rows=[];
 for(let n=1;n<=28;n++){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);input.posts[0].rows.push({date:d.toISOString().slice(0,10),views:n<=14?1:20});}
 saveNaverPosts(s,normalizeNaverPosts(input,day,now),create,CHANNELS);const r=refreshSignals(s,day);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].basis,'views');assert.ok(r.candidates[0].cautions.some(c=>c.includes('정확한 게시일')));
});
test('게시일을 모르는 글의 과거 0 그래프는 글이 존재한 시점으로 사용하지 않는다',()=>{
 const s=initialState(),input=snapshot();input.posts[0].publishedDate=null;input.posts[0].rows=[{date:'2026-08-01',views:0},{date:'2026-10-05',views:20}];saveNaverPosts(s,normalizeNaverPosts(input,day,now),create,CHANNELS);assert.equal(s.naverPostCatalog[0].firstObservedDate,'2026-08-01');assert.equal(s.items[0].firstObservedDate,'2026-10-05');assert.equal(refreshSignals(s,day).candidates.length,0);
});
test('관측된 글별 통계 원본 URL은 같은 소유 게시글에 연결된 경우에만 허용한다',()=>{
 const input=snapshot();input.sourceUrl=input.posts[0].sourceUrl;assert.equal(normalizeNaverPosts(input,day,now).sourceUrl,input.sourceUrl);input.sourceUrl='https://blog.stat.naver.com/blog/article/999/cv';assert.throws(()=>normalizeNaverPosts(input,day,now));
});
