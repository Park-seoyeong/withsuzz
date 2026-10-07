// 자동 수집: 써즈님이 등록한 화면(블로그 통계·쇼핑커넥트 성과 등)을 정해진 때 뒤쪽 탭으로 열어
// 보이는 글자·표만 읽고 바로 닫는다. 로그인은 이 브라우저에 이미 된 상태를 쓰고, 비밀번호는 다루지 않는다.
export const MAX_PAGES = 10;
const LOGIN = /nid\.naver\.com|\/login|signin|accounts\./i;

function waitLoaded(tabId, timeout = 30000) {
  return new Promise(resolve => {
    const done = ok => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(ok); };
    const on = (id, info) => { if (id === tabId && info.status === 'complete') done(true); };
    const timer = setTimeout(() => done(false), timeout);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') done(true); }).catch(() => done(false));
  });
}

// 로딩 문구가 사라지고 숫자가 보일 때까지 기다린다(최대 45초). 안쪽 프레임(iframe)도 함께 읽는다.
const BUSY = /저장 중|잠시만 기다려|로딩 중|불러오는 중|loading/gi;
async function readAll(tabId) {
  const res = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['collect.js']});
  return res.map(r => r.result).filter(Boolean);
}
function mergeResults(rs) {
  const base = rs[0];
  const text = rs.map(r => r.text).filter(Boolean).join('\n\n----\n\n').slice(0, 60000);
  const tables = rs.flatMap(r => r.tables || []).slice(0, 12);
  const links = [...new Set(rs.flatMap(r => r.links || []))].slice(0, 80);
  return {...base, text, tables, links};
}
function looksReady(m) {
  const body = (m.text + ' ' + m.tables.join(' ')).replace(BUSY, ' ');
  const digits = (body.match(/\d/g) || []).length;
  // 표가 있거나 글자가 충분하고, 로딩 문구를 뺀 나머지에 숫자가 5개 이상이면 다 뜬 것으로 본다(짧은 통계 표도 통과).
  return digits >= 5 && (m.tables.some(t => /\d/.test(t)) || body.trim().length > 150);
}

export async function capturePage(page, {timeout = 45000} = {}) {
  const tab = await chrome.tabs.create({url: page.url, active: false});
  try {
    await waitLoaded(tab.id);
    await new Promise(r => setTimeout(r, 3000));
    let merged = null, lastLen = -1, stable = 0;
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const now = await chrome.tabs.get(tab.id);
      if (LOGIN.test(now.url || '')) throw new Error('로그인이 풀려 있어요. 이 브라우저에서 다시 로그인해 주세요.');
      let readError = null;
      const rs = await readAll(tab.id).catch(e => { readError = e; return []; });
      if (!rs.length && readError && /error page/i.test(readError.message)) throw readError;
      if (rs.length) {
        merged = mergeResults(rs);
        const len = merged.text.length + merged.tables.join('').length;
        stable = len === lastLen ? stable + 1 : 0; lastLen = len;
        if (looksReady(merged) && stable >= 1) break; // 숫자가 보이고 두 번 연속 같으면 다 뜬 것
      }
      await new Promise(r => setTimeout(r, 2500));
    }
    if (!merged || (!merged.text && !merged.tables.length)) throw new Error('화면에서 읽을 글자를 찾지 못했어요.');
    if (!looksReady(merged)) throw new Error('45초 안에 숫자가 뜨지 않았어요(로딩 중이거나 접근이 막힌 화면). 화면을 직접 열어 숫자가 보이는지 확인해 주세요.');
    return {...merged, kind: page.kind || merged.kind, auto: true, pageId: page.id};
  } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}

export async function runAutoPages(reason = '자동') {
  const {autoPages = [], queue = []} = await chrome.storage.local.get(['autoPages', 'queue']);
  let q = queue; const log = [];
  for (const page of autoPages) {
    try {
      const item = await capturePage(page);
      q = [...q.filter(i => !(i.auto && i.pageId === page.id)), item].slice(-20); // 같은 화면은 가장 최근 것만 남긴다.
      log.push({id: page.id, ok: true, at: item.capturedAt});
    } catch (e) { const m = e?.message || String(e); log.push({id: page.id, ok: false, at: new Date().toISOString(), error: /error page|Cannot access|cannot be scripted/i.test(m) ? '화면을 열지 못했어요(인터넷 연결·주소·권한 확인): ' + m : m}); }
  }
  await chrome.storage.local.set({queue: q, lastAuto: {at: new Date().toISOString(), reason, log}});
  return log;
}

// 공식 페이지 읽기: 사이트가 준 주소(최대 6개)를 뒤쪽 탭으로 열어 보이는 글자만 읽고 닫는다. Claude 클라우드는 공식 사이트 접속이 막혀 있어 이 브라우저가 대신 읽는다.
// 권한이 없는 사이트는 읽지 않고 그 사실만 돌려준다(권한은 팝업의 ‘공식 페이지 읽기 허용’으로 한 번만 준다).
export async function readPages(urls) {
  const out = [];
  for (const raw of (Array.isArray(urls) ? urls : []).slice(0, 6)) {
    let u; try { u = new URL(String(raw)); } catch { continue; }
    if (u.protocol !== 'https:' || LOGIN.test(u.href)) continue;
    const allowed = await chrome.permissions.contains({origins: [u.origin + '/*']}).catch(() => false);
    if (!allowed) { out.push({url: u.href, error: '권한 없음'}); continue; }
    const tab = await chrome.tabs.create({url: u.href, active: false});
    try {
      await waitLoaded(tab.id, 25000);
      await new Promise(r => setTimeout(r, 2500));
      let merged = null;
      for (let n = 0; n < 3 && !merged?.text; n++) { const rs = await readAll(tab.id).catch(() => []); if (rs.length) merged = mergeResults(rs); if (!merged?.text) await new Promise(r => setTimeout(r, 2000)); }
      const now = await chrome.tabs.get(tab.id);
      if (LOGIN.test(now.url || '')) out.push({url: u.href, error: '로그인 화면'});
      else if (!merged?.text) out.push({url: u.href, error: '글자를 읽지 못했어요'});
      else out.push({url: u.href, title: String(merged.title || '').slice(0, 200), text: [merged.text, ...(merged.tables || [])].join('\n\n').slice(0, 12000)});
    } catch (e) { out.push({url: u.href, error: String(e?.message || e).slice(0, 120)}); }
    finally { chrome.tabs.remove(tab.id).catch(() => {}); }
  }
  return out;
}
