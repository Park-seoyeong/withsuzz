const F = ['clientId', 'clientSecret', 'adKey', 'adSecret', 'adCustomer'], $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; };
async function load() {
  const {keys = {}, manualKeywords = '', watch = [], lastApi, blogId = 'withsuzz'} = await chrome.storage.local.get(['keys', 'manualKeywords', 'watch', 'lastApi', 'blogId']);
  $('blogId').value = blogId;
  for (const k of F) $(k).value = keys[k] || '';
  $('manualKeywords').value = manualKeywords;
  $('watch').firstChild.textContent = watch.length ? '사이트에서 받은 키워드 ' + watch.length + '개: ' + watch.join(', ') : '아직 사이트에서 받은 키워드가 없어요. 사이트를 한 번 열어 주세요.';
  if (lastApi) status('마지막 불러오기 ' + new Date(lastApi.at).toLocaleString('ko-KR') + ' · 쇼핑 ' + lastApi.shopping + ' · 트렌드 ' + lastApi.trends + ' · 검색량 ' + lastApi.volumes + (lastApi.errors?.length ? '\n못 불러온 것: ' + lastApi.errors.join('\n') : ''));
}
async function save() {
  const keys = Object.fromEntries(F.map(k => [k, $(k).value.trim()]));
  await chrome.storage.local.set({keys, manualKeywords: $('manualKeywords').value, blogId: $('blogId').value.trim() || 'withsuzz'});
}
$('f').addEventListener('submit', async e => { e.preventDefault(); await save(); status('저장했어요. 6시간마다 자동으로 불러와요.'); });
$('run').addEventListener('click', async () => {
  await save(); status('불러오는 중이에요… (키워드 30개면 30초쯤)');
  const r = await chrome.runtime.sendMessage({type: 'suzz-api-run'});
  if (!r?.ok) { status('불러오지 못했어요: ' + (r?.error || '알 수 없는 오류')); return; }
  status('키워드 ' + r.data.keywords + '개 · 쇼핑 ' + r.data.shopping + ' · 트렌드 ' + r.data.trends + ' · 검색량 ' + r.data.volumes + '. 사이트를 열면 저장돼요.' + (r.errors.length ? '\n못 불러온 것:\n' + r.errors.join('\n') : ''));
});
$('clear').addEventListener('click', async () => { await chrome.storage.local.remove('keys'); for (const k of F) $(k).value = ''; status('키를 지웠어요.'); });
async function autoList() {
  const {autoPages = [], lastAuto} = await chrome.storage.local.get(['autoPages', 'lastAuto']);
  const log = id => lastAuto?.log?.find(l => l.id === id);
  const el = $('auto-list'); el.textContent = '';
  if (!autoPages.length) { el.innerHTML = '<li><small>아직 등록한 화면이 없어요.</small></li>'; return; }
  for (const p of autoPages) {
    const li = document.createElement('li'), l = log(p.id), b = document.createElement('button');
    li.textContent = p.title + ' — ' + (l ? (l.ok ? '마지막 ' + new Date(l.at).toLocaleString('ko-KR') : '실패: ' + l.error) : '아직 읽기 전') + ' ';
    b.type = 'button'; b.textContent = '빼기';
    b.onclick = async () => { const {autoPages: all = []} = await chrome.storage.local.get('autoPages'); await chrome.storage.local.set({autoPages: all.filter(x => x.id !== p.id)}); autoList(); };
    li.append(b); el.append(li);
  }
}
$('auto-run').addEventListener('click', async e => {
  e.target.disabled = true; status('등록한 화면을 차례로 읽는 중이에요… (화면마다 10초쯤)');
  const r = await chrome.runtime.sendMessage({type: 'suzz-auto-run'});
  e.target.disabled = false;
  status(!r?.ok ? '읽지 못했어요: ' + (r?.error || '') : '성공 ' + r.log.filter(l => l.ok).length + ' · 실패 ' + r.log.filter(l => !l.ok).length + '. 사이트를 열면 ‘확장에서 받은 자료’에 나타나요.');
  autoList();
});
load(); autoList();
