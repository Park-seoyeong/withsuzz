// 써즈의 동네방네 사이트(Claude 아티팩트 등)가 열려 있으면, 확장이 모아 둔 화면 자료를 그 페이지에 건넨다.
// 사이트가 먼저 인사(suzz-ext-hello)를 보내야만 응답하고, 받았다는 확인(suzz-ext-ack) 뒤에 보관함에서 지운다.
window.addEventListener('message', async event => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'suzz-ext-hello') {
    const {queue = []} = await chrome.storage.local.get('queue');
    window.postMessage({type: 'suzz-ext-payload', version: 1, items: queue}, '*');
  }
  if (event.data.type === 'suzz-ext-ack' && Array.isArray(event.data.ids)) {
    const {queue = []} = await chrome.storage.local.get('queue');
    await chrome.storage.local.set({queue: queue.filter(i => !event.data.ids.includes(i.id))});
  }
});
window.postMessage({type: 'suzz-ext-ready'}, '*');
