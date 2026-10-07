import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function load() {
  const w = {fetch: async () => ({headers: {get: () => 'application/json'}, clone() { return this; }, text: async () => '{"items":[{"productName":"앤커 보조배터리","salePrice":"39,900","commissionRate":0.03,"productId":"p1","linkUrl":"https://brandconnect.naver.com/p/1"}]}'})};
  class XHR { open() {} send() {} addEventListener() {} }
  const ctx = {window: w, XMLHttpRequest: XHR, Number, String, Object, Array, JSON, Set, Math, Promise, console};
  ctx.window = w; w.XMLHttpRequest = XHR;
  vm.runInNewContext(readFileSync(new URL('../extension/nethook.js', import.meta.url), 'utf8'), ctx);
  return w;
}
test('상품 JSON 응답에서 상품명·가격·수수료율·링크를 뽑고, 비율형 수수료는 %로 바꾼다', async () => {
  const w = load();
  const rows = w.suzzExtractRows({data: {list: [{productName: 'A 가습기', price: 59000, commissionAmount: 2500, categoryName: '생활', reviewCount: 12}, {title: '글자만'}, {productTitle: 'B <b>스탠드</b>', lowPrice: '12,000', rewardRate: 5}]}});
  assert.equal(rows.length, 2); assert.equal(rows[0].name, 'A 가습기'); assert.equal(rows[0].commissionAmount, '2500'); assert.equal(rows[1].name, 'B 스탠드'); assert.equal(rows[1].commissionRate, '5');
  await w.fetch('https://x/api');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(w.__suzzRows.length, 1); assert.equal(w.__suzzRows[0].commissionRate, '3'); assert.equal(w.__suzzRows[0].url, 'https://brandconnect.naver.com/p/1');
});
