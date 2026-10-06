const KIND = {naver: '네이버 통계', posts: '네이버 글별 조회', products: '상품 목록', earnings: '수익'};
const status = t => { document.getElementById('status').textContent = t; };
async function show() {
  const {queue = []} = await chrome.storage.local.get('queue');
  document.getElementById('queue').innerHTML = queue.length ? queue.map(i => `<li><strong>${KIND[i.kind] || i.kind}</strong> · ${new Date(i.capturedAt).toLocaleString('ko-KR')}<br><small>${i.title.replace(/[<>&]/g, '')}</small></li>`).join('') : '<li><small>아직 보낼 자료가 없어요.</small></li>';
}
document.getElementById('grab').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['collect.js']});
    if (!result || (!result.text && !result.tables.length)) { status('이 화면에서 읽을 글자를 찾지 못했어요.'); return; }
    const {queue = []} = await chrome.storage.local.get('queue');
    await chrome.storage.local.set({queue: [...queue, result].slice(-20)});
    status(KIND[result.kind] + ' 화면을 담았어요. 사이트를 열면 받아져요.'); // 사이트(Claude 아티팩트 등)가 열린 탭에서 누르면, 그 탭 안의 사이트 주소에 전달 스크립트를 연결한다.
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
show();
  } catch (e) { status('이 페이지는 읽을 수 없어요 (브라우저 설정 페이지 등).'); }
});
document.getElementById('copy').addEventListener('click', async () => {
  const {queue = []} = await chrome.storage.local.get('queue'), last = queue.at(-1);
  if (!last) { status('복사할 자료가 없어요.'); return; }
  await navigator.clipboard.writeText([last.title, last.url, ...last.tables, last.text].join('\n\n'));
  status('복사했어요. 사이트의 ‘캡처로 담기/성과 입력’ 칸에 붙여넣어 주세요.');
});
show();
