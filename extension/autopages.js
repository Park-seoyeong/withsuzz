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

export async function capturePage(page, {settle = 5000} = {}) {
  const tab = await chrome.tabs.create({url: page.url, active: false});
  try {
    await waitLoaded(tab.id);
    await new Promise(r => setTimeout(r, settle)); // 통계 화면은 불러온 뒤 숫자를 늦게 그린다.
    const now = await chrome.tabs.get(tab.id);
    if (LOGIN.test(now.url || '')) throw new Error('로그인이 풀려 있어요. 이 브라우저에서 다시 로그인해 주세요.');
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['collect.js']});
    if (!result || (!result.text && !result.tables.length)) throw new Error('화면에서 읽을 글자를 찾지 못했어요.');
    return {...result, kind: page.kind || result.kind, auto: true, pageId: page.id};
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
