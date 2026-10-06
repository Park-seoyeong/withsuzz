// Blog incoming keywords are observations, not global search volumes or post attribution.
const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const tokens = value => String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const intent = value => /날씨|옷차림|기온|강수/.test(value) ? 'weather' : /숙소|호텔|료칸|객실/.test(value) ? 'stay' : /교통|이동|공항|패스|기차/.test(value) ? 'transport' : /맛집|카페|메뉴/.test(value) ? 'food' : '';
const month = value => Number(String(value).match(/(?:^|\D)(1[0-2]|[1-9])월/)?.[1]) || null;
const dateAge = (date, day) => Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / 86400000);
const dateOf = item => String(item.publishedAt || item.date || '').slice(0, 10);
const generic = new Set(['중국','일본','여행','정보','후기','추천','방법','가격','예약','방문','날씨','옷차림','호텔','숙소','료칸','교통','맛집','카페','가이드']);

function relevance(item, query) {
  const text = [item.title, item.keyword].filter(Boolean).join(' '), a = compact(text), b = compact(query);
  if (!a || !b) return 0;
  const queryMonth = month(query), itemMonth = month(text);
  if (queryMonth && itemMonth && queryMonth !== itemMonth) return 0;
  const queryIntent = intent(query), itemIntent = intent(text);
  if (queryIntent && queryIntent !== itemIntent) return 0;
  if (a.includes(b) || b.includes(compact(item.keyword || item.title))) return 1;
  const anchors = tokens(query).filter(t => t.length > 1 && !generic.has(t) && !/^\d+월/.test(t));
  const anchorMatches = anchors.filter(t => a.includes(compact(t))).length;
  // A matching country, category or month alone cannot link a query to a post.
  if (!anchorMatches) return 0;
  return .5 + Math.min(.3, anchorMatches * .1) + (queryIntent ? .1 : 0);
}

export function keywordRecommendations(state, day, limit = 24) {
  const snapshot = state.naverStats, items = state.items || [];
  const ageDays = snapshot?.keywordDate ? dateAge(snapshot.keywordDate, day) : null;
  const output = {keywordDate:snapshot?.keywordDate || null, observedAt:snapshot?.observedAt || null, runUrl:snapshot?.runUrl || null, ageDays, stale:ageDays !== null && ageDays > 7, existing:[], ideas:[], warnings:[]};
  if (!snapshot || !Number.isFinite(ageDays) || ageDays < 0) {
    output.warnings.push(snapshot ? '검색어 날짜를 확인해야 추천할 수 있어요.' : '네이버 유입 검색어가 저장되면 추천을 시작해요.');
    return output;
  }
  if (output.stale) output.warnings.push('7일이 지난 검색어 자료예요. 최신 통계를 확인한 뒤 발행일을 정해 주세요.');
  const queries = new Map();
  for (const row of snapshot.keywords || []) {
    if (!row?.keyword || typeof row.percentage !== 'number' || !Number.isFinite(row.percentage) || row.percentage <= 0 || row.percentage > 100) continue;
    const key = compact(row.keyword);
    if (!queries.has(key) || queries.get(key).percentage < row.percentage) queries.set(key, {keyword:row.keyword, percentage:row.percentage});
  }
  const keywords = [...queries.values()].sort((a,b) => b.percentage-a.percentage || a.keyword.localeCompare(b.keyword));
  const recent = items.filter(i => i.channel === 'blog' && i.status === '게시됨' && Number.isFinite(dateAge(dateOf(i), day)) && dateAge(dateOf(i), day) >= 0 && dateAge(dateOf(i), day) < 14);
  const regions = new Set(items.filter(i => i.channel === 'blog' && i.date === day).map(i => i.region).filter(r => r && r !== '미분류'));
  const eligible = items.filter(i => i.channel === 'blog' && !i.automatic && !['예약됨','게시됨'].includes(i.status) && !i.date);
  for (const item of eligible) {
    const evidence = keywords.map(k => ({...k, match:relevance(item, k.keyword)})).filter(k => k.match).sort((a,b) => b.match-a.match || b.percentage-a.percentage);
    if (!evidence.length) continue;
    const reasons = ['저장된 유입 검색어와 제목·소재가 맞아요.'], cautions = [];
    const overlapping = recent.filter(i => evidence.some(k => relevance(i,k.keyword) >= .7));
    if (overlapping.length) cautions.push('최근 14일 안에 비슷한 소재를 발행했어요. 차별점을 먼저 정해 주세요.');
    if (regions.has(item.region)) cautions.push('오늘 예정된 글과 지역이 같아요. 다른 날짜를 검토해 주세요.');
    if (item.embargo && item.embargo.slice(0,10) > day) cautions.push('엠바고 해제 후 발행해야 해요.');
    if (item.deadline) reasons.push('협찬 마감 ' + item.deadline + '을 함께 확인해 주세요.');
    if (item.status === '초안 작성') reasons.push('작성 중인 초안을 이어갈 수 있어요.');
    if (item.prep?.photos && item.prep?.outline) reasons.push('사진·구성이 준비됐어요.');
    const qMonth = month(evidence[0].keyword);
    if (qMonth && qMonth !== Number(day.slice(5,7))) cautions.push('다른 월의 검색어예요. 여행 준비 시기와 정보 적용일을 확인해 주세요.');
    const profileAge = state.recommendationProfile?.at ? dateAge(state.recommendationProfile.at.slice(0,10),day) : null;
    const learnedBoost = Number.isFinite(profileAge) && profileAge >= 0 && profileAge <= 35 ? Math.min(4,Math.max(0,Number(state.recommendationProfile.topicBoost?.[item.topic])||0)) : 0;
    if(learnedBoost)reasons.push('주간 검토에서 같은 소재의 실제 글별 성과를 참고했어요.');
    const score = evidence[0].match * 40 + Math.min(20,evidence[0].percentage*5) + (item.priority === '높음' ? 12 : 0) + (item.prep?.photos && item.prep?.outline ? 8 : 0) + learnedBoost - overlapping.length*10 - (regions.has(item.region) ? 15 : 0);
    output.existing.push({id:'existing:'+item.id,itemId:item.id,kind:'existing',title:item.title,region:item.region,topic:item.topic,type:item.type,evidence:evidence.slice(0,3).map(({match,...k})=>k),reasons,cautions,score});
  }
  output.existing.sort((a,b) => b.score-a.score || a.title.localeCompare(b.title));
  // Spread the visible choices across regions, keeping every matching draft accessible.
  const ordered = [], remaining = [...output.existing];
  while (remaining.length) {
    let index = remaining.findIndex(r => r.region && r.region !== '미분류' && r.region !== ordered.at(-1)?.region);
    if (index < 0) index = 0;
    ordered.push(...remaining.splice(index,1));
  }
  output.existing = ordered.slice(0, limit);
  const covered = [];
  for (const k of keywords) {
    if (eligible.some(i => relevance(i,k.keyword)) || items.some(i => i.channel === 'blog' && i.status !== '게시됨' && relevance(i,k.keyword) >= .7)) continue;
    if (covered.some(q => relevance({title:q},k.keyword) >= .7)) continue;
    covered.push(k.keyword);
    const published = items.filter(i => i.channel === 'blog' && i.status === '게시됨' && relevance(i,k.keyword) >= .7);
    const cautions = [];
    if (published.length) cautions.push('관련 게시글이 있어요. 새 글을 쓰기 전에 기존 글의 최신 정보와 차별점을 확인해 주세요.');
    if (published.some(i => recent.includes(i))) cautions.push('최근 14일 안에 비슷한 소재를 발행했어요.');
    if (month(k.keyword) && month(k.keyword) !== Number(day.slice(5,7))) cautions.push('다른 월의 검색어예요. 정보 적용 시기를 확인해 주세요.');
    output.ideas.push({id:'idea:'+compact(k.keyword),kind:'idea',title:k.keyword+(intent(k.keyword)==='stay'?' 예약 전 비교할 기준':' 여행 전 확인할 정보'),keyword:k.keyword,type:'info',evidence:[k],reasons:['실제 유입이 있지만 날짜 미정 보관함에 맞는 글감이 없어요.'],cautions,relatedPublished:published.slice(0,3).map(i=>({id:i.id,title:i.title}))});
  }
  output.ideas = output.ideas.slice(0,12);
  return output;
}

export function recommendationBasis(row, recommendations, at) {
  return {id:row.id,keywordDate:recommendations.keywordDate,keywords:row.evidence.map(k=>({...k})),runUrl:recommendations.runUrl,selectedAt:at};
}
