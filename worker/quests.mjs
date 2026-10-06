// 성장 퀘스트: 하루·주간·장기 업적. 쉬는 날 페널티와 연속 출석 강요 없이, 실제 작업 기록으로만 완료를 판정한다.
// 보상은 award(key) 한 번만 지급되므로 같은 퀘스트를 두 번 받을 수 없다.
import {today,addDays,weekStart,manual} from './domain.mjs';

export const LEVEL_XP = 150;
export const STAGES = [
  {min: 1, id: 'start', title: '첫 모험', outfit: '여행 모자'},
  {min: 2, id: 'ready', title: '준비된 여행자', outfit: '작은 배낭'},
  {min: 3, id: 'camera', title: '카메라 탐험가', outfit: '필름 카메라'},
  {min: 5, id: 'editor', title: '길 위의 에디터', outfit: '여행 수첩'},
  {min: 8, id: 'guide', title: '동네방네 가이드', outfit: '길잡이 망토'},
  {min: 12, id: 'author', title: '천 명의 여행 작가', outfit: '별빛 깃펜'},
];
export function levelInfo(xp = 0) {
  const level = 1 + Math.floor(xp / LEVEL_XP), stage = [...STAGES].reverse().find(s => level >= s.min), next = STAGES.find(s => s.min > level) || null;
  return {level, xp, into: xp % LEVEL_XP, toNext: LEVEL_XP - (xp % LEVEL_XP), stage, next};
}

const day10 = v => String(v || '').slice(0, 10);
const kst = iso => (iso ? today(new Date(iso)) : '');
function published(state) { return state.items.filter(i => i.status === '게시됨'); }
function weekRange(day) { const start = weekStart(day); return {start, end: addDays(start, 6)}; }
function hashDay(day) { let h = 0; for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function bonusPool(state, day) {
  const createdToday = state.items.filter(i => kst(i.createdAt) === day);
  const tomorrowReady = state.items.filter(i => manual(i) && i.date === addDays(day, 1) && i.prep?.photos && i.prep?.outline);
  const upcoming = state.items.filter(i => manual(i) && i.date > day && i.date <= addDays(day, 7));
  const activeSponsors = state.sponsors.filter(s => s.stage !== '완료');
  return [
    {id: 'prep', title: '준비의 달인', description: '내일 글의 사진·구성을 하나 준비해요', done: tomorrowReady.length > 0, xp: 15, when: true},
    {id: 'refresh', title: '잠자는 글 깨우기', description: '예전에 발행한 글의 정보를 한 번 점검해요', done: state.rewards.some(r => r.key === 'refresh:' + day), xp: 20, when: published(state).length > 0},
    {id: 'sponsor', title: '촬영 전 한 걸음', description: '협찬 촬영 체크리스트를 정리해요', done: state.sponsors.some(s => s.preparedAt === day), xp: 20, when: activeSponsors.length > 0},
    {id: 'ideas', title: '글감 수집가', description: '새 글감을 3개 메모해요', current: createdToday.length, target: 3, done: createdToday.length >= 3, xp: 15, when: true},
    {id: 'keyword', title: '키워드 사냥꾼', description: '메인 키워드를 정한 새 글감을 하나 만들어요', done: createdToday.some(i => String(i.keyword || '').trim()), xp: 15, when: true},
    {id: 'video', title: '숏폼 한 컷', description: '짧은 영상 원본 하나를 기록하거나 손봐요', done: state.items.some(i => i.type === 'video' && kst(i.updatedAt) === day), xp: 20, when: true},
    {id: 'learn', title: '오늘의 한 페이지', description: '학습 자료실에 좋은 글이나 프롬프트를 하나 저장해요', done: state.lessons.some(l => kst(l.createdAt) === day), xp: 15, when: true},
    {id: 'plan', title: '다음 주 지도 그리기', description: '앞으로 7일 안에 발행할 글을 5개 이상 배치해요', current: upcoming.length, target: 5, done: upcoming.length >= 5, xp: 20, when: true},
  ].filter(q => q.when);
}

export function dailyQuestList(state, day = today()) {
  const target = state.settings.dailyTarget || 2;
  const blog = state.items.filter(i => manual(i) && day10(i.publishedAt) === day);
  const tomorrow = state.items.filter(i => manual(i) && i.date === addDays(day, 1) && i.prep?.photos && i.prep?.outline);
  const pool = bonusPool(state, day).filter(q => q.id !== 'prep');
  // 날짜로 고르되 같은 날에는 늘 같은 두 개가 나오도록 고정한다.
  const h = hashDay(day), first = pool[h % pool.length], second = pool.length > 1 ? pool[(h + 1 + (h >> 3) % (pool.length - 1)) % pool.length] : null;
  const bonus = [first, second && second !== first ? second : null].filter(Boolean);
  return [
    {key: 'daily-publish:' + day, kind: 'daily', title: '오늘의 여행 기록', description: '여행 글 ' + target + '개 발행하기', current: blog.length, target, done: blog.length >= target, xp: 30},
    {key: 'daily-prep:' + day, kind: 'daily', title: '내일의 나 돕기', description: '내일 글 사진·구성 준비', done: tomorrow.length > 0, xp: 15},
    ...bonus.map(q => ({key: 'bonus:' + q.id + ':' + day, kind: 'daily', title: q.title, description: q.description, current: q.current, target: q.target, done: q.done, xp: q.xp, optional: true})),
  ];
}

export function weeklyQuestList(state, day = today()) {
  const {start, end} = weekRange(day), inWeek = d => d >= start && d <= end;
  const weekPublished = state.items.filter(i => manual(i) && inWeek(day10(i.publishedAt)));
  const regions = new Set(weekPublished.map(i => i.region).filter(r => r && r !== '미분류'));
  const videos = state.items.filter(i => i.type === 'video' && inWeek(kst(i.updatedAt)) && String(i.draft || i.notes || '').trim());
  const goal = (state.settings.dailyTarget || 2) * 5, videoGoal = state.settings.weeklyVideos || 2;
  const refreshed = (state.refreshPlans || []).filter(p => inWeek(kst(p.selectedAt)));
  return [
    {key: 'weekly-publish:' + start, kind: 'weekly', title: '이번 주 여행 일지', description: '이번 주 여행 글 ' + goal + '개 발행', current: weekPublished.length, target: goal, done: weekPublished.length >= goal, xp: 60},
    {key: 'weekly-regions:' + start, kind: 'weekly', title: '세 갈래 길', description: '서로 다른 지역 3곳의 글 발행', current: regions.size, target: 3, done: regions.size >= 3, xp: 30},
    {key: 'weekly-video:' + start, kind: 'weekly', title: '숏폼 원본 모으기', description: '짧은 영상 원본 ' + videoGoal + '개 작업', current: videos.length, target: videoGoal, done: videos.length >= videoGoal, xp: 40},
    {key: 'weekly-refresh:' + start, kind: 'weekly', title: '다시 빛나는 글', description: '과거 글 재작성 기획 1개 만들기', current: refreshed.length, target: 1, done: refreshed.length >= 1, xp: 30, optional: true},
  ].map(q => ({...q, period: start + ' ~ ' + end}));
}

function visitorAverage(state) {
  // 네이버에서 확인한 연속 7일 순방문자만 쓴다. 빠진 날을 0으로 채우지 않는다.
  const rows = (state.naverStats?.visitors || []).slice(-7);
  if (rows.length < 7 || rows.some((r, n) => n && addDays(rows[n - 1].date, 1) !== r.date)) return null;
  return rows.reduce((a, r) => a + r.count, 0) / 7;
}

export function achievementList(state) {
  const pub = published(state).length, avg = visitorAverage(state);
  const activeDays = new Set(state.rewards.map(r => kst(r.at))).size;
  const sponsorsDone = state.sponsors.filter(s => ['발행', '완료'].includes(s.stage)).length;
  const regions = new Set(published(state).map(i => i.region).filter(r => r && r !== '미분류')).size;
  const list = [
    ...[[1, '첫 발자국', 50], [10, '열 번의 여행', 100], [50, '오십 개의 지도', 200], [100, '백 개의 이야기', 300], [300, '여행 백과', 500]].map(([n, title, xp]) => ({id: 'pub-' + n, title, description: '여행 글 ' + n + '개 발행', current: pub, target: n, xp})),
    ...[[5, '동네 탐험가', 60], [15, '지도 수집가', 150]].map(([n, title, xp]) => ({id: 'regions-' + n, title, description: '서로 다른 지역 ' + n + '곳 기록', current: regions, target: n, xp})),
    {id: 'sponsor-1', title: '첫 협업', description: '협찬 1건을 발행까지 진행', current: sponsorsDone, target: 1, xp: 80},
    {id: 'sponsor-10', title: '믿음직한 파트너', description: '협찬 10건 발행', current: sponsorsDone, target: 10, xp: 200},
    {id: 'lessons-10', title: '배움의 서고', description: '학습 자료 10개 저장', current: state.lessons.length, target: 10, xp: 80},
    {id: 'days-30', title: '꾸준한 발걸음', description: '경험치를 받은 날 누적 30일 (연속 아님)', current: activeDays, target: 30, xp: 150},
    ...[[650, '첫 번째 이정표', 100], [750, '꾸준한 여행자', 150], [850, '성장하는 에디터', 200], [1000, '천 명과 함께 떠나요', 500]].map(([n, title, xp]) => ({id: 'visitors-' + n, title, description: '최근 7일 평균 하루 방문자 ' + n.toLocaleString('ko-KR') + '명', current: avg === null ? null : Math.round(avg), target: n, xp, needsData: avg === null})),
  ];
  return list.map(a => ({...a, key: 'achv:' + a.id, kind: 'achievement', done: a.current !== null && a.current >= a.target}));
}

export function questBoard(state, day = today()) {
  const claimed = key => state.rewards.some(r => r.key === key);
  const mark = q => ({...q, claimed: claimed(q.key)});
  return {day, level: levelInfo(state.xp), daily: dailyQuestList(state, day).map(mark), weekly: weeklyQuestList(state, day).map(mark), achievements: achievementList(state).map(mark)};
}
export function findQuest(state, key, day = today()) {
  const b = questBoard(state, day);
  return [...b.daily, ...b.weekly, ...b.achievements].find(q => q.key === key) || null;
}
