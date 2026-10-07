// 네이버 공식 API 세 가지(쇼핑 검색 · 데이터랩 검색어 트렌드 · 검색광고 키워드 도구)를 써즈님 키로 불러온다.
// 키는 이 확장의 chrome.storage.local에만 있고, 사이트로는 결과 숫자만 보낸다. fetch·시계를 바꿔 끼울 수 있어 테스트에서 가짜 응답을 쓴다.
export const LIMIT = 30;
const SEARCH = 'https://openapi.naver.com/v1/search/shop.json', DATALAB = 'https://openapi.naver.com/v1/datalab/search';
const SEARCHAD = 'https://api.searchad.naver.com', TOOL = '/keywordstool';
const compact = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const plain = t => String(t || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const count = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const s = String(v ?? '').trim(); if (/^<\s*10$/.test(s)) return 5; const x = Number(s.replace(/,/g, '')); return s && Number.isFinite(x) ? x : null; };
const chunk = (list, n) => list.reduce((a, x, i) => (i % n ? a[a.length - 1].push(x) : a.push([x]), a), []);
const ymd = d => d.toISOString().slice(0, 10);

export function cleanKeywords(list) {
  const seen = new Set(), out = [];
  for (const raw of list || []) { const k = String(raw || '').trim().slice(0, 40), c = compact(k); if (c.length < 2 || seen.has(c)) continue; seen.add(c); out.push(k); }
  return out.slice(0, LIMIT);
}

async function call(fetchFn, url, init, label) {
  const res = await fetchFn(url, init);
  if (!res.ok) {
    let msg = ''; try { const b = await res.json(); msg = b.errorMessage || b.message || b.title || ''; } catch {}
    const hint = res.status === 401 || res.status === 403 ? '키가 맞는지, 그 API 사용 신청이 되어 있는지 확인해 주세요.' : res.status === 429 ? '오늘 호출 한도를 넘었어요. 내일 다시 불러와요.' : '';
    throw new Error(label + ' ' + res.status + (msg ? ' · ' + String(msg).slice(0, 120) : '') + (hint ? ' — ' + hint : ''));
  }
  return res.json();
}

export async function shopping(keyword, keys, fetchFn = fetch) {
  const url = SEARCH + '?' + new URLSearchParams({query: keyword, display: '20', sort: 'sim'});
  const b = await call(fetchFn, url, {headers: {'X-Naver-Client-Id': keys.clientId, 'X-Naver-Client-Secret': keys.clientSecret}}, '쇼핑 검색');
  const items = (b.items || []).map((x, i) => ({
    name: plain(x.title), price: count(x.lprice), mall: plain(x.mallName), brand: plain(x.brand || x.maker),
    category: [x.category1, x.category2, x.category3].map(plain).filter(Boolean).join(' > '), url: String(x.link || ''), productId: String(x.productId || ''), rank: i + 1,
  })).filter(x => x.name);
  const prices = items.map(x => x.price).filter(v => v !== null && v > 0);
  return {keyword, total: count(b.total), lowPrice: prices.length ? Math.min(...prices) : null, items};
}

// 데이터랩 비율은 한 요청 안에서 상대값이라, 키워드마다 자기 그래프 안에서 최근 4주와 그 전 8주를 비교한다.
export async function trends(keywords, keys, fetchFn = fetch, now = new Date()) {
  const end = new Date(now.getTime() - 86400000), start = new Date(end.getTime() - 7 * 13 * 86400000), out = [];
  for (const group of chunk(keywords, 5)) {
    const body = {startDate: ymd(start), endDate: ymd(end), timeUnit: 'week', keywordGroups: group.map(k => ({groupName: k, keywords: [k]}))};
    const b = await call(fetchFn, DATALAB, {method: 'POST', headers: {'X-Naver-Client-Id': keys.clientId, 'X-Naver-Client-Secret': keys.clientSecret, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}, '데이터랩');
    for (const r of b.results || []) {
      const points = (r.data || []).map(d => ({period: String(d.period).slice(0, 10), ratio: Number(d.ratio) || 0}));
      const avg = list => (list.length ? list.reduce((a, d) => a + d.ratio, 0) / list.length : null);
      const recent = avg(points.slice(-4)), prior = avg(points.slice(-12, -4));
      out.push({keyword: r.title, recent, prior, change: prior ? (recent - prior) / prior : null, points: points.slice(-12)});
    }
  }
  return out;
}

export async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig));
}

// 검색광고 키워드 도구: 힌트 키워드는 띄어쓰기 없이 한 번에 5개까지. 정확히 같은 키워드와, 연관 키워드 상위 몇 개만 남긴다.
export async function volumes(keywords, keys, fetchFn = fetch, now = () => Date.now()) {
  const out = [], related = [];
  for (const group of chunk(keywords, 5)) {
    const ts = String(now()), signature = await sign(keys.adSecret, ts + '.GET.' + TOOL);
    const url = SEARCHAD + TOOL + '?' + new URLSearchParams({hintKeywords: group.map(k => k.replace(/\s+/g, '')).join(','), showDetail: '1'});
    const b = await call(fetchFn, url, {headers: {'X-Timestamp': ts, 'X-API-KEY': keys.adKey, 'X-Customer': String(keys.adCustomer), 'X-Signature': signature}}, '검색광고');
    const list = (b.keywordList || []).map(x => {
      const pc = count(x.monthlyPcQcCnt), mobile = count(x.monthlyMobileQcCnt), pcClk = count(x.monthlyAvePcClkCnt), moClk = count(x.monthlyAveMobileClkCnt);
      return {keyword: String(x.relKeyword || ''), monthlyPc: pc, monthlyMobile: mobile, volume: pc === null && mobile === null ? null : (pc || 0) + (mobile || 0), clicks: pcClk === null && moClk === null ? null : Math.round(((pcClk || 0) + (moClk || 0)) * 10) / 10, compIdx: ['낮음', '중간', '높음'].includes(x.compIdx) ? x.compIdx : null, adDepth: count(x.plAvgDepth)};
    });
    for (const k of group) { const hit = list.find(x => compact(x.keyword) === compact(k)); if (hit) out.push({...hit, keyword: k}); }
    const asked = new Set(keywords.map(compact));
    related.push(...list.filter(x => !asked.has(compact(x.keyword)) && x.volume !== null).sort((a, b) => b.volume - a.volume).slice(0, 5));
  }
  const seen = new Set();
  return {volumes: out, related: related.filter(x => !seen.has(compact(x.keyword)) && seen.add(compact(x.keyword))).slice(0, 20)};
}

export function readyParts(keys = {}) {
  return {search: !!(keys.clientId && keys.clientSecret), ad: !!(keys.adKey && keys.adSecret && keys.adCustomer)};
}

// 한 번 불러오기: 준비된 API만 부르고, 하나가 실패해도 나머지 결과는 살린다. 실패는 숨기지 않고 errors에 남긴다.
export async function collect(keywordList, keys, {fetchFn = fetch, now = new Date(), pause = () => new Promise(r => setTimeout(r, 150))} = {}) {
  const keywords = cleanKeywords(keywordList), ready = readyParts(keys), errors = [];
  const data = {keywords, shopping: [], trends: [], volumes: [], related: []};
  if (!keywords.length) errors.push('불러올 키워드가 없어요. 사이트를 한 번 열거나 설정에 키워드를 적어 주세요.');
  if (!ready.search && !ready.ad) errors.push('API 키가 아직 없어요. 확장 설정에서 넣어 주세요.');
  if (keywords.length && ready.search) {
    for (const k of keywords) { try { data.shopping.push(await shopping(k, keys, fetchFn)); } catch (e) { errors.push(e.message); if (/401|403|429/.test(e.message)) break; } await pause(); }
    try { data.trends = await trends(keywords, keys, fetchFn, now); } catch (e) { errors.push(e.message); }
  }
  if (keywords.length && ready.ad) { try { Object.assign(data, await volumes(keywords, keys, fetchFn, () => now.getTime())); } catch (e) { errors.push(e.message); } }
  return {id: crypto.randomUUID(), kind: 'api', title: '네이버 API · 키워드 ' + keywords.length + '개', url: '', capturedAt: now.toISOString(), data, errors: [...new Set(errors)].slice(0, 10), parts: ready};
}

// 내 블로그 RSS: 새로 올라간 글의 제목·주소·시각·본문 글자. 서비스 워커에는 DOMParser가 없어 정규식으로 읽는다.
const unCdata = t => String(t || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
export function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 50).map(m => {
    const tag = n => unCdata((m[1].match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>')) || [])[1]);
    const link = tag('link').replace(/&amp;/g, '&'), date = Date.parse(tag('pubDate'));
    // description에는 글 본문(HTML)이 들어온다. 태그를 걷어낸 글자만 남겨 '써즈 말투 샘플'로 쓴다.
    const text = plain(tag('description').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/&nbsp;/g, ' ')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, 6000);
    return {title: plain(tag('title')), url: link.split('?')[0], publishedAt: Number.isNaN(date) ? '' : new Date(date).toISOString(), text};
  }).filter(r => r.title && /^https:\/\/(m\.)?blog\.naver\.com\//.test(r.url));
}
export async function blogFeed(blogId, fetchFn = fetch, now = new Date()) {
  const id = String(blogId || '').trim(); if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) return null;
  const res = await fetchFn('https://rss.blog.naver.com/' + id + '.xml');
  if (!res.ok) throw new Error('블로그 RSS ' + res.status);
  return {id: crypto.randomUUID(), kind: 'rss', title: '내 블로그 새 글 (RSS)', url: '', capturedAt: now.toISOString(), data: {blogId: id, rows: parseRss(await res.text())}};
}

// 내 블로그 글 전체 목록: 공개 목록 API(PostTitleListAsync)를 30개씩 넘기며 읽는다. 로그인·키 없이 되는 공개 주소라 제목·번호·날짜만 온다.
export async function blogPostList(blogId, {fetchFn = fetch, maxPages = 20, pause = () => new Promise(r => setTimeout(r, 250))} = {}) {
  const id = String(blogId || '').trim(); if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) return [];
  const out = [], seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchFn('https://blog.naver.com/PostTitleListAsync.naver?blogId=' + id + '&viewdate=&currentPage=' + page + '&categoryNo=0&parentCategoryNo=&countPerPage=30');
    if (!res.ok) throw new Error('블로그 목록 ' + res.status);
    let body; try { body = JSON.parse((await res.text()).replace(/\\'/g, "'")); } catch { throw new Error('블로그 목록 형식을 읽지 못했어요.'); }
    const list = Array.isArray(body?.postList) ? body.postList : [];
    let fresh = 0;
    for (const p of list) {
      const no = String(p.logNo || '').trim(); if (!/^\d{6,}$/.test(no) || seen.has(no)) continue; seen.add(no); fresh++;
      const d = String(p.addDate || '').trim(), m = d.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      out.push({logNo: no, title: decodeTitle(p.title), url: 'https://blog.naver.com/' + id + '/' + no, publishedAt: m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : ''});
    }
    const total = Number(body?.totalCount || 0);
    if (!fresh || list.length < 30 || (total && out.length >= total)) break;
    await pause();
  }
  return out;
}
function decodeTitle(t) { let s = String(t || ''); try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch {} return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim().slice(0, 200); }
