// 자동 작업 두 가지:
// 1) 네이버 API: 6시간마다 써즈님 키로 공식 API를 부른다(naver-api.js).
// 2) 자동 수집: 등록한 화면을 하루 두 번(9시·21시 무렵) 뒤쪽 탭으로 열어 읽는다(autopages.js).
// 결과는 보관함(queue)에 넣고, 사이트를 열면 deliver.js가 넘겨 준다.
import {collect, cleanKeywords, blogFeed} from './naver-api.js';
import {runAutoPages, readPages, crawlPages} from './autopages.js';
import {shoppingPage} from './shoppage.js';
const ALARM = 'suzz-naver-api', EVERY = 360, AUTO = 'suzz-auto-pages';

async function run(reason) {
  const {keys = {}, watch = [], manualKeywords = '', queue = []} = await chrome.storage.local.get(['keys', 'watch', 'manualKeywords', 'queue']);
  const list = cleanKeywords([...String(manualKeywords).split(/[\n,]/), ...watch]);
  const item = await collect(list, keys);
  item.reason = reason;
  // 쇼핑 검색 API 키가 없고 '화면으로 읽기'를 켰으면, 키워드 앞 5개만 쇼핑 화면을 뒤쪽 탭으로 열어 최저가를 읽는다.
  const {shopPages = false} = await chrome.storage.local.get('shopPages');
  if (shopPages && !item.parts.search && item.data.keywords.length) {
    for (const k of item.data.keywords.slice(0, 5)) { try { item.data.shopping.push(await shoppingPage(k)); } catch (e) { item.errors.push(e.message); if (/자동입력/.test(e.message)) break; } }
  }
  const rest = queue.filter(i => i.kind !== 'api');
  // 내 블로그 RSS도 함께: 새로 올라간 글을 사이트가 자동으로 ‘게시 확인’에 쓴다(키 없이 공개 주소만 읽음).
  const {blogId = 'withsuzz'} = await chrome.storage.local.get('blogId');
  let feed = null; try { feed = await blogFeed(blogId); } catch (e) { item.errors = [...item.errors, e.message]; }
  if (feed) rest.splice(0, rest.length, ...rest.filter(i => i.kind !== 'rss'), feed);
  await chrome.storage.local.set({queue: [...rest, item].slice(-20), lastApi: {at: item.capturedAt, keywords: item.data.keywords.length, shopping: item.data.shopping.length, trends: item.data.trends.length, volumes: item.data.volumes.length, errors: item.errors}});
  return item;
}

function nextAutoTime(now = new Date()) {
  // 한국 시간 9시·21시 중 가장 가까운 다음 시각
  const kst = new Date(now.getTime() + 9 * 3600000), h = kst.getUTCHours();
  const target = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), h < 9 ? 9 : h < 21 ? 21 : 33) - 9 * 3600000);
  return target.getTime();
}
function schedule() {
  chrome.alarms.create(ALARM, {delayInMinutes: 1, periodInMinutes: EVERY});
  chrome.alarms.create(AUTO, {when: nextAutoTime(), periodInMinutes: 720});
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === ALARM) run('자동').catch(() => {});
  if (a.name === AUTO) runAutoPages('자동').then(() => pushToSite()).catch(() => {});
});
// 열려 있는 사이트 탭(연결한 주소·Claude 아티팩트)에 '새 자료 있음'을 알려 새로고침 없이 받게 한다.
async function pushToSite() {
  const {linked = []} = await chrome.storage.local.get('linked');
  const urls = [...new Set([...linked.map(o => o + '/*'), 'https://claude.ai/*', 'https://*.claudeusercontent.com/*'])];
  let tabs = []; try { tabs = await chrome.tabs.query({url: urls}); } catch { return 0; }
  let n = 0; for (const t of tabs) { try { await chrome.tabs.sendMessage(t.id, {type: 'suzz-push'}); n++; } catch {} }
  return n;
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'suzz-api-run') { run('직접').then(i => reply({ok: true, errors: i.errors, data: {keywords: i.data.keywords.length, shopping: i.data.shopping.length, trends: i.data.trends.length, volumes: i.data.volumes.length}})).catch(e => reply({ok: false, error: e.message})); return true; }
  if (msg?.type === 'suzz-naver-post') {
    const p = msg.pkg || {}, pkg = {title: String(p.title || '').slice(0, 200), html: String(p.html || '').slice(0, 400000), text: String(p.text || '').slice(0, 200000), tags: String(p.tags || '').slice(0, 1000), when: String(p.when || '').slice(0, 40), photos: (Array.isArray(p.photos) ? p.photos : []).slice(0, 30).filter(x => /^data:image\//.test(x?.dataUrl || '')).map(x => ({name: String(x.name || 'photo.jpg').slice(0, 120), type: String(x.type || ''), dataUrl: x.dataUrl})), savedAt: new Date().toISOString()};
    chrome.storage.local.set({naverPost: pkg}).then(() => chrome.tabs.create({url: 'https://blog.naver.com/GoBlogWrite.naver'})).then(() => reply({ok: true, photos: pkg.photos.length})).catch(e => reply({ok: false, error: e.message}));
    return true;
  }
  if (msg?.type === 'suzz-api-lookup') {
    chrome.storage.local.get('keys').then(({keys = {}}) => collect(msg.keywords, keys, {pause: () => Promise.resolve()}))
      .then(item => reply({ok: true, item: {...item, lookup: true}})).catch(e => reply({ok: false, error: e.message}));
    return true;
  }
  if (msg?.type === 'suzz-crawl') {
    (async () => {
      const page = {id: crypto.randomUUID(), url: String(msg.url || ''), title: String(msg.title || '').slice(0, 120), kind: msg.kind || 'products'};
      const items = await crawlPages(page, {maxPages: Math.min(40, Number(msg.maxPages) || 20)});
      const {queue = []} = await chrome.storage.local.get('queue');
      const rows = items.at(-1)?.data?.rows?.length || 0;
      await chrome.storage.local.set({queue: [...queue.filter(i => !(i.auto && i.pageId === page.id)), ...items].slice(-60), lastCrawl: {at: new Date().toISOString(), pages: items.length, rows, url: page.url, hint: items[0]?.pagerHint && !rows ? '다음 쪽 버튼을 못 찾았어요(마지막 자료 복사로 모양 전달)' : ''}});
      await pushToSite();
      return items.length;
    })().then(n => chrome.storage.local.get('lastCrawl').then(({lastCrawl}) => reply({ok: true, pages: n, rows: lastCrawl?.rows || 0}))).catch(async e => { await chrome.storage.local.set({lastCrawl: {at: new Date().toISOString(), pages: 0, url: String(msg.url || ''), error: e.message}}); reply({ok: false, error: e.message}); });
    return true;
  }
  if (msg?.type === 'suzz-read-pages') { readPages(msg.urls).then(async pages => { await chrome.storage.local.set({lastRead: {at: new Date().toISOString(), ok: pages.filter(p => p.text).length, fail: pages.filter(p => !p.text).map(p => (p.error || '?') + ' ' + p.url.replace(/^https:\/\//, '').slice(0, 40))}}); reply({ok: true, pages}); }).catch(async e => { await chrome.storage.local.set({lastRead: {at: new Date().toISOString(), ok: 0, fail: [e.message]}}); reply({ok: false, error: e.message}); }); return true; }
  if (msg?.type === 'suzz-auto-run') { runAutoPages('직접').then(log => reply({ok: true, log})).catch(e => reply({ok: false, error: e.message})); return true; }
});
