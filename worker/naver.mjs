// Imported observations are deliberately separate from post-level metrics.
export function normalizeNaver(input) {
  const invalid = () => { const e = new Error('네이버 통계 형식·날짜·수치를 확인해 주세요.'); e.status = 400; throw e; };
  const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
  const count = x => Number.isSafeInteger(x) && x >= 0;
  const share = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
  if (!input || input.blogId !== 'withsuzz' || typeof input.observedAt !== 'string' || Number.isNaN(Date.parse(input.observedAt)) || !Array.isArray(input.visitors) || !input.visitors.length || input.visitors.length > 366 || !Array.isArray(input.keywords) || input.keywords.length > 100 || !date(input.keywordDate)) invalid();
  const seen = new Set();
  const visitors = input.visitors.map(r => { if (!r || !date(r.date) || !count(r.count) || seen.has(r.date)) invalid(); seen.add(r.date); return {date:r.date,count:r.count}; }).sort((a,b)=>a.date.localeCompare(b.date));
  const keywords = input.keywords.map(r => { if (!r || typeof r.keyword !== 'string' || !r.keyword.trim() || r.keyword.length > 200 || !share(r.percentage)) invalid(); return {keyword:r.keyword.trim(),percentage:r.percentage}; });
  const pageViews = input.pageViews == null ? null : input.pageViews;
  if (pageViews && (!date(pageViews.date) || !count(pageViews.count))) invalid();
  if (!/^https:\/\/agent\.tinyfish\.ai\/runs\/[a-f0-9-]{36}$/.test(input.runUrl || '')) invalid();
  return {blogId:'withsuzz',observedAt:new Date(input.observedAt).toISOString(),runUrl:input.runUrl,visitors,keywords,keywordDate:input.keywordDate,pageViews:pageViews ? {date:pageViews.date,count:pageViews.count} : null,source:'TinyFish 조회 결과 가져오기',visitorUrl:'https://admin.blog.naver.com/withsuzz/stat/uv',keywordUrl:'https://admin.blog.naver.com/withsuzz/stat/source'};
}
