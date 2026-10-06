// Claude 아티팩트 연결부: 기존 Worker 서버 코드를 브라우저 안에서 돌리고,
// D1 → db 기능, R2 → assets 기능, AI → sample 기능으로 바꿔 끼운다.
// app.js의 fetch('/api/...') 요청은 이 파일이 가로채 같은 서버 코드로 처리한다.
import worker from './server.mjs';

const CHUNK = 60000; // 한 문서 256KiB 제한 안에 들어가도록 상태 JSON을 나눠 저장한다.
const META = 'workspace/meta';
const enc = new TextEncoder();

function notice(text) {
  let bar = document.getElementById('suzz-notice');
  if (!bar) { bar = document.createElement('div'); bar.id = 'suzz-notice'; bar.className = 'suzz-notice'; bar.setAttribute('role', 'status'); document.body.append(bar); }
  bar.textContent = text;
}

function chunked(db) {
  let cache = null; // {rev, doc, parts}
  let loading = null;
  let writing = Promise.resolve();
  let ownRev = 0; // 이 창이 저장한 가장 최근 버전: 자기 저장 알림은 무시한다.
  async function load() {
    const meta = await db.doc(META).get();
    if (!meta.exists) return { rev: 0, doc: null, parts: [] };
    const m = meta.data();
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await db.collection(META + '/chunks').limit(1000).get();
      const parts = [];
      for (const d of snap.docs) { const n = Number(d.id.slice(1)); if (n < m.n) parts[n] = d.data().s; }
      const doc = parts.length === m.n && !parts.includes(undefined) ? parts.join('') : null;
      if (doc !== null && (!m.hash || m.hash === await digest(doc))) return { rev: m.rev, doc, parts };
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    }
    throw Object.assign(new Error('저장된 자료를 읽는 중 다른 창의 저장과 겹쳤어요. 잠시 뒤 다시 열어 주세요.'), { status: 409 });
  }
  async function current() { if (cache) return cache; if (!loading) loading = load().then(c => { cache = c; loading = null; return c; }, e => { loading = null; throw e; }); return loading; }
  async function write(rev, doc) {
    const parts = []; for (let i = 0; i < doc.length; i += CHUNK) parts.push(doc.slice(i, i + CHUNK));
    const old = cache?.parts || [];
    for (let i = 0; i < parts.length; i++) if (parts[i] !== old[i]) await db.doc(META + '/chunks/c' + String(i).padStart(4, '0')).set({ s: parts[i] });
    ownRev = Math.max(ownRev, rev);
    await db.doc(META).set({ rev, n: parts.length, hash: await digest(doc), size: enc.encode(doc).length, at: new Date().toISOString() });
    for (let i = parts.length; i < old.length; i++) await db.doc(META + '/chunks/c' + String(i).padStart(4, '0')).delete();
    cache = { rev, doc, parts };
  }
  // 다른 창·기기에서 저장하면 다음 요청 때 새 자료를 읽는다.
  db.doc(META).onSnapshot(s => {
    if (!s.exists || s.metadata.hasPendingWrites) return;
    const rev = s.data().rev;
    if (rev <= ownRev) return;
    if (cache && rev > cache.rev) { cache = null; notice('다른 창에서 바뀐 내용이 있어요. 화면을 다시 열면 최신 자료가 보여요.'); }
  }, () => {});
  return {
    prepare(query) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (/^SELECT doc,rev FROM workspace/.test(query)) { const c = await current(); return c.doc === null ? null : { doc: c.doc, rev: c.rev }; }
          return null; // 세션·로그인 제한 표는 아티팩트에서 쓰지 않는다(claude.ai가 접근을 관리).
        },
        async run() {
          if (/^INSERT OR IGNORE INTO workspace/.test(query)) {
            return writing = writing.then(async () => { const c = await current(); if (c.doc !== null) return { meta: { changes: 0 } }; await write(1, args[1]); return { meta: { changes: 1 } }; });
          }
          if (/^UPDATE workspace SET doc=\?,rev=rev\+1 WHERE id=\? AND rev=\?/.test(query)) {
            return writing = writing.then(async () => { const c = await current(); if (c.rev !== args[2]) return { meta: { changes: 0 } }; await write(c.rev + 1, args[0]); return { meta: { changes: 1 } }; });
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

async function digest(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(h).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}

function bucket(db, assets) {
  const ref = key => db.doc('blobs/' + key.replace(/[^A-Za-z0-9_.~:@+-]/g, '~'));
  const TEXT = { 'text/plain': 1, 'text/markdown': 1, 'application/json': 1, 'text/csv': 1 };
  return {
    async put(key, data, opts = {}) {
      if (!assets) throw Object.assign(new Error('파일 저장은 아티팩트 소유자만 할 수 있어요.'), { status: 403 });
      const type = opts.httpMetadata?.contentType || 'application/octet-stream';
      const up = await assets.upload(new Blob([data], { type }), TEXT[type] ? { type } : undefined);
      await ref(key).set({ id: up.id, type, size: up.sizeBytes });
    },
    async get(key) {
      const m = await ref(key).get(); if (!m.exists) return null;
      const r = await fetch('/_blob/' + m.data().id); if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      return { size: buf.byteLength, body: buf, arrayBuffer: async () => buf };
    },
    async delete(key) { const m = await ref(key).get(); if (!m.exists) return; try { await assets?.delete(m.data().id); } catch {} await ref(key).delete(); },
  };
}

// PDF 읽기: 처음 PDF를 만났을 때만 pdf.js를 불러온다(아티팩트가 허용하는 cdnjs).
// 별도 작업 스레드를 만들 수 없는 환경이라 worker 스크립트를 함께 불러 화면 스레드에서 처리한다.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfLib = null;
function loadScript(src) { return new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('PDF 읽기 도구를 불러오지 못했어요.')); document.head.append(el); }); }
async function pdfjs() {
  if (!pdfLib) pdfLib = (async () => { await loadScript(PDFJS + 'pdf.worker.min.js'); await loadScript(PDFJS + 'pdf.min.js'); return window.pdfjsLib; })().catch(e => { pdfLib = null; throw e; });
  return pdfLib;
}
async function readPdf(bytes, {maxPages = 40, maxImages = 3} = {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = Math.min(doc.numPages, maxPages), texts = [], images = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n), content = await page.getTextContent();
    const text = content.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join(' ').replace(/[ \t]+/g, ' ').trim();
    texts.push(text);
    // 글자가 거의 없는 쪽(스캔·사진 PDF)은 그림으로 바꿔 Claude가 보게 한다.
    if (text.length < 40 && images.length < maxImages) {
      const view = page.getViewport({ scale: 1.6 }), canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
      images.push(await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85)));
    }
  }
  return { pages: doc.numPages, readPages: pages, text: texts.map((t, i) => t ? '[' + (i + 1) + '쪽]\n' + t : '').filter(Boolean).join('\n\n'), images: images.filter(Boolean) };
}

const use = name => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const ready = (async () => {
  const [db, assets, sample, downloads] = await Promise.all(['db', 'assets', 'sample', 'downloads'].map(use));
  if (!db) throw Object.assign(new Error('Claude 앱(claude.ai)에서 로그인한 상태로 열어야 자료를 불러올 수 있어요.'), { status: 503 });
  window.suzzSave = downloads ? async (filename, data) => {
    try { await downloads.save({ filename, data }); } catch (e) { if (e?.code !== 'declined' && e?.code !== 'cancelled') throw new Error('파일을 저장하지 못했어요.'); }
  } : null;
  return { DB: chunked(db), BUCKET: bucket(db, assets), SAMPLE: sample || undefined, PDF: readPdf, ARTIFACT: true };
})();

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !/^\/(api|download)\//.test(url.pathname)) return nativeFetch(input, init);
  let env;
  try { env = await ready; } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: e.status || 503, headers: { 'Content-Type': 'application/json' } }); }
  const request = new Request(url.href, init);
  return worker.fetch(request, env);
};

// 첨부 파일 링크는 페이지 밖으로 나갈 수 없어서, 눌렀을 때 저장 창으로 내려준다.
document.addEventListener('click', async e => {
  const a = e.target.closest?.('a[href^="/api/files/"]');
  if (!a) return;
  e.preventDefault();
  try {
    const r = await window.fetch(a.getAttribute('href'));
    if (!r.ok) throw new Error('파일을 찾지 못했어요.');
    const name = decodeURIComponent((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || a.textContent || 'file');
    if (window.suzzSave) await window.suzzSave(name, await r.blob());
  } catch (err) { notice(err.message); }
}, true);

// 사진 미리보기(<img src="/api/files/...">)도 같은 방식으로 불러와 화면에 붙인다.
const shown = new Map();
async function hydrate(img) {
  const src = img.getAttribute('src');
  if (!src?.startsWith('/api/files/')) return;
  img.removeAttribute('src');
  try {
    if (!shown.has(src)) shown.set(src, window.fetch(src).then(r => (r.ok ? r.blob() : null)).then(b => (b ? URL.createObjectURL(b) : null)));
    const url = await shown.get(src);
    if (url) img.src = url; else img.alt = (img.alt || '사진') + ' · 불러오지 못했어요';
  } catch { shown.delete(src); }
}
new MutationObserver(list => {
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) (n.matches('img[src^="/api/files/"]') ? [n] : n.querySelectorAll('img[src^="/api/files/"]')).forEach(hydrate);
}).observe(document.documentElement, { childList: true, subtree: true });
