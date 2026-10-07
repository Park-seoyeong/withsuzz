// 상품 찾기 화면이 서버에서 받아오는 상품 JSON을 그대로 받아 적는다(화면 글자 읽기보다 정확하고 빠짐없음).
// 페이지 세계(MAIN world)에서 fetch·XHR 응답만 엿보고, window.__suzzRows에 상품 행을 모은다. 쿠키·비밀번호·로그인 요청 본문은 읽지 않는다.
(() => {
  if (window.__suzzHooked) return; window.__suzzHooked = true; window.__suzzRows = []; const seen = new Set();
  const num = v => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : null; };
  const pick = (o, keys) => { for (const k of keys) { if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } return undefined; };
  const NAME = ['productName', 'productTitle', 'itemName', 'name', 'title', 'prodNm', 'goodsName'];
  const PRICE = ['salePrice', 'discountedPrice', 'price', 'lowPrice', 'mobileLowPrice', 'finalPrice', 'sellPrice'];
  const RATE = ['commissionRate', 'rewardRate', 'affiliateRate', 'commission', 'rate', 'feeRate'];
  const AMOUNT = ['commissionAmount', 'expectedReward', 'reward', 'rewardAmount', 'commissionPrice', 'fee'];
  const URL_ = ['productUrl', 'linkUrl', 'url', 'link', 'mobileUrl', 'pcUrl'];
  const CAT = ['categoryName', 'category', 'wholeCategoryName', 'categoryFullName', 'category3Name', 'category2Name'];
  const BRAND = ['brandName', 'brand', 'mallName', 'makerName', 'maker'];
  const toRow = o => {
    const name = pick(o, NAME), price = num(pick(o, PRICE));
    if (typeof name !== 'string' || name.length < 2 || !price) return null;
    const rate = num(pick(o, RATE)), amount = num(pick(o, AMOUNT));
    const id = String(pick(o, ['productId', 'id', 'productNo', 'itemId', 'nvMid', 'prodId']) || name);
    return {id, name: name.replace(/<[^>]+>/g, '').trim().slice(0, 200), price, commissionRate: rate !== null ? String(rate <= 1 && rate > 0 ? Math.round(rate * 1000) / 10 : rate) : '', commissionAmount: amount !== null ? String(amount) : '', url: String(pick(o, URL_) || '').slice(0, 500), category: String(pick(o, CAT) || '').slice(0, 120), brand: String(pick(o, BRAND) || '').slice(0, 80), rating: pick(o, ['averageReviewScore', 'reviewScore', 'rating', 'score']) ?? '', reviews: pick(o, ['reviewCount', 'reviews', 'totalReviewCount']) ?? '', salesRank: pick(o, ['rank', 'salesRank', 'ranking']) ?? '', keys: Object.keys(o).slice(0, 30)};
  };
  window.suzzExtractRows = (json, depth = 0, out = []) => {
    if (!json || typeof json !== 'object' || depth > 12 || out.length >= 2000) return out;
    if (Array.isArray(json)) { for (const x of json) { const r = x && typeof x === 'object' && !Array.isArray(x) ? toRow(x) : null; if (r) out.push(r); else window.suzzExtractRows(x, depth + 1, out); } return out; }
    for (const k in json) window.suzzExtractRows(json[k], depth + 1, out);
    return out;
  };
  const take = text => { if (!text || text.length > 5e6 || !/[{[]/.test(text[0])) return; let j; try { j = JSON.parse(text); } catch { return; } for (const r of window.suzzExtractRows(j)) { const key = r.id + '|' + r.name; if (!seen.has(key)) { seen.add(key); window.__suzzRows.push(r); } } };
  const of = window.fetch; window.fetch = async function (...a) { const res = await of.apply(this, a); try { const ct = res.headers.get('content-type') || ''; if (/json/i.test(ct)) res.clone().text().then(take).catch(() => {}); } catch {} return res; };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__suzzUrl = String(u || ''); return oo.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (...a) { this.addEventListener('load', () => { try { if (/json/i.test(this.getResponseHeader('content-type') || '') && typeof this.responseText === 'string') take(this.responseText); } catch {} }); return os.apply(this, a); };
})();
