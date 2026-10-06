// 써즈의 동네방네 사이트(Claude 아티팩트 등)가 열려 있으면, 확장이 모아 둔 화면 자료·API 결과를 그 페이지에 건넨다.
// 사이트가 먼저 인사(suzz-ext-hello)를 보내야만 응답하고, 받았다는 확인(suzz-ext-ack) 뒤에 보관함에서 지운다.
// 인사에 담긴 키워드(사이트의 상품·시즌·추천 키워드)는 API로 불러올 키워드 목록으로 기억한다.
window.addEventListener('message', async event => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'suzz-ext-hello') {
    if (Array.isArray(event.data.keywords)) {
      const watch = [...new Set(event.data.keywords.map(k => String(k || '').trim().slice(0, 40)).filter(k => k.length >= 2))].slice(0, 30);
      if (watch.length) await chrome.storage.local.set({watch});
    }
    const {queue = []} = await chrome.storage.local.get('queue');
    window.postMessage({type: 'suzz-ext-payload', version: 2, items: queue}, '*');
  }
  // 사이트에서 키워드 검색량을 바로 물어보면, 확장 백그라운드가 써즈님 키로 API를 불러 답한다(키는 넘기지 않음).
  if (event.data.type === 'suzz-ext-lookup' && Array.isArray(event.data.keywords)) {
    const keywords = event.data.keywords.map(k => String(k || '').trim().slice(0, 40)).filter(Boolean).slice(0, 5);
    let reply;
    try { reply = await chrome.runtime.sendMessage({type: 'suzz-api-lookup', keywords}); } catch (e) { reply = {ok: false, error: e?.message || '확장과 연결하지 못했어요.'}; }
    window.postMessage({type: 'suzz-ext-lookup-result', id: event.data.id, ...reply}, '*');
  }
  if (event.data.type === 'suzz-ext-ack' && Array.isArray(event.data.ids)) {
    const {queue = []} = await chrome.storage.local.get('queue');
    await chrome.storage.local.set({queue: queue.filter(i => !event.data.ids.includes(i.id))});
  }
});
window.postMessage({type: 'suzz-ext-ready'}, '*');
