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
