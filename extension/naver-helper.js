// 네이버 글쓰기 도우미(시험 기능): 사이트의 '예약 꾸러미'를 확장으로 보내면, 네이버 글쓰기 화면에 작은 판이 떠요.
// 버튼을 누를 때만 제목·본문·사진을 편집기에 넣고, 태그 복사와 예약·발행 버튼은 써즈님이 직접 해요(자동 발행 없음).
(() => {
  if (window.__suzzNaverHelper) return; window.__suzzNaverHelper = true;
  const TITLE = ['.se-documentTitle .se-text-paragraph', '.se-documentTitle [contenteditable="true"]', '.se-title-text', 'textarea[placeholder*="제목"]', 'input[placeholder*="제목"]'];
  const BODY = ['.se-component.se-text .se-text-paragraph', '.se-main-container .se-text-paragraph', '.se-content [contenteditable="true"]', '[contenteditable="true"]'];
  const find = list => { for (const s of list) { const all = [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null || e.getClientRects().length); if (all.length) return all; } return []; };
  const editorHere = () => !!document.querySelector('.se-documentTitle, .se-content, .se-main-container');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 편집 영역 전체(제목+본문)의 글자 수. 도우미 판은 빼고 센다.
  const sizeOf = () => { const box = document.getElementById('suzz-naver-helper'); return document.body.innerText.length - (box ? box.innerText.length : 0) + [...document.querySelectorAll('textarea,input[type=text]')].reduce((a, x) => a + x.value.length, 0); };

  function focusEnd(el) {
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, {bubbles: true, cancelable: true, view: window}));
    el.focus?.();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  // 편집기마다 붙여넣기 처리 방식이 달라 세 가지를 차례로 시도하고, 글자 수가 늘었는지로 성공을 판단한다.
  async function insert(el, {html = '', text}) {
    const before = sizeOf();
    focusEnd(el);
    const dt = new DataTransfer(); if (html) dt.setData('text/html', html); dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    await wait(500); if (sizeOf() > before) return 'paste';
    focusEnd(el); if (document.execCommand('insertText', false, text)) { await wait(300); if (sizeOf() > before) return 'typed'; }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { el.value = text; el.dispatchEvent(new Event('input', {bubbles: true})); return 'value'; }
    try { await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html || text], {type: 'text/html'}), 'text/plain': new Blob([text], {type: 'text/plain'})})]); } catch { try { await navigator.clipboard.writeText(text); } catch {} }
    focusEnd(el); return 'clipboard';
  }
  async function toFiles(photos) { return Promise.all(photos.map(async p => new File([await (await fetch(p.dataUrl)).blob()], p.name, {type: p.type || 'image/jpeg'}))); }
  async function addPhotos(photos) {
    const files = await toFiles(photos), count = () => document.querySelectorAll('.se-image, .se-component.se-image, img.se-image-resource').length, before = count();
    const target = document.querySelector('.se-main-container, .se-content') || document.body, dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
    for (const t of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(t, {dataTransfer: dt, bubbles: true, cancelable: true}));
    for (let n = 0; n < 16; n++) { await wait(500); if (count() > before) return 'drop'; }
    const input = [...document.querySelectorAll('input[type=file]')].find(i => !i.accept || /image/.test(i.accept));
    if (input) { const d2 = new DataTransfer(); files.forEach(f => d2.items.add(f)); input.files = d2.files; input.dispatchEvent(new Event('change', {bubbles: true})); for (let n = 0; n < 16; n++) { await wait(500); if (count() > before) return 'input'; } }
    return 'manual';
  }

  function panel(pkg) {
    const box = document.createElement('div'); box.id = 'suzz-naver-helper';
    box.innerHTML = `<style>#suzz-naver-helper{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:260px;background:#fff;border:1px solid #c9dbe8;border-radius:14px;box-shadow:0 8px 28px rgba(30,60,90,.18);padding:12px;font:13px/1.5 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#2e465d}#suzz-naver-helper b{display:block;margin-bottom:4px}#suzz-naver-helper button{width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid #c9dbe8;background:#fff;cursor:pointer;font:inherit}#suzz-naver-helper button.p{background:#70afd5;border-color:#70afd5;color:#fff;font-weight:600}#suzz-naver-helper small{display:block;color:#62788a;margin-top:6px}#suzz-naver-helper .x{position:absolute;top:6px;right:10px;border:0;width:auto;background:none;color:#8094a5;margin:0;padding:0}</style>
      <button class="x" data-k="close" title="닫기">✕</button><b>써즈 글 넣기 (시험)</b><div style="color:#62788a">${pkg.title.replace(/[<>&]/g, '')}</div>
      <button class="p" data-k="title">① 제목 넣기</button><button class="p" data-k="body">② 본문 넣기</button>${pkg.photos?.length ? `<button class="p" data-k="photos">③ 사진 ${pkg.photos.length}장 넣기</button>` : ''}<button data-k="tags">태그 복사</button><button data-k="done">다 넣었어요 (꾸러미 지우기)</button>
      <small id="suzz-nh-status">버튼은 순서대로 눌러 주세요. 예약 시각 ${pkg.when || ''} · 발행 버튼은 직접 눌러요.</small>`;
    document.body.append(box);
    const status = t => { box.querySelector('#suzz-nh-status').textContent = t; };
    box.addEventListener('click', async e => {
      const k = e.target?.dataset?.k; if (!k) return;
      try {
        if (k === 'close') box.remove();
        if (k === 'title') { const [el] = find(TITLE); if (!el) return status('제목 칸을 찾지 못했어요. 제목 칸을 한 번 누른 뒤 다시 눌러 주세요.'); const how = await insert(el, {text: pkg.title}); status(how === 'clipboard' ? '제목을 복사해 뒀어요. 제목 칸에서 Ctrl+V 해 주세요.' : '제목을 넣었어요.'); }
        if (k === 'body') { const els = find(BODY).filter(x => !x.closest('.se-documentTitle')); const el = els[0]; if (!el) return status('본문 칸을 찾지 못했어요. 본문을 한 번 누른 뒤 다시 눌러 주세요.'); status('본문을 넣는 중…'); const how = await insert(el, {html: pkg.html, text: pkg.text}); status(how === 'clipboard' ? '본문을 서식째 복사해 뒀어요. 본문에서 Ctrl+V 해 주세요.' : '본문을 넣었어요. 소제목·굵게가 맞는지 봐 주세요.'); }
        if (k === 'photos') { status('사진을 올리는 중… (장마다 몇 초)'); const how = await addPhotos(pkg.photos); status(how === 'manual' ? '사진을 자동으로 넣지 못했어요. 사이트의 ‘사진 순서대로 저장’으로 받아 직접 올려 주세요.' : '사진을 넣었어요. 순서와 위치를 확인해 주세요.'); }
        if (k === 'tags') { await navigator.clipboard.writeText(pkg.tags || ''); status('태그를 복사했어요. 발행 창의 태그 칸에 붙여넣어 주세요.'); }
        if (k === 'done') { await chrome.storage.local.remove('naverPost'); box.remove(); }
      } catch (err) { status('실패했어요: ' + (err?.message || err)); }
    });
  }

  (async () => {
    for (let n = 0; n < 60 && !editorHere(); n++) await wait(500);
    if (!editorHere()) return;
    const {naverPost} = await chrome.storage.local.get('naverPost');
    if (!naverPost || Date.now() - Date.parse(naverPost.savedAt) > 2 * 86400000) return;
    panel(naverPost);
  })();
})();
