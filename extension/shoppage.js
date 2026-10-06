// 쇼핑 최저가 (API 없이): 네이버 쇼핑 검색 화면을 뒤쪽 탭으로 열어, 화면이 이미 가지고 있는 상품 목록(__NEXT_DATA__)에서
// 상품명·최저가·판매처·리뷰 수만 읽고 닫는다. 써즈님이 직접 검색해 보는 것과 같은 화면이며, 로그인 정보는 읽지 않는다.
const wait = ms => new Promise(r => setTimeout(r, ms));
function waitLoaded(tabId, timeout = 30000) {
  return new Promise(resolve => {
    const done = ok => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(ok); };
    const on = (id, info) => { if (id === tabId && info.status === 'complete') done(true); };
    const timer = setTimeout(() => done(false), timeout);
    chrome.tabs.onUpdated.addListener(on);
  });
}
// 페이지 안에서 실행: JSON 구조가 바뀌어도 되도록, 상품처럼 생긴 객체(이름+가격)를 깊이 찾아 모은다.
export function readShopping() {
  const num = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
  const out = [], seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 14 || out.length >= 40) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    const name = o.productTitle || o.productName || o.title, price = num(o.lowPrice ?? o.price ?? o.mobileLowPrice);
    if (typeof name === 'string' && name.length > 2 && price && (o.lowPrice !== undefined || o.mallName !== undefined || o.productId !== undefined)) {
      const key = String(o.id || o.productId || name);
      if (!seen.has(key)) { seen.add(key); out.push({name: name.replace(/<[^>]+>/g, '').trim(), price, mall: String(o.mallName || o.mallNameOrg || ''), brand: String(o.brand || o.maker || ''), category: [o.category1Name, o.category2Name, o.category3Name].filter(Boolean).join(' > '), url: String(o.crUrl || o.mallProductUrl || o.adcrUrl || o.productUrl || ''), reviews: num(o.reviewCount ?? o.reviewCountSum), purchases: num(o.purchaseCnt ?? o.purchaseCount)}); }
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  try { walk(JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || 'null'), 0); } catch {}
  const blocked = /captcha|자동입력 방지|비정상적인 접근/i.test(document.body?.innerText || '');
  return {items: out.slice(0, 20).map((x, i) => ({...x, url: /^https:\/\//.test(x.url) ? x.url : '', rank: i + 1})), blocked, url: location.href};
}
export async function shoppingPage(keyword, {settle = 3000} = {}) {
  const tab = await chrome.tabs.create({url: 'https://search.shopping.naver.com/search/all?query=' + encodeURIComponent(keyword), active: false});
  try {
    await waitLoaded(tab.id); await wait(settle);
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: readShopping});
    if (result.blocked) throw new Error('네이버 쇼핑이 자동입력 방지 화면을 보여 줬어요. 쇼핑 화면을 직접 한 번 열어 주세요.');
    if (!result.items.length) throw new Error('쇼핑 화면에서 상품 목록을 찾지 못했어요(화면 구조가 바뀌었을 수 있어요): ' + keyword);
    const prices = result.items.map(x => x.price);
    return {keyword, total: null, lowPrice: Math.min(...prices), items: result.items.map(x => ({...x, note: x.purchases ? '구매 ' + x.purchases + '건' : ''})), via: 'page'};
  } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}
