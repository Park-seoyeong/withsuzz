const KIND = {naver: '네이버 통계', posts: '네이버 글별 조회', products: '상품 목록 (상품 찾기)', links: '발급 링크 관리', other: '기타 화면', earnings: '수익', keywords: '키워드 분석 화면', api: '네이버 API', rss: '블로그 RSS'};
const status = t => { document.getElementById('status').textContent = t; };
const esc = t => String(t || '').replace(/[<>&]/g, '');
async function show() {
  const {queue = [], keys = {}, lastApi, linked = [], lastCrawl, lastRead} = await chrome.storage.local.get(['queue', 'keys', 'lastApi', 'linked', 'lastCrawl', 'lastRead']);
  const pagesOk = await chrome.permissions.contains({origins: ['https://*/*']}).catch(() => false);
  const v = chrome.runtime.getManifest().version, when = t => t ? new Date(t).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
  document.getElementById('link-state').textContent = '수집기 ' + v + ' · 연결한 사이트 ' + linked.length + '곳' + (linked.length ? '' : ' (사이트 탭에서 ‘이 탭의 사이트와 연결’을 눌러 주세요)') + ' · 보관함 ' + queue.length + '개'
    + (lastCrawl ? ' · 마지막 긁기 ' + when(lastCrawl.at) + ': ' + (lastCrawl.error ? '실패 — ' + lastCrawl.error : lastCrawl.pages + '쪽' + (lastCrawl.rows ? ' · JSON 상품 ' + lastCrawl.rows + '개' : '') + (lastCrawl.hint ? ' · ' + lastCrawl.hint : '')) : '')
    + ' · 공식 페이지 읽기 ' + (pagesOk ? '허용됨' : '아직 허용 안 됨 (아래 버튼)') + (lastRead ? ' · 마지막 읽기 ' + when(lastRead.at) + ': 성공 ' + lastRead.ok + (lastRead.fail?.length ? ' · 실패 ' + lastRead.fail.join(', ') : '') : '');
  document.getElementById('queue').innerHTML = queue.length ? queue.map(i => `<li><strong>${KIND[i.kind] || esc(i.kind)}</strong> · ${new Date(i.capturedAt).toLocaleString('ko-KR')}<br><small>${esc(i.title)}${i.errors?.length ? ' · 못 불러온 것 ' + i.errors.length : ''}</small></li>`).join('') : '<li><small>아직 보낼 자료가 없어요.</small></li>';
  const ready = !!(keys.clientId || keys.adKey);
  document.getElementById('api-state').textContent = !ready ? 'API 키가 없어요. ‘API 설정’에서 넣으면 6시간마다 검색량·트렌드·최저가를 불러와요.' : lastApi ? '마지막 API 불러오기: ' + new Date(lastApi.at).toLocaleString('ko-KR') + (lastApi.errors?.length ? ' (일부 실패)' : '') : 'API 키 저장됨 · 아직 불러오기 전이에요.';
}
document.getElementById('grab').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['collect.js']});
    if (!result || (!result.text && !result.tables.length)) { status('이 화면에서 읽을 글자를 찾지 못했어요.'); return; }
    if (result.kind === 'links') { status('이 화면(' + (result.activeTab || '') + ')은 상품 목록이 아니에요. 쇼핑 커넥트 → 상품 찾기 화면에서 보내 주세요.'); return; }
    const {queue = []} = await chrome.storage.local.get('queue');
    await chrome.storage.local.set({queue: [...queue, result].slice(-20)});
    status(KIND[result.kind] + ' 화면을 담았어요. 사이트를 열면 받아져요.');
    show();
  } catch (e) { status('이 페이지는 읽을 수 없어요 (브라우저 설정 페이지 등).'); }
});
// 사이트(Claude 아티팩트 등)가 열린 탭에서 누르면, 그 탭 안의 사이트 주소에 전달 스크립트를 연결한다.
document.getElementById('link').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const frames = await chrome.webNavigation.getAllFrames({tabId: tab.id});
    const origins = [...new Set(frames.map(f => { try { const u = new URL(f.url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } }).filter(Boolean))];
    if (!origins.length) { status('이 탭에서 연결할 사이트를 찾지 못했어요.'); return; }
    const ok = await chrome.permissions.request({origins: origins.map(o => o + '/*')});
    if (!ok) { status('연결을 허락하지 않았어요.'); return; }
    const old = (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id);
    const id = 'suzz-deliver';
    if (old.includes(id)) await chrome.scripting.unregisterContentScripts({ids: [id]});
    const {linked = []} = await chrome.storage.local.get('linked'), all = [...new Set([...linked, ...origins])].slice(-20);
    await chrome.scripting.registerContentScripts([{id, matches: all.map(o => o + '/*'), js: ['deliver.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true}]);
    await chrome.storage.local.set({linked: all});
    await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['deliver.js']}).catch(() => {});
    status('연결했어요. 사이트에 ‘확장에서 받은 자료’ 버튼이 나타나요.');
  } catch (e) { status('연결하지 못했어요: ' + (e?.message || '')); }
});
document.getElementById('copy').addEventListener('click', async () => {
  const {queue = []} = await chrome.storage.local.get('queue'), last = [...queue].reverse().find(i => i.kind !== 'api');
  if (!last) { status('복사할 화면 자료가 없어요.'); return; }
  await navigator.clipboard.writeText([last.title, last.url, ...(last.pagerHint ? ['[다음 쪽 버튼 후보]\n' + last.pagerHint] : []), ...last.tables, last.text].join('\n\n'));
  status('복사했어요. 사이트의 ‘캡처로 담기/성과 입력’ 칸에 붙여넣어 주세요.');
});
document.getElementById('api-run').addEventListener('click', async e => {
  e.target.disabled = true; status('네이버 API를 불러오는 중이에요…');
  try {
    const r = await chrome.runtime.sendMessage({type: 'suzz-api-run'});
    status(!r?.ok ? '불러오지 못했어요: ' + (r?.error || '') : '키워드 ' + r.data.keywords + '개를 불러왔어요' + (r.errors.length ? ' · 못 불러온 것: ' + r.errors[0] : '. 사이트를 열면 저장돼요.'));
  } finally { e.target.disabled = false; show(); }
});
// 지금 보고 있는 화면을 자동 수집 목록에 넣는다. 그 사이트를 뒤쪽 탭으로 열어 읽을 권한을 이때 한 번 묻는다.
document.getElementById('auto-add').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true}), u = new URL(tab.url);
    if (u.protocol !== 'https:') { status('https 화면만 자동으로 읽을 수 있어요.'); return; }
    const ok = await chrome.permissions.request({origins: [u.origin + '/*']});
    if (!ok) { status('권한을 허락하지 않아 등록하지 않았어요.'); return; }
    const {autoPages = []} = await chrome.storage.local.get('autoPages');
    if (autoPages.some(p => p.url === tab.url)) { status('이미 등록된 화면이에요.'); return; }
    if (autoPages.length >= 10) { status('자동 수집은 10개까지예요. API 설정 화면에서 하나를 빼 주세요.'); return; }
    await chrome.storage.local.set({autoPages: [...autoPages, {id: crypto.randomUUID(), url: tab.url, title: tab.title.slice(0, 120), addedAt: new Date().toISOString()}]});
    status('등록했어요. 매일 9시·21시 무렵 이 화면을 뒤쪽 탭으로 열어 읽어 둬요.');
  } catch (e) { status('등록하지 못했어요: ' + (e?.message || '')); }
});
document.getElementById('api-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
show();

// 글쓰기 전 공식 페이지(축제·관광청·업체 사이트)를 이 브라우저가 대신 읽으려면 https 전체 읽기 권한이 한 번 필요하다. 로그인·비밀번호는 다루지 않는다.
document.getElementById('read-allow').addEventListener('click', async () => {
  try {
    const ok = await chrome.permissions.request({origins: ['https://*/*']});
    status(ok ? '허용했어요. 이제 초안을 만들 때 공식 페이지를 대신 읽어 사이트에 넘겨요.' : '허용하지 않았어요. 공식 페이지는 검색 요약으로만 참고해요.');
  } catch (e) { status('허용하지 못했어요: ' + (e?.message || e)); }
});

// 상품 목록 전부 긁기: 지금 보는 목록 화면(브랜드커넥트·쇼핑커넥트 상품 등)을 뒤쪽 탭으로 열어 끝까지 스크롤하고 ‘다음’ 쪽을 눌러 가며 최대 20쪽을 읽는다.
document.getElementById('crawl').addEventListener('click', async e => {
  e.target.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true}), u = new URL(tab.url);
    if (u.protocol !== 'https:') { status('https 화면만 읽을 수 있어요.'); return; }
    const ok = await chrome.permissions.request({origins: [u.origin + '/*']});
    if (!ok) { status('권한을 허락하지 않아 읽지 않았어요.'); return; }
    if (/brandconnect|shopping-connect|shoppingconnect/i.test(u.host + u.pathname)) {
      const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['collect.js']}).catch(() => [{result: null}]);
      if (result && ['earnings', 'links'].includes(result.kind) && result.activeTab) { status('이 화면은 ‘' + result.activeTab + '’이에요. 쇼핑 커넥트 → 상품 찾기 화면을 띄운 뒤 눌러 주세요.'); return; }
    }
    status('뒤쪽 탭에서 목록을 끝까지 읽는 중… (쪽마다 몇 초, 창을 닫지 마세요)');
    const r = await chrome.runtime.sendMessage({type: 'suzz-crawl', url: tab.url, title: tab.title, kind: 'products'});
    status(r?.ok ? (r.pages + '쪽을 읽었어요' + (r.rows ? ' · 상품 JSON ' + r.rows + '개를 그대로 받아 적었어요' : '') + '. 사이트를 열면 상품으로 저장돼요.' + (r.pages === 1 ? ' 1쪽만 읽혔다면 ‘마지막 자료 복사’를 눌러 Claude에게 붙여넣어 주세요(다음 쪽 버튼 모양이 담겨 있어요).' : '')) : '읽지 못했어요: ' + (r?.error || ''));
  } catch (err) { status('읽지 못했어요: ' + (err?.message || err)); }
  finally { e.target.disabled = false; show(); }
});
