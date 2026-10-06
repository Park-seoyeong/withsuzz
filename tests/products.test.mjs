import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../worker/domain.mjs';
import {saveProducts,scoreProducts,productDraftItem,seasonCalendar,saveEarnings,earningsReport,platformCards,keywordOpportunities,postPerformance,recordAIUse,aiSpend} from '../worker/products.mjs';

test('상품 담기는 화면 값만 저장하고 같은 링크는 갱신하며, 점수는 없는 값을 빼고 계산한다',()=>{
 const s=initialState();
 assert.throws(()=>saveProducts(s,{source:'x',keyword:'a',rows:[{name:'a'}]}),/출처/);
 assert.throws(()=>saveProducts(s,{source:'brand',keyword:'',rows:[{name:'a'}]}),/키워드/);
 const r=saveProducts(s,{source:'brand',keyword:'보조배터리',rows:[{name:'앤커 보조배터리 10000',price:'39,900',commissionRate:'3',rating:'4.8',reviews:'2,401',salesRank:'1',url:'https://brandconnect.naver.com/p/1'},{name:'무명 보조배터리',price:'9900',commissionAmount:'',rating:'3.2',reviews:'4',salesRank:''},{name:''}]});
 assert.deepEqual(r,{added:2,updated:0,total:2});
 const a=s.products[0];assert.equal(a.price,39900);assert.equal(a.commissionAmount,1197);assert.equal(a.commissionEstimated,true);assert.equal(s.products[1].salesRank,null);
 saveProducts(s,{source:'brand',keyword:'캠핑 보조배터리',rows:[{name:'앤커 보조배터리 10000',price:'35900',url:'https://brandconnect.naver.com/p/1'}]});
 assert.equal(s.products.length,2);assert.equal(s.products[0].price,35900);assert.deepEqual(s.products[0].keywords,['보조배터리','캠핑 보조배터리']);
 const scored=scoreProducts(s.products,'보조배터리');
 assert.equal(scored[0].pass,true);assert.equal(scored[1].pass,false,'평점 4 미만·리뷰 10 미만은 조건 미달');
 assert.equal(scored[1].parts.sales,undefined);assert.ok(scored[0].score>scored[1].score);assert.equal(scored.find(p=>p.recommendRank===1).id,s.products[0].id);
 const item=productDraftItem(s.products[0]);assert.match(item.notes,/사용 후기처럼 쓰지 않는다/);assert.equal(item.links,'https://brandconnect.naver.com/p/1');assert.match(item.provided,/수수료/);
});

test('시즌 캘린더는 해를 넘는 시즌도 계산하고 주제가 겹치지 않게 고른다',()=>{
 const oct=seasonCalendar('2026-10-06');assert.equal(oct.length,4);assert.equal(new Set(oct.map(s=>s.cat)).size,4);
 assert.ok(oct.every(s=>s.startsIn<=45));const run=oct.find(s=>s.id==='autumn-hike');assert.equal(run.status,'지금 쓸 때');assert.equal(run.startsIn,4);
 const dec=seasonCalendar('2026-12-28');assert.ok(dec.some(s=>s.id==='newyear'&&s.status==='한창'&&s.endDate==='2027-01-03'));
});

test('수익 장부는 날짜·플랫폼별로 갱신하고, 월별 합계·전기 대비·월말 예상을 낸다',()=>{
 const s=initialState();
 assert.throws(()=>saveEarnings(s,{rows:[{date:'2026-13-01',platform:'brand',revenue:1}]}),/줄이 없어요/);
 saveEarnings(s,{rows:[{date:'2026-08-10',platform:'brand',sales:'100,000',revenue:'4,000',orders:'2',clicks:'50'},{date:'2026-09-03',platform:'brand',sales:'200000',revenue:'8000',orders:'3',clicks:'100'},{date:'2026-10-02',platform:'myrealtrip',sales:'50000',revenue:'2000',orders:'1'},{date:'2026-10-02',platform:'nope',revenue:'1'}]});
 const up=saveEarnings(s,{rows:[{date:'2026-09-03',platform:'brand',revenue:'9000'}]});assert.equal(up.updated,1);assert.equal(s.earnings.find(e=>e.date==='2026-09-03').sales,200000);
 const r=earningsReport(s,{grain:'month',today:'2026-10-06'});
 assert.deepEqual(r.buckets.map(b=>b.key),['2026-08','2026-09','2026-10']);assert.equal(r.buckets[1].change,9000/4000-1);
 assert.equal(r.buckets[2].projectedRevenue,Math.round(2000/6*31));assert.equal(r.summary.revenue,15000);assert.equal(r.summary.bestMonth.month,'2026-09');
 assert.equal(r.buckets[2].clicks,null,'클릭이 없는 달은 0이 아니라 비워 둔다');
 assert.equal(earningsReport(s,{grain:'month',platform:'myrealtrip',today:'2026-10-06'}).summary.revenue,2000);
 const cards=platformCards(s,'2026-10-06');assert.deepEqual(cards.map(c=>c.id),['brand','myrealtrip']);assert.equal(cards[0].spark.length,12);assert.equal(cards[0].monthRevenue,null);
});

test('팔기 좋은 키워드·글별 성과·AI 비용은 측정된 값만 쓴다',()=>{
 const s=initialState();saveProducts(s,{source:'brand',keyword:'가습기',rows:[{name:'초음파 가습기',salesRank:'2',commissionAmount:'3000',rating:'4.7',reviews:'500'}]});
 const ks=keywordOpportunities(s,'2026-10-06');const g=ks.find(k=>k.keyword==='가습기');assert.ok(g);assert.ok(g.from.includes('담은 상품'));assert.ok(g.from.includes('시즌'));assert.equal(g.parts.gap,100);assert.equal(g.product.name,'초음파 가습기');assert.equal(g.parts.inflow,undefined);
 s.items.push({id:'i1',title:'제주 억새',keyword:'제주 억새',publishedAt:'2026-10-01T12:00:00+09:00'});
 s.metrics.push({itemId:'i1',date:'2026-10-02',views:100,conversions:1,revenue:2500,likes:5,measuredFields:['views','conversions','revenue','likes']});
 const p=postPerformance(s);assert.equal(p.rows[0].views,100);assert.equal(p.rows[0].comments,null);assert.equal(p.rows[0].rpm,25000);assert.equal(p.summary.searchShare,null);
 recordAIUse(s,{feature:'글쓰기',provider:'anthropic',model:'claude-opus-5-5',inputTokens:10000,outputTokens:2000},'2026-10-05T03:00:00Z');recordAIUse(s,{feature:'글쓰기',provider:'artifact',model:'Claude (내 계정)'},'2026-10-06T03:00:00Z');
 const a=aiSpend(s,'2026-10-06',1400);assert.equal(a.calls,2);assert.equal(a.unpriced,1);assert.equal(a.monthKrw,Math.round((10000*4+2000*20)/1e6*1400));assert.equal(a.days.at(-1).usd,null);assert.equal(a.days.at(-1).calls,1);
});
