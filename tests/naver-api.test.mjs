import test from 'node:test';
import assert from 'node:assert/strict';
import {collect, sign, cleanKeywords} from '../extension/naver-api.js';
import {initialState} from '../worker/domain.mjs';
import {saveApiData, keywordOpportunities, saveProducts} from '../worker/products.mjs';

const keys = {clientId: 'cid', clientSecret: 'csec', adKey: 'akey', adSecret: 'asec', adCustomer: '1234'};
const ok = body => ({ok: true, status: 200, json: async () => body});
function mock(overrides = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({url, init});
    if (url.startsWith('https://openapi.naver.com/v1/search/shop.json')) return overrides.shop?.(url) || ok({total: 1234, items: [{title: '<b>가습기</b> 초음파 3L', lprice: '39000', mallName: '네이버', brand: '미로', link: 'https://smartstore.naver.com/a/1', productId: '1', category1: '디지털/가전', category2: '계절가전'}, {title: '가습기 대용량', lprice: '59000', mallName: 'A몰', link: 'https://shopping.naver.com/b/2'}]});
    if (url === 'https://openapi.naver.com/v1/datalab/search') { const b = JSON.parse(init.body); return overrides.lab?.(b) || ok({results: b.keywordGroups.map(g => ({title: g.groupName, keywords: g.keywords, data: Array.from({length: 13}, (_, i) => ({period: '2026-07-' + String(i + 1).padStart(2, '0'), ratio: i >= 9 ? 60 : 40}))}))}); }
    if (url.startsWith('https://api.searchad.naver.com/keywordstool')) return overrides.ad?.(url, init) || ok({keywordList: [{relKeyword: '가습기', monthlyPcQcCnt: 12000, monthlyMobileQcCnt: 48000, monthlyAvePcClkCnt: 50.5, monthlyAveMobileClkCnt: 200.1, compIdx: '높음', plAvgDepth: 15}, {relKeyword: '가습기추천', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: 900, compIdx: '중간'}]});
    throw new Error('unexpected ' + url);
  };
  return {fn, calls};
}
const now = new Date('2026-10-06T00:00:00Z'), pause = async () => {};

test('검색광고 서명은 timestamp.GET./keywordstool 의 HMAC-SHA256 base64', async () => {
  const {createHmac} = await import('node:crypto');
  assert.equal(await sign('asec', '1.GET./keywordstool'), createHmac('sha256', 'asec').update('1.GET./keywordstool').digest('base64'));
  assert.deepEqual(cleanKeywords(['가습기', ' 가습기 ', 'a', '제주 억새']), ['가습기', '제주 억새']);
});

test('세 API를 불러 결과 숫자만 담고, 키는 결과에 넣지 않는다', async () => {
  const {fn, calls} = mock();
  const it = await collect(['가습기'], keys, {fetchFn: fn, now, pause});
  assert.equal(it.kind, 'api'); assert.deepEqual(it.errors, []);
  assert.equal(it.data.shopping[0].lowPrice, 39000); assert.equal(it.data.shopping[0].items[0].name, '가습기 초음파 3L');
  assert.equal(it.data.trends[0].keyword, '가습기'); assert.equal(Math.round(it.data.trends[0].change * 100), 50);
  assert.deepEqual(it.data.volumes[0], {keyword: '가습기', monthlyPc: 12000, monthlyMobile: 48000, volume: 60000, clicks: 250.6, compIdx: '높음', adDepth: 15});
  assert.equal(it.data.related[0].keyword, '가습기추천'); assert.equal(it.data.related[0].volume, 905);
  const ad = calls.find(c => c.url.includes('searchad'));
  assert.equal(ad.init.headers['X-Signature'], await sign('asec', now.getTime() + '.GET./keywordstool'));
  assert.equal(ad.init.headers['X-Customer'], '1234');
  assert.ok(!JSON.stringify(it).includes('csec') && !JSON.stringify(it).includes('asec'));
});

test('한 API가 실패해도 나머지는 살리고, 실패는 그대로 남긴다', async () => {
  const {fn} = mock({ad: () => ({ok: false, status: 403, json: async () => ({title: 'Forbidden'})})});
  const it = await collect(['가습기'], keys, {fetchFn: fn, now, pause});
  assert.equal(it.data.volumes.length, 0); assert.equal(it.data.shopping.length, 1);
  assert.match(it.errors[0], /검색광고 403.*키가 맞는지/);
  const none = await collect(['가습기'], {}, {fetchFn: fn, now, pause});
  assert.match(none.errors.join(), /API 키가 아직 없어요/);
});

test('사이트는 API 숫자를 저장해 키워드 점수(규모·경쟁·급등)에 쓰고, 쇼핑 결과는 별도 출처로 바꿔 담는다', async () => {
  const {fn} = mock();
  const it = await collect(['가습기'], keys, {fetchFn: fn, now, pause});
  const s = initialState();
  saveProducts(s, {source: 'brand', keyword: '가습기', rows: [{name: '초음파 가습기', commissionAmount: '1500', salesRank: '2'}]});
  const before = keywordOpportunities(s, '2026-10-06').find(k => k.keyword === '가습기');
  assert.equal(before.parts.volume, undefined); assert.equal(before.metric, null);
  const r = saveApiData(s, it, '2026-10-06T01:00:00Z');
  assert.equal(r.metrics, 1); assert.equal(r.products, 2);
  assert.equal(saveApiData(s, it).skipped, true, '같은 결과를 두 번 저장하지 않는다');
  assert.equal(s.products.filter(p => p.source === 'naverShop').length, 2);
  assert.equal(s.products.find(p => p.source === 'naverShop').salesRank, null, '쇼핑 검색 순위를 판매 순위로 꾸미지 않는다');
  const k = keywordOpportunities(s, '2026-10-06').find(x => x.keyword === '가습기');
  assert.equal(k.metric.volume, 60000); assert.equal(k.metric.compIdx, '높음'); assert.equal(k.metric.lowPrice, 39000);
  assert.equal(k.parts.volume, 96); assert.equal(k.parts.competition, 25); assert.equal(k.parts.rising, 100);
  assert.equal(k.product.source, 'brand', '추천 상품은 제휴 상품에서만 고른다');
  const again = await collect(['가습기'], keys, {fetchFn: mock().fn, now: new Date('2026-10-06T06:00:00Z'), pause});
  saveApiData(s, again);
  assert.equal(s.products.filter(p => p.source === 'naverShop').length, 2, '같은 키워드의 이전 API 상품은 새 결과로 바뀐다');
});

test('데이터랩이 없으면 검색량 기록이 14일 이상 쌓였을 때 그 변화로 급등을 계산한다', async () => {
  const {volumeChange} = await import('../worker/products.mjs');
  assert.equal(volumeChange([{date: '2026-10-01', volume: 100}, {date: '2026-10-10', volume: 200}]), null, '14일 미만은 계산하지 않음');
  assert.deepEqual(volumeChange([{date: '2026-09-01', volume: 100}, {date: '2026-09-20', volume: 120}, {date: '2026-10-06', volume: 150}]), {change: 0.25, days: 16});
  const s = initialState();
  const item = (at, volume) => ({kind: 'api', capturedAt: at, parts: {search: false, ad: true}, errors: [], data: {volumes: [{keyword: '제주 여행', volume, compIdx: '높음'}]}});
  saveApiData(s, item('2026-09-15T01:00:00Z', 40000)); saveApiData(s, item('2026-09-15T05:00:00Z', 41000));
  assert.equal(s.keywordMetrics[0].history.length, 1, '하루에 한 번만 남김');
  saveApiData(s, item('2026-10-06T01:00:00Z', 61500));
  const k = keywordOpportunities(s, '2026-10-06').find(x => x.keyword === '제주 여행');
  assert.equal(k.metric.change, null); assert.equal(k.metric.volumeChange.days, 21); assert.equal(k.parts.rising, 100);
});

test('블로그 RSS를 읽어 제목·주소·시각을 꺼내고, 사이트는 제목이 같은 예정 글만 게시 확인한다', async () => {
  const {parseRss, blogFeed} = await import('../extension/naver-api.js');
  const xml = `<rss><channel><item><title><![CDATA[제주 억새 명소 5곳 &amp; 코스]]></title><link><![CDATA[https://blog.naver.com/withsuzz/224000000001?fromRss=true&amp;trackingCode=rss]]></link><pubDate>Tue, 06 Oct 2026 21:00:00 +0900</pubDate></item><item><title>다른 글</title><link>https://blog.naver.com/withsuzz/224000000002</link><pubDate>x</pubDate></item><item><title>외부</title><link>https://evil.example/1</link></item></channel></rss>`;
  const rows = parseRss(xml);
  assert.deepEqual(rows[0], {title: '제주 억새 명소 5곳 & 코스', url: 'https://blog.naver.com/withsuzz/224000000001', publishedAt: '2026-10-06T12:00:00.000Z'});
  assert.equal(rows.length, 2); assert.equal(rows[1].publishedAt, '');
  assert.equal(await blogFeed('bad id!'), null);
  const feed = await blogFeed('withsuzz', async () => ({ok: true, text: async () => xml}));
  const {DatabaseSync} = await import('node:sqlite'), {readFileSync} = await import('node:fs'), {default: worker} = await import('../dist/server/index.js');
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql', import.meta.url), 'utf8'));
  const env = {ARTIFACT: '1', DB: {prepare(q) { let a = []; return {bind(...x) { a = x; return this; }, async first() { return sql.prepare(q).get(...a) || null; }, async run() { return {meta: {changes: sql.prepare(q).run(...a).changes}}; }}; }}};
  const call = async (p, b) => { const r = await worker.fetch(new Request('https://t.local' + p, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {}), env); return r.json(); };
  await call('/api/action', {action: 'saveItem', item: {title: '제주 억새 명소 5곳', channel: 'blog'}});
  await call('/api/action', {action: 'saveItem', item: {title: '아직 안 올린 글', channel: 'blog'}});
  const r = (await call('/api/action', {action: 'applyBlogFeed', item: feed})).result;
  assert.equal(r.confirmed.length, 1);
  const st = (await call('/api/state')).state, a = st.items.find(i => i.title === '제주 억새 명소 5곳');
  assert.equal(a.status, '게시됨'); assert.equal(a.url, 'https://blog.naver.com/withsuzz/224000000001'); assert.equal(st.items.find(i => i.title === '아직 안 올린 글').status, '아이디어');
  assert.equal((await call('/api/action', {action: 'applyBlogFeed', item: feed})).result.confirmed.length, 0, '같은 글은 다시 확인하지 않음');
});

test('쇼핑 화면 읽기는 화면 속 상품 목록에서 이름·가격·판매처·리뷰만 꺼내고, 자동입력 방지 화면을 알아챈다', async () => {
  const {readShopping} = await import('../extension/shoppage.js');
  const data = {props: {pageProps: {initialState: {products: {list: [{item: {id: '1', productTitle: '<b>가습기</b> 초음파', lowPrice: '39,000', mallName: '네이버', reviewCount: 1200, purchaseCnt: 300, crUrl: 'https://cr.shopping.naver.com/a', category1Name: '디지털'}}, {item: {id: '2', productName: '가습기 대용량', price: 59000, mallName: 'A몰', crUrl: 'javascript:alert(1)'}}, {item: {id: '3', title: '광고 배너'}}]}}}}};
  globalThis.document = {getElementById: () => ({textContent: JSON.stringify(data)}), body: {innerText: '가습기 검색 결과'}}; globalThis.location = {href: 'https://search.shopping.naver.com/search/all?query=x'};
  const r = readShopping();
  assert.equal(r.blocked, false); assert.equal(r.items.length, 2);
  assert.deepEqual([r.items[0].name, r.items[0].price, r.items[0].reviews, r.items[0].purchases, r.items[0].url], ['가습기 초음파', 39000, 1200, 300, 'https://cr.shopping.naver.com/a']);
  assert.equal(r.items[1].url, '', 'https가 아닌 주소는 버림');
  globalThis.document = {getElementById: () => null, body: {innerText: '자동입력 방지 문자를 입력해 주세요'}};
  assert.equal(readShopping().blocked, true);
  delete globalThis.document; delete globalThis.location;
});
