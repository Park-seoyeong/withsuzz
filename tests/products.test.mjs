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

test('품목 키워드: 화면 이름 같은 키워드는 점수에 쓰지 않고, 상품별 품목으로 바꾼다',async()=>{
 const {rekeyProducts,genericProducts}=await import('../worker/products.mjs');
 const s=initialState();
 saveProducts(s,{source:'brand',keyword:'홍보할 상품 찾기',rows:[{name:'삼성 갤럭시 S26 FE',price:'1033650',item:'스마트폰'},{name:'쿠쿠 음식물처리기 3L',price:'499000'}]});
 assert.equal(s.products[0].keyword,'스마트폰');assert.deepEqual(s.products[0].keywords,['스마트폰']);
 assert.equal(s.products[1].keyword,'홍보할 상품 찾기');assert.equal(genericProducts(s).length,2,'품목 "스마트폰"도 상품명에 없으니 다시 매길 대상');
 assert.equal(rekeyProducts(s,{[s.products[1].id]:'음식물처리기',[s.products[0].id]:'',nope:'x'}),1);
 assert.equal(s.products[1].keyword,'음식물처리기');assert.deepEqual(s.products[1].keywords,['음식물처리기']);
 const ks=keywordOpportunities(s,'2026-10-07');assert.ok(!ks.some(k=>k.keyword==='홍보할 상품 찾기'));assert.ok(ks.some(k=>k.keyword==='음식물처리기'));
});

test('손익은 수익 − (고정 비용 + AI API)이고, 수익 기록이 없는 달은 손익을 내지 않는다',async()=>{
 const {profitReport}=await import('../worker/products.mjs');
 const s=initialState();s.settings.costs=[{name:'Claude 구독',monthly:'29000'},{name:'',monthly:'1'}];
 saveEarnings(s,{rows:[{date:'2026-10-02',platform:'brand',revenue:'50000'},{date:'2026-10-03',platform:'threehours',revenue:'12000'},{date:'2026-09-10',platform:'adpost',revenue:'8000'}]});
 recordAIUse(s,{feature:'글쓰기',provider:'anthropic',model:'claude-opus-5-5',inputTokens:100000,outputTokens:10000},'2026-10-05T03:00:00Z');
 const p=profitReport(s,'2026-10-07',1400,3);
 assert.deepEqual(p.rows.map(r=>r.month),['2026-08','2026-09','2026-10']);assert.equal(p.rows[0].profit,null);assert.equal(p.rows[1].profit,8000-29000);
 const c=p.current;assert.equal(c.revenue,62000);assert.equal(c.ai,Math.round((100000*4+10000*20)/1e6*1400));assert.equal(c.profit,62000-29000-c.ai);assert.equal(c.byPlatform.threehours,12000);assert.ok(p.projected>c.profit);
});

test('봤어요·빼기한 키워드는 추천에서 빠지고 되돌리면 다시 나온다', async () => {
  const {DatabaseSync} = await import('node:sqlite'), {readFileSync} = await import('node:fs'), {default: worker} = await import('../dist/server/index.js');
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql', import.meta.url), 'utf8'));
  const env = {ARTIFACT: '1', DB: {prepare(q) { let a = []; return {bind(...x) { a = x; return this; }, async first() { return sql.prepare(q).get(...a) || null; }, async run() { return {meta: {changes: sql.prepare(q).run(...a).changes}}; }}; }}};
  const call = async (p, b) => { const r = await worker.fetch(new Request('https://t.local' + p, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {}), env); return r.json(); };
  await call('/api/action', {action: 'saveProducts', source: 'brand', keyword: '보조배터리', rows: [{name: 'A 보조배터리', price: '39000', commissionAmount: '1500', salesRank: '1'}]});
  const kws = () => call('/api/state').then(d => d.commerce.keywords.map(k => k.keyword));
  assert.ok((await kws()).includes('보조배터리'));
  await call('/api/action', {action: 'dismissKeyword', keyword: '보조 배터리'});
  assert.ok(!(await kws()).includes('보조배터리'));
  await call('/api/action', {action: 'dismissKeyword', keyword: '보조배터리', undo: true});
  assert.ok((await kws()).includes('보조배터리'));
});

test('상품 글감은 같은 상품으로 두 번 만들지 않고, 겹친 빈 글감은 정리된다', async () => {
  const {DatabaseSync} = await import('node:sqlite'), {readFileSync} = await import('node:fs'), {default: worker} = await import('../dist/server/index.js');
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql', import.meta.url), 'utf8'));
  const env = {ARTIFACT: '1', DB: {prepare(q) { let a = []; return {bind(...x) { a = x; return this; }, async first() { return sql.prepare(q).get(...a) || null; }, async run() { return {meta: {changes: sql.prepare(q).run(...a).changes}}; }}; }}};
  const call = async (p, b) => { const r = await worker.fetch(new Request('https://t.local' + p, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {}), env); return r.json(); };
  await call('/api/action', {action: 'saveProducts', source: 'brand', keyword: '오메가3', rows: [{name: '블랙모어스 오메가3', price: '29000', commissionAmount: '900', salesRank: '1'}]});
  const pid = (await call('/api/state')).state.products[0].id;
  const a = (await call('/api/action', {action: 'productToItem', id: pid})).result, b = (await call('/api/action', {action: 'productToItem', id: pid})).result;
  assert.equal(a.id, b.id);
  await call('/api/action', {action: 'saveItem', item: {title: a.title, productId: pid, channel: 'blog', type: 'affiliate'}});
  const r = await call('/api/action', {action: 'dedupeProductItems'}); assert.equal(r.result.removed, 0); assert.equal((await call('/api/state')).state.items.filter(i => i.productId === pid).length, 1);
});

test('리뷰가 많고 수수료가 괜찮은 카탈로그 품목은 검색량이 없어도 골든이 된다', async () => {
  const {keywordOpportunities, saveProducts} = await import('../worker/products.mjs');
  const state = {items: [], products: [], keywordMetrics: [], dismissedKeywords: []};
  saveProducts(state, {source: 'brand', keyword: '오메가3', rows: [{name: '블랙모어스 오메가3 80캡슐', price: '47900', commissionRate: '18', rating: '4.86', reviews: '11023', url: 'https://brandconnect.naver.com/1/affiliate/products/2'}]});
  saveProducts(state, {source: 'brand', keyword: '싱크볼', rows: [{name: '사각싱크볼 교체', price: '50000', commissionRate: '48', rating: '4.9', reviews: '12', url: 'https://brandconnect.naver.com/1/affiliate/products/3'}]});
  const rows = keywordOpportunities(state, '2026-10-07', 20), o = rows.find(k => k.keyword === '오메가3'), s = rows.find(k => k.keyword === '싱크볼');
  assert.ok(o.parts.interest >= 70 && o.golden, JSON.stringify(o.parts));
  assert.ok(s.parts.interest < 70 && !s.golden, JSON.stringify(s.parts));
  assert.equal(o.product.reviews, 11023); assert.ok(o.score > s.score);
});
