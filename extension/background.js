// 네이버 API 자동 불러오기: 6시간마다(그리고 설정·팝업에서 누를 때) 써즈님 키로 공식 API를 부르고,
// 결과를 보관함(queue)에 넣는다. 사이트를 열면 deliver.js가 넘겨 준다. API 결과는 가장 최근 것 하나만 남긴다.
import {collect, cleanKeywords} from './naver-api.js';
const ALARM = 'suzz-naver-api', EVERY = 360;

async function run(reason) {
  const {keys = {}, watch = [], manualKeywords = '', queue = []} = await chrome.storage.local.get(['keys', 'watch', 'manualKeywords', 'queue']);
  const list = cleanKeywords([...String(manualKeywords).split(/[\n,]/), ...watch]);
  const item = await collect(list, keys);
  item.reason = reason;
  const rest = queue.filter(i => i.kind !== 'api');
  await chrome.storage.local.set({queue: [...rest, item].slice(-20), lastApi: {at: item.capturedAt, keywords: item.data.keywords.length, shopping: item.data.shopping.length, trends: item.data.trends.length, volumes: item.data.volumes.length, errors: item.errors}});
  return item;
}

function schedule() { chrome.alarms.create(ALARM, {delayInMinutes: 1, periodInMinutes: EVERY}); }
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) run('자동').catch(() => {}); });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'suzz-api-run') { run('직접').then(i => reply({ok: true, errors: i.errors, data: {keywords: i.data.keywords.length, shopping: i.data.shopping.length, trends: i.data.trends.length, volumes: i.data.volumes.length}})).catch(e => reply({ok: false, error: e.message})); return true; }
});
