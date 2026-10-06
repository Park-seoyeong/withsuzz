// 자동 작업 두 가지:
// 1) 네이버 API: 6시간마다 써즈님 키로 공식 API를 부른다(naver-api.js).
// 2) 자동 수집: 등록한 화면을 하루 두 번(9시·21시 무렵) 뒤쪽 탭으로 열어 읽는다(autopages.js).
// 결과는 보관함(queue)에 넣고, 사이트를 열면 deliver.js가 넘겨 준다.
import {collect, cleanKeywords} from './naver-api.js';
import {runAutoPages} from './autopages.js';
const ALARM = 'suzz-naver-api', EVERY = 360, AUTO = 'suzz-auto-pages';

async function run(reason) {
  const {keys = {}, watch = [], manualKeywords = '', queue = []} = await chrome.storage.local.get(['keys', 'watch', 'manualKeywords', 'queue']);
  const list = cleanKeywords([...String(manualKeywords).split(/[\n,]/), ...watch]);
  const item = await collect(list, keys);
  item.reason = reason;
  const rest = queue.filter(i => i.kind !== 'api');
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
  if (a.name === AUTO) runAutoPages('자동').catch(() => {});
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'suzz-api-run') { run('직접').then(i => reply({ok: true, errors: i.errors, data: {keywords: i.data.keywords.length, shopping: i.data.shopping.length, trends: i.data.trends.length, volumes: i.data.volumes.length}})).catch(e => reply({ok: false, error: e.message})); return true; }
  if (msg?.type === 'suzz-auto-run') { runAutoPages('직접').then(log => reply({ok: true, log})).catch(e => reply({ok: false, error: e.message})); return true; }
});
