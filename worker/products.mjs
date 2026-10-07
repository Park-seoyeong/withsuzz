// 상품 찾기: 사용자가 캡처·붙여넣기로 담은 제휴·여행 상품을 키워드별로 모아 점수를 매긴다.
// 화면에 보이던 값만 저장하고, 없는 값은 null로 둔다(0으로 채우지 않음). 수수료는 플랫폼이 보여 준 값만 쓴다.
export const PRODUCT_SOURCES = {brand: '쇼핑커넥트', myrealtrip: '여행 · 마이리얼트립', naverTravel: '여행 · 네이버 여행 커넥트', naverShop: '네이버 쇼핑 (API)'};
const productError = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const pc_text = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const pc_num = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const x = Number(String(v).replace(/[,원₩%\s]/g, '')); return Number.isFinite(x) && x >= 0 ? x : null; };
const pc_compact = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function pc_safeUrl(v) { try { const u = new URL(String(v || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } }

export function normalizeProduct(raw, source, keyword, at) {
  const name = pc_text(raw?.name, 200); if (!name) return null;
  const price = pc_num(raw.price), rate = pc_num(raw.commissionRate), amountRaw = pc_num(raw.commissionAmount);
  // 1건당 수수료: 화면에 금액이 있으면 그 값, 없고 가격·수수료율이 있으면 계산값(계산 표시)으로 둔다.
  const amount = amountRaw ?? (price !== null && rate !== null ? Math.round(price * rate / 100) : null);
  const rating = pc_num(raw.rating);
  return {
    id: crypto.randomUUID(), source, keyword: pc_text(raw.item, 60) || pc_text(keyword, 60), name, brand: pc_text(raw.brand, 80), price,
    commissionRate: rate !== null && rate <= 100 ? rate : null, commissionAmount: amount, commissionEstimated: amountRaw === null && amount !== null,
    rating: rating !== null && rating <= 5 ? rating : null, reviews: pc_num(raw.reviews), salesRank: pc_num(raw.salesRank),
    url: pc_safeUrl(raw.url), note: pc_text(raw.note, 300), category: pc_text(raw.category, 30), capturedAt: at,
  };
}

// 화면 이름처럼 검색어로 쓸 수 없는 키워드(상품 찾기, 인기 상품…)는 점수·글감에 쓰지 않는다.
const pc_generic = k => /상품|추천|찾기|목록|검색|인기|전체|홍보|베스트|best|결과/i.test(String(k || '')) && String(k || '').length <= 12;
// 품목 키워드 다시 매기기: Claude가 상품명만 보고 정한 품목을 keyword로 바꾼다(기존 키워드는 keywords에 남김).
export function rekeyProducts(state, map) {
  let changed = 0;
  for (const [id, item] of Object.entries(map || {})) {
    const p = (state.products || []).find(x => x.id === id), kw = pc_text(item, 60).trim(); if (!p || !kw || pc_generic(kw)) continue;
    if (pc_compact(p.keyword) === pc_compact(kw)) continue;
    p.keywords = [...new Set([kw, ...(p.keywords || [p.keyword]).filter(k => !pc_generic(k))])]; p.keyword = kw; changed++;
  }
  return changed;
}
// 다시 매길 상품: 키워드가 화면 이름이거나, 키워드가 상품명에 들어 있지 않은 것(예: 검색어 '보조배터리'로 담긴 음식물처리기).
export function genericProducts(state) { return (state.products || []).filter(p => pc_generic(p.keyword) || !p.keyword || !pc_compact(p.name).includes(pc_compact(p.keyword))); }
export function saveProducts(state, input, at = new Date().toISOString()) {
  const source = PRODUCT_SOURCES[input?.source] ? input.source : null; if (!source) productError('상품 출처를 골라 주세요.');
  const keyword = pc_text(input.keyword, 60); if (!keyword) productError('어떤 키워드로 찾은 상품인지 적어 주세요.');
  const rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, 200).map(r => normalizeProduct(r, source, keyword, at)).filter(Boolean);
  if (!rows.length) productError('담을 상품이 없어요.');
  if (!Array.isArray(state.products)) state.products = [];
  let added = 0, updated = 0;
  for (const p of rows) {
    // 같은 출처·같은 링크(링크가 없으면 같은 이름)는 새 값으로 갱신한다.
    const old = state.products.find(x => x.source === p.source && (p.url ? x.url === p.url : !x.url && pc_compact(x.name) === pc_compact(p.name)));
    const kws = [...new Set([p.keyword, keyword].filter(k => k && !pc_generic(k)))];
    if (old) { Object.assign(old, {...p, id: old.id, keywords: [...new Set([...(old.keywords || [old.keyword]), ...kws])]}); updated++; }
    else { state.products.push({...p, keywords: kws.length ? kws : [keyword]}); added++; }
  }
  if (state.products.length > 2000) state.products.splice(0, state.products.length - 2000);
  return {added, updated, total: rows.length};
}

export function deleteProduct(state, id) { const i = (state.products || []).findIndex(p => p.id === id); if (i < 0) productError('상품을 찾지 못했어요.', 404); return state.products.splice(i, 1)[0]; }

// 점수(0~100): 판매 35 · 신뢰 25 · 수익 25 · 키워드 15. 값이 없는 항목은 그 비중을 빼고 나머지로 다시 맞춘다.
export function scoreProducts(list, keyword = '') {
  const k = pc_compact(keyword), amounts = list.map(p => p.commissionAmount).filter(v => v !== null), maxAmount = Math.max(1, ...amounts);
  const scored = list.map(p => {
    const parts = {};
    if (p.salesRank !== null) parts.sales = Math.max(0, 100 - (p.salesRank - 1) * 5);
    if (p.rating !== null || p.reviews !== null) parts.trust = Math.round((p.rating !== null ? p.rating / 5 * 60 : 30) + (p.reviews !== null ? Math.min(40, Math.log10(p.reviews + 1) * 13) : 0));
    if (p.commissionAmount !== null) parts.revenue = Math.round(Math.sqrt(p.commissionAmount / maxAmount) * 100);
    parts.keyword = !k ? 50 : pc_compact(p.name).includes(k) ? 100 : (p.keywords || []).some(x => pc_compact(x) === k) ? 70 : 30;
    const w = {sales: 35, trust: 25, revenue: 25, keyword: 15}, used = Object.keys(parts), total = used.reduce((a, x) => a + w[x], 0);
    const score = Math.round(used.reduce((a, x) => a + parts[x] * w[x], 0) / total);
    const pass = (p.rating === null || p.rating >= 4) && (p.reviews === null || p.reviews >= 10) && p.commissionAmount !== 0;
    return {...p, parts, score, pass};
  });
  const prices = scored.map(p => p.price).filter(v => v !== null).sort((a, b) => a - b), q = f => prices[Math.floor((prices.length - 1) * f)];
  for (const p of scored) p.tier = p.price === null || prices.length < 3 ? '' : p.price <= q(1 / 3) ? '가성비' : p.price >= q(2 / 3) ? '프리미엄' : '대표';
  [...scored].sort((a, b) => b.score - a.score).forEach((p, i) => { p.recommendRank = i + 1; });
  return scored;
}

export function productDraftItem(p) {
  const facts = [
    '상품: ' + p.name + (p.brand ? ' (' + p.brand + ')' : ''),
    p.price !== null ? '화면에서 본 가격: ' + p.price.toLocaleString('ko-KR') + '원 (' + p.capturedAt.slice(0, 10) + ' 기준, 발행 전 다시 확인)' : '',
    p.rating !== null ? '평점 ' + p.rating + (p.reviews !== null ? ' · 리뷰 ' + p.reviews.toLocaleString('ko-KR') + '개' : '') : '',
    p.note ? '메모: ' + p.note : '',
    '써 보지 않은 상품이면 사용 후기처럼 쓰지 않는다. 확인된 정보·선택 기준·추천 대상 중심으로 쓴다.',
  ].filter(Boolean).join('\n');
  const travel = p.source !== 'brand';
  return {title: p.keyword + ' 추천 · ' + p.name.slice(0, 60), type: travel ? 'affiliate' : 'affiliate', channel: 'blog', keyword: p.keyword, links: p.url, notes: facts, provided: '제휴 링크(구매 시 수수료를 받을 수 있음)', status: '아이디어'};
}

// 시즌 캘린더: 해마다 돌아오는 주제(월-일 기준). 시작~끝이 진행 기간, 시작 30일 전부터 '지금 쓸 때'.
export const SEASONS = [
  {id: 'newyear', cat: '여행', title: '해돋이·새해 여행', start: '12-20', end: '01-03', keywords: ['해돋이 명소', '정동진', '새해 여행지', '일출 시간']},
  {id: 'winter-trip', cat: '여행', title: '겨울 해외여행', start: '12-10', end: '02-15', keywords: ['삿포로 눈축제', '온천 료칸', '겨울 옷차림', 'eSIM']},
  {id: 'lunar', cat: '생활', title: '설 연휴', start: '01-20', end: '02-20', keywords: ['설 선물세트', '연휴 여행', '귀성길', '세배 용돈']},
  {id: 'spring-bloom', cat: '여행', title: '봄꽃 여행', start: '03-15', end: '04-20', keywords: ['벚꽃 명소', '진해군항제', '벚꽃 개화시기', '유채꽃']},
  {id: 'spring-move', cat: '생활', title: '봄 이사·새학기', start: '02-20', end: '03-31', keywords: ['신학기 준비물', '이사 체크리스트', '미세먼지 마스크', '공기청정기']},
  {id: 'family-month', cat: '선물', title: '가정의 달', start: '04-25', end: '05-20', keywords: ['어버이날 선물', '어린이날 여행', '스승의날', '가족 여행']},
  {id: 'early-summer', cat: '여행', title: '초여름 국내 여행', start: '05-25', end: '06-30', keywords: ['수국 명소', '계곡 캠핑', '반딧불이 축제', '제주 수국']},
  {id: 'rainy', cat: '생활', title: '장마 대비', start: '06-15', end: '07-25', keywords: ['제습기', '장마 여행지', '우산 추천', '실내 데이트']},
  {id: 'summer-vacation', cat: '여행', title: '여름 휴가', start: '07-10', end: '08-20', keywords: ['해수욕장 개장', '워터파크', '휴가 해외여행', '휴대용 선풍기']},
  {id: 'chuseok', cat: '생활', title: '추석 연휴', start: '09-01', end: '10-10', keywords: ['추석 선물세트', '송편', '연휴 해외여행', '차례상']},
  {id: 'autumn-food', cat: '식품', title: '가을 제철 먹거리', start: '09-15', end: '11-15', keywords: ['햅쌀', '대하', '전어', '홍시']},
  {id: 'change-season', cat: '건강', title: '환절기', start: '10-01', end: '11-10', keywords: ['가습기', '습도계', '극세사 이불', '기모 잠옷']},
  {id: 'autumn-hike', cat: '운동·레저', title: '가을 러닝·등산', start: '10-10', end: '11-20', keywords: ['러닝화', '등산화', '등산 스틱', '러닝 벨트']},
  {id: 'autumn-trip', cat: '여행', title: '가을 국내 여행·단풍', start: '10-20', end: '11-25', keywords: ['단풍 절정', '경주 투어', '강릉 투어', '속초 요트']},
  {id: 'kimjang', cat: '식품', title: '김장철', start: '11-10', end: '12-10', keywords: ['절임배추', '김장 재료', '김치냉장고', '수육']},
  {id: 'black-friday', cat: '쇼핑', title: '블랙프라이데이·연말 세일', start: '11-15', end: '12-05', keywords: ['블랙프라이데이', '직구', '연말 세일', '캐리어 할인']},
  {id: 'xmas', cat: '선물', title: '크리스마스·연말', start: '12-01', end: '12-26', keywords: ['크리스마스 선물', '연말 호텔', '크리스마스 마켓', '파티 용품']},
];
function pc_seasonDate(year, md) { return new Date(year + '-' + md + 'T00:00:00+09:00'); }
export function seasonCalendar(day, limit = 4) {
  const now = new Date(day + 'T12:00:00+09:00'), year = now.getUTCFullYear(), dayMs = 86400000;
  const rows = SEASONS.map(s => {
    // 올해·작년·내년 중 아직 끝나지 않은 가장 가까운 회차를 고른다(연말에 걸치는 시즌 포함).
    let best = null;
    for (const y of [year - 1, year, year + 1]) {
      const start = pc_seasonDate(y, s.start); let end = pc_seasonDate(y, s.end); if (end < start) end = pc_seasonDate(y + 1, s.end);
      end = new Date(end.getTime() + dayMs - 1);
      if (end >= now && (!best || start < best.start)) best = {start, end};
    }
    const startsIn = Math.ceil((best.start - now) / dayMs);
    const status = startsIn <= 0 ? '한창' : startsIn <= 30 ? '지금 쓸 때' : '준비';
    return {...s, startDate: new Date(best.start.getTime() + 9 * 3600000).toISOString().slice(0, 10), endDate: new Date(best.end.getTime() + 9 * 3600000).toISOString().slice(0, 10), startsIn, status};
  }).filter(s => s.startsIn <= 45).sort((a, b) => a.startsIn - b.startsIn);
  const picked = [], cats = new Set();
  for (const s of rows) if (!cats.has(s.cat) && picked.length < limit) { picked.push(s); cats.add(s.cat); }
  for (const s of rows) if (picked.length < limit && !picked.includes(s)) picked.push(s);
  return picked.sort((a, b) => a.startsIn - b.startsIn);
}

// 글별 조회와 판매: 같은 글(글감 또는 제목) 기준으로 측정된 값만 합친다. 판매·수수료가 없는 글은 null로 남긴다.
export function postPerformance(state) {
  const by = new Map();
  for (const m of state.metrics || []) {
    if (m.keyword?.trim() && !m.itemId && !m.title) continue;
    const key = m.itemId || 'title:' + m.title, item = state.items.find(i => i.id === m.itemId);
    if (!by.has(key)) by.set(key, {key, itemId: m.itemId || '', title: item?.title || m.title, keyword: item?.keyword || '', publishedAt: (item?.publishedAt || '').slice(0, 10), views: null, likes: null, comments: null, searchClicks: null, conversions: null, revenue: null, sources: new Set()});
    const r = by.get(key); r.sources.add(m.source || '직접 입력');
    const has = f => Array.isArray(m.measuredFields) ? m.measuredFields.includes(f) : Number(m[f]) > 0;
    for (const f of ['views', 'likes', 'comments', 'searchClicks', 'conversions', 'revenue']) if (has(f) && Number.isFinite(m[f])) r[f] = (r[f] ?? 0) + m[f];
  }
  const rows = [...by.values()].map(r => ({...r, sources: [...r.sources], rpm: r.views && r.revenue !== null ? Math.round(r.revenue / r.views * 1000) : null})).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  const sum = f => rows.reduce((a, r) => a + (r[f] ?? 0), 0), withViews = rows.filter(r => r.views !== null);
  const views = sum('views'), revenue = sum('revenue'), sales = sum('conversions'), search = sum('searchClicks');
  return {rows, summary: {posts: withViews.length, views, sales, revenue, conversion: views && rows.some(r => r.conversions !== null) ? sales / views : null, rpm: views && rows.some(r => r.revenue !== null) ? Math.round(revenue / views * 1000) : null, searchShare: views && rows.some(r => r.searchClicks !== null) ? search / views : null}};
}

// ───────── 수익 장부: 플랫폼이 보여 준 날짜별 매출·수수료·건수·클릭만 저장한다 ─────────
export const PLATFORMS = {brand: '쇼핑커넥트', naverTravel: '여행 커넥트', myrealtrip: '마이리얼트립', threehours: '세시간전', adpost: '애드포스트', other: '기타'};
const pc_isDate = d => { if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false; const t = new Date(d + 'T12:00:00Z'); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
export function saveEarnings(state, input, at = new Date().toISOString()) {
  if (!Array.isArray(state.earnings)) state.earnings = [];
  let added = 0, updated = 0, skipped = 0;
  for (const raw of (Array.isArray(input?.rows) ? input.rows : []).slice(0, 3000)) {
    const platform = PLATFORMS[raw?.platform] ? raw.platform : null, date = raw?.date;
    const row = {date, platform, sales: pc_num(raw?.sales), revenue: pc_num(raw?.revenue), orders: pc_num(raw?.orders), clicks: pc_num(raw?.clicks), source: pc_text(raw?.source || input.source || '직접 입력', 60), importedAt: at};
    if (!platform || !pc_isDate(date) || ['sales', 'revenue', 'orders', 'clicks'].every(f => row[f] === null)) { skipped++; continue; }
    const old = state.earnings.find(e => e.date === date && e.platform === platform);
    if (old) { for (const f of ['sales', 'revenue', 'orders', 'clicks']) if (row[f] !== null) old[f] = row[f]; old.source = row.source; old.importedAt = at; updated++; }
    else { state.earnings.push(row); added++; }
  }
  if (!added && !updated) productError('저장할 날짜·플랫폼·숫자가 있는 줄이 없어요.');
  state.earnings.sort((a, b) => a.date.localeCompare(b.date));
  return {added, updated, skipped};
}
export function deleteEarnings(state, {date, platform}) { const i = (state.earnings || []).findIndex(e => e.date === date && e.platform === platform); if (i < 0) productError('기록을 찾지 못했어요.', 404); return state.earnings.splice(i, 1)[0]; }

const pc_add = (a, b) => (b === null || b === undefined ? a : (a ?? 0) + b);
function pc_bucketOf(date, grain) { return grain === 'year' ? date.slice(0, 4) : grain === 'month' ? date.slice(0, 7) : date; }
function pc_daysIn(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function earningsReport(state, {grain = 'month', year = 'all', platform = 'all', today: day} = {}) {
  let rows = (state.earnings || []).filter(e => (platform === 'all' || e.platform === platform) && (year === 'all' || e.date.startsWith(year)));
  if (grain === 'day') { const from = new Date(new Date(day + 'T12:00:00Z').getTime() - 89 * 86400000).toISOString().slice(0, 10); rows = rows.filter(e => e.date >= from && e.date <= day); }
  const buckets = new Map();
  for (const e of rows) {
    const k = pc_bucketOf(e.date, grain === 'day' ? 'day' : grain);
    if (!buckets.has(k)) buckets.set(k, {key: k, sales: null, revenue: null, orders: null, clicks: null, byPlatform: {}});
    const b = buckets.get(k); for (const f of ['sales', 'revenue', 'orders', 'clicks']) b[f] = pc_add(b[f], e[f]);
    const p = b.byPlatform[e.platform] ||= {sales: null, revenue: null, orders: null, clicks: null}; for (const f of ['sales', 'revenue', 'orders', 'clicks']) p[f] = pc_add(p[f], e[f]);
  }
  const list = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  list.forEach((b, i) => { const prev = list[i - 1]; b.rate = b.sales ? b.revenue / b.sales : null; b.conversion = b.clicks ? (b.orders ?? 0) / b.clicks : null; b.perClick = b.clicks && b.revenue !== null ? b.revenue / b.clicks : null; b.change = prev && prev.revenue ? (b.revenue ?? 0) / prev.revenue - 1 : null; });
  // 진행 중인 달은 지금까지 속도로 월말 예상(예상임을 표시).
  const curMonth = day.slice(0, 7), cur = grain === 'month' ? list.find(b => b.key === curMonth) : null;
  if (cur && cur.revenue !== null) { const elapsed = Number(day.slice(8, 10)); cur.projectedRevenue = Math.round(cur.revenue / elapsed * pc_daysIn(curMonth)); }
  const sum = f => list.reduce((a, b) => pc_add(a, b[f]), null);
  const months = new Map(); for (const e of rows) { const k = e.date.slice(0, 7); months.set(k, pc_add(months.get(k) ?? null, e.revenue)); }
  const best = [...months.entries()].filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1])[0] || null;
  const sales = sum('sales'), revenue = sum('revenue'), orders = sum('orders'), clicks = sum('clicks'), monthCount = months.size || 1;
  const byPlatform = {}; for (const e of rows) { const p = byPlatform[e.platform] ||= {sales: null, revenue: null}; p.sales = pc_add(p.sales, e.sales); p.revenue = pc_add(p.revenue, e.revenue); }
  return {grain, year, platform, buckets: list, years: [...new Set((state.earnings || []).map(e => e.date.slice(0, 4)))].sort(), first: rows[0]?.date || null, last: rows.at(-1)?.date || null,
    summary: {sales, revenue, rate: sales ? revenue / sales : null, orders, clicks, conversion: clicks ? (orders ?? 0) / clicks : null, perClick: clicks && revenue !== null ? revenue / clicks : null, avgSales: sales !== null ? sales / monthCount : null, avgRevenue: revenue !== null ? revenue / monthCount : null, bestMonth: best ? {month: best[0], revenue: best[1]} : null},
    byPlatform};
}
export function platformCards(state, day) {
  const curMonth = day.slice(0, 7), out = [];
  for (const [id, name] of Object.entries(PLATFORMS)) {
    const rows = (state.earnings || []).filter(e => e.platform === id); if (!rows.length) continue;
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7); months.push(rows.filter(e => e.date.startsWith(d)).reduce((a, e) => pc_add(a, e.revenue), null)); }
    const sales = rows.reduce((a, e) => pc_add(a, e.sales), null), revenue = rows.reduce((a, e) => pc_add(a, e.revenue), null), thisMonth = rows.filter(e => e.date.startsWith(curMonth));
    out.push({id, name, since: rows[0].date.slice(0, 7), sales, revenue, rate: sales ? revenue / sales : null, monthRevenue: thisMonth.reduce((a, e) => pc_add(a, e.revenue), null), monthOrders: thisMonth.reduce((a, e) => pc_add(a, e.orders), null), spark: months, updatedAt: rows.map(e => e.importedAt).sort().at(-1), source: rows.at(-1).source});
  }
  return out;
}

// ───────── 네이버 API 결과(확장이 써즈님 키로 불러온 숫자) 저장 ─────────
// 받은 값만 덮어쓰고, 오지 않은 값은 예전 값을 그대로 둔다. 실패한 API는 apiSync.errors로 남겨 화면에 그대로 보여 준다.
const pc_count = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
export function saveApiData(state, item, at = new Date().toISOString()) {
  const d = item?.data; if (!d || typeof d !== 'object') productError('API 결과가 비어 있어요.');
  const capturedAt = pc_text(item.capturedAt, 40) || at;
  // 바로 조회(lookup)는 정기 불러오기 순서와 상관없이 저장하고, 정기 결과의 기준 시각(apiSync)은 건드리지 않는다.
  const lookup = item.lookup === true;
  if (!lookup && state.apiSync?.capturedAt && capturedAt <= state.apiSync.capturedAt) return {skipped: true, metrics: 0, products: 0};
  if (!Array.isArray(state.keywordMetrics)) state.keywordMetrics = [];
  const metric = kw => { const key = pc_compact(kw); if (key.length < 2) return null; let m = state.keywordMetrics.find(x => x.key === key); if (!m) { m = {key, keyword: pc_text(kw, 40)}; state.keywordMetrics.push(m); } m.updatedAt = capturedAt; return m; };
  const touched = new Set();
  for (const v of (Array.isArray(d.volumes) ? d.volumes : []).slice(0, 60)) { const m = metric(v.keyword); if (!m) continue; touched.add(m.key); Object.assign(m, {volume: pc_count(v.volume), monthlyPc: pc_count(v.monthlyPc), monthlyMobile: pc_count(v.monthlyMobile), clicks: pc_count(v.clicks), compIdx: ['낮음', '중간', '높음'].includes(v.compIdx) ? v.compIdx : null});
    // 데이터랩 대신: 하루 한 번 월간 검색량을 남겨 두고, 2주 이상 쌓이면 그 변화로 급등을 본다.
    if (m.volume !== null) { const day = new Date((Date.parse(capturedAt) || Date.now()) + 9 * 3600000).toISOString().slice(0, 10), h = (m.history ||= []).filter(x => x.date !== day); h.push({date: day, volume: m.volume}); m.history = h.sort((a, b) => a.date.localeCompare(b.date)).slice(-90); }
  }
  for (const t of (Array.isArray(d.trends) ? d.trends : []).slice(0, 60)) {
    const m = metric(t.keyword); if (!m) continue; touched.add(m.key);
    const points = (Array.isArray(t.points) ? t.points : []).slice(-12).map(x => ({period: pc_text(x.period, 10), ratio: Number(x.ratio) || 0}));
    m.trend = {recent: pc_count(t.recent), prior: pc_count(t.prior), change: typeof t.change === 'number' && Number.isFinite(t.change) ? t.change : null, points};
  }
  let products = 0;
  if (!Array.isArray(state.products)) state.products = [];
  for (const sh of (Array.isArray(d.shopping) ? d.shopping : []).slice(0, 60)) {
    const m = metric(sh.keyword); if (!m) continue; touched.add(m.key);
    m.shopping = {total: pc_count(sh.total), lowPrice: pc_count(sh.lowPrice)};
    // 같은 키워드로 예전에 불러온 API 상품은 새 결과로 바꾼다(쇼핑 검색 순위는 매번 달라짐).
    state.products = state.products.filter(p => !(p.source === 'naverShop' && pc_compact(p.keyword) === m.key));
    for (const x of (Array.isArray(sh.items) ? sh.items : []).slice(0, 20)) {
      const p = normalizeProduct({name: x.name, price: x.price, brand: x.brand, url: x.url, reviews: x.reviews, category: String(x.category || '').split(' > ')[0], note: (sh.via === 'page' ? '네이버 쇼핑 화면 ' : '네이버 쇼핑 검색 ') + (Number(x.rank) || '') + '위(정확도순)' + (x.note ? ' · ' + pc_text(x.note, 40) : '') + (x.mall ? ' · ' + pc_text(x.mall, 40) : '') + (x.category ? ' · ' + pc_text(x.category, 80) : '')}, 'naverShop', m.keyword, capturedAt);
      if (p) { state.products.push({...p, keywords: [m.keyword]}); products++; }
    }
  }
  if (state.products.length > 2000) state.products.splice(0, state.products.length - 2000);
  if (state.keywordMetrics.length > 500) state.keywordMetrics.splice(0, state.keywordMetrics.length - 500);
  const related = (Array.isArray(d.related) ? d.related : []).slice(0, 20).map(r => ({keyword: pc_text(r.keyword, 40), volume: pc_count(r.volume), compIdx: ['낮음', '중간', '높음'].includes(r.compIdx) ? r.compIdx : null})).filter(r => r.keyword);
  const errors = (Array.isArray(item.errors) ? item.errors : []).slice(0, 10).map(e => pc_text(e, 300));
  if (lookup) return {skipped: false, lookup: true, metrics: touched.size, products, errors, related, keywords: [...touched].map(k => { const m = pc_metric(state, k); return {keyword: m.keyword, volume: m.volume ?? null, monthlyPc: m.monthlyPc ?? null, monthlyMobile: m.monthlyMobile ?? null, compIdx: m.compIdx ?? null, change: m.trend?.change ?? null, lowPrice: m.shopping?.lowPrice ?? null}; })};
  state.relatedKeywords = related;
  state.apiSync = {capturedAt, savedAt: at, parts: {search: !!item.parts?.search, ad: !!item.parts?.ad}, metrics: touched.size, products, errors};
  return {skipped: false, metrics: touched.size, products, errors};
}
// 키워드 분석 화면(블랙키위·네이버 키워드 도구 등)에서 읽은 숫자 저장: 검색량·증감률·경쟁도. 화면 값은 그 화면 기준일로 기록한다.
export function saveKeywordRows(state, {rows, source, date}, at = new Date().toISOString()) {
  if (!Array.isArray(state.keywordMetrics)) state.keywordMetrics = [];
  const src = pc_text(source, 40) || '분석 화면', day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : /^\d{4}-\d{2}$/.test(date || '') ? date + '-01' : new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);
  let saved = 0;
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 300)) {
    const kw = pc_text(r?.keyword, 60).trim(), key = pc_compact(kw); if (key.length < 2) continue;
    const pc = pc_num(r.pc), mobile = pc_num(r.mobile), volume = pc_num(r.volume) ?? (pc === null && mobile === null ? null : (pc || 0) + (mobile || 0));
    const chg = Number(String(r.change ?? '').replace(/[%,\s]/g, '')), change = String(r.change ?? '').trim() && Number.isFinite(chg) ? chg / 100 : null;
    let m = state.keywordMetrics.find(x => x.key === key); if (!m) { m = {key, keyword: kw}; state.keywordMetrics.push(m); }
    Object.assign(m, {source: src, updatedAt: at});
    if (volume !== null) { m.volume = volume; if (pc !== null) m.monthlyPc = pc; if (mobile !== null) m.monthlyMobile = mobile; const h = (m.history ||= []).filter(x => x.date !== day); h.push({date: day, volume}); m.history = h.sort((a, b) => a.date.localeCompare(b.date)).slice(-90); }
    if (['낮음', '중간', '높음'].includes(r.compIdx)) m.compIdx = r.compIdx;
    if (change !== null) m.trend = {recent: null, prior: null, change, points: [], source: src};
    if (r.note) m.note = pc_text(r.note, 80);
    saved++;
  }
  if (state.keywordMetrics.length > 500) state.keywordMetrics.splice(0, state.keywordMetrics.length - 500);
  return {saved, source: src, date: day};
}
const pc_metric = (state, key) => (state.keywordMetrics || []).find(m => m.key === key) || null;
const pc_dayGap = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
// 검색량 기록 변화: 가장 최근 값과, 그보다 14일 이상 앞선 값 중 가장 가까운 값을 비교한다(월간 검색량은 30일 합계라 하루 차이는 의미가 작음).
export function volumeChange(history = []) {
  const last = history.at(-1); if (!last) return null;
  const base = [...history].reverse().find(x => pc_dayGap(x.date, last.date) >= 14);
  return base && base.volume > 0 ? {change: (last.volume - base.volume) / base.volume, days: pc_dayGap(base.date, last.date)} : null;
}

// ───────── 지금 팔기 좋은 키워드: 확인된 신호만으로 점수를 낸다(검색량·경쟁은 미연결이면 빼고 계산) ─────────
export function keywordOpportunities(state, day, limit = 12) {
  const cands = new Map(), put = (kw, from) => { const k = pc_compact(kw); if (!k || k.length < 2) return; if (!cands.has(k)) cands.set(k, {keyword: String(kw).trim(), from: new Set()}); cands.get(k).from.add(from); };
  const affiliate = (state.products || []).filter(p => p.source !== 'naverShop');
  for (const p of affiliate) for (const kw of p.keywords || [p.keyword]) put(kw, '담은 상품');
  for (const m of state.keywordMetrics || []) put(m.keyword, m.source ? m.source : '네이버 API');
  for (const r of state.relatedKeywords || []) put(r.keyword, '연관 검색어');
  for (const kw of state.naverStats?.keywords || []) put(kw.keyword, '내 블로그 유입');
  const seasons = seasonCalendar(day, 8); for (const s of seasons) for (const kw of s.keywords) put(kw, '시즌');
  const news = (state.trendSnapshot?.sources || []).flatMap(s => s.rows || []).map(r => pc_compact(r.title));
  const rows = [...cands.entries()].map(([k, c]) => {
    const products = affiliate.filter(p => (p.keywords || [p.keyword]).some(x => pc_compact(x) === k) || pc_compact(p.name).includes(k));
    const ranks = products.map(p => p.salesRank).filter(v => v !== null), amounts = products.map(p => p.commissionAmount).filter(v => v !== null);
    const parts = {};
    if (ranks.length) parts.sold = Math.max(0, 100 - (Math.min(...ranks) - 1) * 5);
    const m = pc_metric(state, k) || (() => { const r = (state.relatedKeywords || []).find(x => pc_compact(x.keyword) === k); return r ? {volume: r.volume, compIdx: r.compIdx} : null; })();
    const mentions = news.filter(t => t.includes(k)).length;
    // 급등: 데이터랩 최근 4주 ÷ 그 전 8주 → 없으면 검색광고 검색량 기록 변화(14일 이상) → 없으면 Claude 뉴스 언급 수.
    const vc = volumeChange(m?.history);
    if (m?.trend?.change !== null && m?.trend?.change !== undefined) parts.rising = Math.max(0, Math.min(100, Math.round(50 + m.trend.change * 100)));
    else if (vc) parts.rising = Math.max(0, Math.min(100, Math.round(50 + vc.change * 100)));
    else if (news.length) parts.rising = Math.min(100, mentions * 34);
    if (m?.volume !== null && m?.volume !== undefined) parts.volume = Math.min(100, Math.round(Math.log10(m.volume + 1) * 20));
    if (m?.compIdx) parts.competition = {낮음: 100, 중간: 60, 높음: 25}[m.compIdx];
    const season = seasons.find(s => s.keywords.some(x => pc_compact(x) === k)); if (season) parts.season = season.status === '한창' ? 90 : season.status === '지금 쓸 때' ? 100 : 40;
    const own = state.items.filter(i => pc_compact(i.keyword) === k || pc_compact(i.title).includes(k)); parts.gap = own.length === 0 ? 100 : own.length === 1 ? 60 : 25;
    if (amounts.length) parts.revenue = Math.min(100, Math.round(Math.sqrt(Math.max(...amounts) / 5000) * 100));
    const inflow = (state.naverStats?.keywords || []).find(x => pc_compact(x.keyword) === k); if (inflow) parts.inflow = Math.min(100, Math.round(inflow.percentage * 8));
    // 확인되지 않은 신호는 중립값 30으로 둔다(근거가 적은 키워드가 만점이 되지 않게).
    const w = {sold: 25, rising: 15, season: 15, gap: 15, revenue: 20, inflow: 10, volume: 15, competition: 10}, sum = Object.values(w).reduce((a, x) => a + x, 0), score = Math.round(Object.keys(w).reduce((a, x) => a + (parts[x] ?? 30) * w[x], 0) / sum);
    const best = [...products].sort((a, b) => (a.salesRank ?? 999) - (b.salesRank ?? 999))[0] || null;
    return {keyword: c.keyword, from: [...c.from], score, parts, mentions, season: season ? {title: season.title, status: season.status} : null, metric: m ? {volume: m.volume ?? null, compIdx: m.compIdx ?? null, change: m.trend?.change ?? null, volumeChange: vc, lowPrice: m.shopping?.lowPrice ?? null, shopTotal: m.shopping?.total ?? null, updatedAt: m.updatedAt || null} : null, ownPosts: own.length, writtenToday: own.some(i => (i.createdAt || '').slice(0, 10) === day), product: best ? {id: best.id, name: best.name, source: best.source, commissionAmount: best.commissionAmount, salesRank: best.salesRank, url: best.url} : null, golden: products.length > 0 && score >= 60};
  }).filter(r => r.from.includes('담은 상품') || r.season || r.metric || r.score >= 50);
  // 골든 → 담은 상품이 있는 키워드 → 점수 순. 상품이 있는 키워드는 자리가 없어도 시즌 키워드보다 먼저 보인다.
  return rows.sort((a, b) => Number(b.golden) - Number(a.golden) || Number(!!b.product) - Number(!!a.product) || b.score - a.score).slice(0, limit);
}

// ───────── AI 사용 기록·비용 ─────────
export const AI_PRICES = {opus: {in: 4, out: 20}, sonnet: {in: 2, out: 10}, haiku: {in: 1, out: 5}, 'gpt-5-mini': {in: 0.25, out: 2}};
// 손익: 달마다 (애드포스트·쇼핑커넥트·세시간전·… 수익) − (구독 등 고정 비용 + AI API 사용액). 수익은 기록된 달만, 비용은 고정비가 있는 달마다 뺀다.
export function profitReport(state, day, rate = 1400, months = 6) {
  const costs = (state.settings?.costs || []).map(c => ({name: pc_text(c.name, 40), monthly: pc_num(c.monthly) ?? 0})).filter(c => c.name);
  const fixed = costs.reduce((a, c) => a + c.monthly, 0);
  const keys = []; for (let i = months - 1; i >= 0; i--) { const d = new Date(day.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); keys.push(d.toISOString().slice(0, 7)); }
  const rows = keys.map(month => {
    const earn = (state.earnings || []).filter(e => e.date.startsWith(month)), byPlatform = {};
    for (const e of earn) if (e.revenue !== null) byPlatform[e.platform] = (byPlatform[e.platform] ?? 0) + e.revenue;
    const revenue = Object.values(byPlatform).reduce((a, v) => a + v, 0), hasRevenue = earn.some(e => e.revenue !== null);
    const aiUsd = (state.aiLog || []).filter(e => e.at.startsWith(month)).reduce((a, e) => { const p = AI_PRICES[pc_family(e.model)]; return p && e.inputTokens !== null ? a + (e.inputTokens * p.in + e.outputTokens * p.out) / 1e6 : a; }, 0);
    const ai = Math.round(aiUsd * rate), cost = fixed + ai;
    return {month, revenue: hasRevenue ? revenue : null, byPlatform, fixed, ai, cost, profit: hasRevenue ? revenue - cost : null};
  });
  const cur = rows.at(-1), elapsed = Number(day.slice(8, 10)), dim = pc_daysIn(day.slice(0, 7));
  const projected = cur.revenue === null ? null : Math.round(cur.revenue / Math.max(1, elapsed) * dim) - cur.fixed - Math.round(cur.ai / Math.max(1, elapsed) * dim);
  const breakEven = fixed > 0 && cur.revenue !== null ? Math.round(fixed / Math.max(1, Math.max(cur.revenue / Math.max(1, elapsed) * dim, 1)) * 100) : null;
  return {rows, costs, fixed, current: cur, projected, breakEvenShare: breakEven, rate};
}
export function recordAIUse(state, e, at = new Date().toISOString()) {
  if (!Array.isArray(state.aiLog)) state.aiLog = [];
  state.aiLog.push({at, feature: pc_text(e.feature, 30), provider: pc_text(e.provider, 20), model: pc_text(e.model, 60), ok: e.ok !== false, inputTokens: Number.isFinite(e.inputTokens) ? e.inputTokens : null, outputTokens: Number.isFinite(e.outputTokens) ? e.outputTokens : null});
  if (state.aiLog.length > 3000) state.aiLog.splice(0, state.aiLog.length - 3000);
}
function pc_family(model) { const m = String(model || '').toLowerCase(); return m.includes('opus') ? 'opus' : m.includes('sonnet') ? 'sonnet' : m.includes('haiku') ? 'haiku' : m.includes('gpt-5-mini') ? 'gpt-5-mini' : null; }
export function aiSpend(state, day, rate = 1400) {
  const from = new Date(new Date(day + 'T12:00:00Z').getTime() - 29 * 86400000).toISOString().slice(0, 10), log = (state.aiLog || []).filter(e => e.at.slice(0, 10) >= from);
  const days = []; for (let i = 29; i >= 0; i--) days.push({date: new Date(new Date(day + 'T12:00:00Z').getTime() - i * 86400000).toISOString().slice(0, 10), usd: null, calls: 0, byFamily: {}});
  let tokens = 0, unpriced = 0;
  for (const e of log) {
    const d = days.find(x => x.date === e.at.slice(0, 10)); if (!d) continue; d.calls++;
    const f = pc_family(e.model), p = AI_PRICES[f];
    if (p && e.inputTokens !== null && e.outputTokens !== null) { const usd = (e.inputTokens * p.in + e.outputTokens * p.out) / 1e6; d.usd = (d.usd ?? 0) + usd; d.byFamily[f] = (d.byFamily[f] ?? 0) + usd; tokens += e.inputTokens + e.outputTokens; } else unpriced++;
  }
  const month = day.slice(0, 7), monthUsd = log.filter(e => e.at.startsWith(month)).reduce((a, e) => { const p = AI_PRICES[pc_family(e.model)]; return p && e.inputTokens !== null ? a + (e.inputTokens * p.in + e.outputTokens * p.out) / 1e6 : a; }, 0);
  const last7 = days.slice(-7).reduce((a, d) => a + (d.usd ?? 0), 0), elapsed = Number(day.slice(8, 10)), dim = pc_daysIn(month);
  const features = {}; for (const e of log) features[e.feature] = (features[e.feature] || 0) + 1;
  return {days, rate, calls: log.length, failed: log.filter(e => !e.ok).length, tokens, unpriced, monthUsd, monthKrw: Math.round(monthUsd * rate), projectedKrw: Math.round((monthUsd + last7 / 7 * (dim - elapsed)) * rate), features};
}
