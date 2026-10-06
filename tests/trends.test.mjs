import test from 'node:test';
import assert from 'node:assert/strict';
import {TREND_FEEDS,parseTrendFeed,trendTrafficLowerBound,fetchTrendSnapshot,trendRecommendations,trendCacheFresh,chooseTrendRecommendation} from '../worker/trends.mjs';
const now='2026-10-06T09:00:00.000Z';
const rss=(title='상하이 면세',date=now)=>`<rss><channel><item><title><![CDATA[${title}]]></title><link>https://trends.google.com/trending?geo=KR</link><pubDate>${new Date(date).toUTCString()}</pubDate><ht:approx_traffic>2K+</ht:approx_traffic></item></channel></rss>`;
const source=(kind='search',xml=rss())=>({...TREND_FEEDS[kind==='news'?1:0],checkedAt:now,status:'연결됨',rows:parseTrendFeed(xml,TREND_FEEDS[kind==='news'?1:0],now)});
const state=()=>({items:[],xp:0,trendSnapshot:{lastAttemptAt:now,sources:[source()]}});
test('실제 RSS 검색량은 근사 하한으로만 읽고 기사에는 검색량을 만들지 않는다',()=>{
 const rows=parseTrendFeed(rss('상하이 &amp; 면세'),TREND_FEEDS[0],now);assert.equal(rows[0].title,'상하이 & 면세');assert.equal(rows[0].trafficLowerBound,2000);
 const news=parseTrendFeed(rss(),TREND_FEEDS[1],now);assert.equal(news[0].trafficLabel,null);assert.equal(news[0].trafficLowerBound,null);
 assert.equal(trendTrafficLowerBound('20,000+'),20000);assert.equal(trendTrafficLowerBound('1.5M+'),1500000);assert.equal(trendTrafficLowerBound('높음'),null);
});
test('날짜가 없거나 미래·48시간 이전 자료와 비RSS 자료를 신뢰하지 않는다',()=>{
 assert.equal(parseTrendFeed(rss('예전','2026-10-03T09:00:00Z'),TREND_FEEDS[0],now).length,0);
 assert.equal(parseTrendFeed(rss('미래','2026-10-07T09:00:00Z'),TREND_FEEDS[0],now).length,0);
 assert.equal(parseTrendFeed(rss().replace(/<pubDate>.*?<\/pubDate>/,''),TREND_FEEDS[0],now).length,0);
 assert.throws(()=>parseTrendFeed('<html>로그인</html>',TREND_FEEDS[0],now),/RSS/);
});
test('고정한 피드만 요청하고 실패한 공급자의 마지막 성공 시각을 보존한다',async()=>{
 const old={sources:[source()]},urls=[],snapshot=await fetchTrendSnapshot(old,'2026-10-06T09:15:00Z',async url=>{urls.push(url);return url.includes('trends.google.com')?new Response('blocked',{status:403}):new Response(rss('포천 정원축제 - 신문'));});
 assert.deepEqual(urls,TREND_FEEDS.map(f=>f.url));assert.equal(snapshot.sources[0].checkedAt,now);assert.equal(snapshot.sources[0].rows[0].sourceCheckedAt,now);assert.ok(snapshot.sources[0].error);assert.equal(snapshot.sources[1].status,'연결됨');
 assert.equal(trendCacheFresh({trendSnapshot:snapshot},'2026-10-06T09:20:00Z'),true);assert.equal(trendCacheFresh({trendSnapshot:snapshot},'2026-10-06T09:30:00Z'),false);
});
test('과대 피드와 형식 오류는 수집 성공으로 기록하지 않는다',async()=>{
 const result=await fetchTrendSnapshot({},now,async()=>new Response('<html>오류</html>'));
 assert.ok(result.sources.every(s=>s.status==='확인 필요'&&s.checkedAt===null));
 const oversized=await fetchTrendSnapshot({},now,async()=>new Response(rss(),{headers:{'Content-Length':'2000000'}}));assert.ok(oversized.sources.every(s=>s.error));
});
test('뉴스 글감과 실제 검색량은 분리하고 표본 수를 전체 검색량으로 바꾸지 않는다',()=>{
 const s=state();s.trendSnapshot.sources=[source('news',rss('포천 정원축제 - 신문'))];
 const report=trendRecommendations(s,now),row=report.rows[0];assert.equal(row.keyword,'포천 정원축제');assert.equal(row.search,null);assert.equal(row.newsMentions,1);assert.equal(row.scoreParts.searchSignal,0);assert.match(row.cautions[0],/검색량/);assert.equal(report.providers.find(p=>p.name.includes('네이버')).connected,false);
});
test('유입·준비된 글감 연결과 최근 발행·같은 지역 감점을 실제 자료로 계산한다',()=>{
 const s=state();s.naverStats={observedAt:now,keywordDate:'2026-10-06',keywords:[{keyword:'상하이 면세 쇼핑',percentage:2}]};s.items=[{id:'draft',title:'상하이 면세 정보',channel:'blog',status:'초안 작성',prep:{photos:true,outline:true},region:'상하이'}];
 const first=trendRecommendations(s,now).rows[0];assert.equal(first.scoreParts.blogSignal,15);assert.equal(first.scoreParts.ready,5);assert.equal(first.relatedItems[0].id,'draft');
 s.items.push({id:'recent',title:'상하이 면세 쇼핑',channel:'blog',status:'게시됨',publishedAt:'2026-10-05T00:00:00Z'},{id:'today',title:'다른 글',channel:'blog',region:'상하이',date:'2026-10-06'});
 const second=trendRecommendations(s,now).rows[0];assert.equal(second.scoreParts.overlapPenalty,20);assert.equal(second.scoreParts.regionPenalty,10);assert.equal(first.score-second.score,30);
 s.naverStats.observedAt='2026-09-01T00:00:00Z';assert.equal(trendRecommendations(s,now).rows[0].scoreParts.blogSignal,0);
});
test('추천을 선택해도 직접 원고·일정·상태·경험치·통계는 유지하고 중복 등록하지 않는다',()=>{
 const s=state(),id=trendRecommendations(s,now).rows[0].id,create=x=>({...x,id:'new',status:'아이디어',draft:''});
 const input={id,snapshotAt:now};const first=chooseTrendRecommendation(s,input,create,now);assert.equal(s.items.length,1);assert.equal(first.item.date,'');assert.equal(first.item.trendSource.keyword,'상하이 면세');assert.equal(s.xp,0);
 assert.equal(chooseTrendRecommendation(s,input,create,now).duplicate,true);assert.equal(s.items.length,1);assert.throws(()=>chooseTrendRecommendation(s,{...input,snapshotAt:'old'},create,now),/갱신/);
 const direct={id:'manual',channel:'blog',title:'상하이 면세 준비',draft:'내가 쓴 원고',status:'초안 작성',date:'',notes:'원래 메모'};s.items=[direct];chooseTrendRecommendation(s,input,create,now);assert.equal(s.items.length,1);assert.equal(direct.draft,'내가 쓴 원고');assert.equal(direct.status,'초안 작성');assert.equal(direct.notes,'원래 메모');
 assert.throws(()=>chooseTrendRecommendation(s,input,create,'2026-10-09T09:00:00Z'),/유효 시간/);
});
test('Bing RSS는 실제 원문 HTTPS 링크와 공급자 표시를 보존한다',()=>{
 const xml=`<rss><channel><item><title>한글날 연휴 여행</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2Fexample.com%2Fstory</link><pubDate>${new Date(now).toUTCString()}</pubDate><News:Source>실제 매체</News:Source></item></channel></rss>`;
 const row=parseTrendFeed(xml,TREND_FEEDS[2],now)[0];assert.equal(row.url,'https://example.com/story');assert.equal(row.publisher,'실제 매체');assert.equal(row.trafficLabel,null);
});
