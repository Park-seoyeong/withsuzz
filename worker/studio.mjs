// 콘텐츠 스튜디오: 블로그 글 하나 → SNS 묶음, 주제 하나 → 시리즈 기획, 상품 여러 개 → 비교 글.
// AI가 만든 문구는 '초안'으로만 저장하고, 게시는 써즈님이 각 앱에서 직접 한다. 경험·숫자·날짜를 지어내지 않도록 프롬프트에서 막는다.
const st_text = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const st_list = (v, n = 30, len = 60) => (Array.isArray(v) ? v : []).map(x => st_text(x, len)).filter(Boolean).slice(0, n);
const st_addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const st_isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));

// 채널별 기준은 앱 정책이 자주 바뀌므로 '올리기 전에 앱에서 다시 확인'을 함께 남긴다.
export const SNS_SPEC = {
  instagram: {name: '인스타그램', form: '캐러셀(사진 여러 장) 캡션', rule: '첫 줄 125자 안에 핵심 · 캡션 2,200자·해시태그 30개 한도 · 장마다 넣을 문구'},
  threads: {name: '스레드', form: '이어지는 짧은 글 묶음', rule: '한 글 500자 이내 · 질문형 첫 문장 · 링크는 마지막 글에'},
  youtube: {name: '유튜브 쇼츠', form: '세로 영상 대본', rule: '세로 9:16 · 첫 2초에 결론 · 장면별 자막 · 3분 이하'},
  tiktok: {name: '틱톡', form: '세로 영상 대본', rule: '세로 9:16 · 첫 장면에 장소/정보 · 자막 크게 · 음원 상업 이용 확인'},
  xiaohongshu: {name: '샤오홍슈', form: '노트(사진+글)', rule: '제목 20자 이내 · 중국어 본문 · 표지에 핵심 문구'},
};
export const SNS_SCHEMA = {type: 'object', additionalProperties: false, required: ['posts', 'warnings'], properties: {
  posts: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['channel', 'title', 'hook', 'body', 'slides', 'hashtags', 'cta'], properties: {
    channel: {type: 'string'}, title: {type: 'string'}, hook: {type: 'string'}, body: {type: 'string'}, slides: {type: 'array', items: {type: 'string'}}, hashtags: {type: 'array', items: {type: 'string'}}, cta: {type: 'string'},
  }}},
  warnings: {type: 'array', items: {type: 'string'}},
}};

export function snsPrompt(item, channels) {
  const spec = channels.map(c => '- ' + c + ' (' + SNS_SPEC[c].name + ', ' + SNS_SPEC[c].form + '): ' + SNS_SPEC[c].rule).join('\n');
  return {
    instructions: '너는 여행·생활 블로거 ‘써즈’의 SNS 담당 에디터다. 아래 블로그 원고를 채널별 게시물 초안으로 바꾼다.\n'
      + '- 원고에 있는 사실·경험·가격·날짜만 쓴다. 원고에 없는 경험, 숫자, 영업시간, 날짜를 지어내지 않는다. 확인이 필요한 정보는 warnings에 적는다.\n'
      + '- 채널마다 말투와 길이를 바꾼다. 블로그 문장을 그대로 복사하지 않는다.\n'
      + '- slides: 인스타그램은 사진 장마다 넣을 짧은 문구(4~8장), 쇼츠·틱톡은 장면별 자막(5~10개), 스레드는 이어지는 글 각각(2~5개). 나머지는 빈 배열.\n'
      + '- hashtags는 # 없이 단어만, 채널에 맞게(샤오홍슈는 중국어). body는 그대로 붙여넣을 수 있는 본문.\n'
      + '- 제휴 링크·협찬 글이면 cta나 body에 광고·제휴 표시 문장을 넣는다.\n'
      + '- 만들 채널(이 채널만, 순서대로):\n' + spec,
    data: '[블로그 원고]\n제목: ' + st_text(item.title, 200) + '\n키워드: ' + st_text(item.keyword, 80) + '\n지역: ' + st_text(item.region, 60) + '\n유형: ' + st_text(item.type, 20) + (item.links ? '\n링크: ' + st_text(item.links, 500) : '') + (item.provided ? '\n제공·제휴 조건: ' + st_text(item.provided, 300) : '') + '\n\n' + st_text(item.draft || item.notes, 24000),
    schema: SNS_SCHEMA,
    example: {posts: channels.map(c => ({channel: c, title: '', hook: '', body: '', slides: [], hashtags: [], cta: ''})), warnings: []},
  };
}

export function normalizeSns(r, channels) {
  const posts = [];
  for (const c of channels) {
    const p = (Array.isArray(r?.posts) ? r.posts : []).find(x => x && x.channel === c);
    if (!p || !st_text(p.body)) continue;
    posts.push({channel: c, title: st_text(p.title, 120), hook: st_text(p.hook, 300), body: st_text(p.body, 6000), slides: st_list(p.slides, 12, 400), hashtags: st_list(p.hashtags, 30, 40).map(h => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean), cta: st_text(p.cta, 300)});
  }
  return {posts, warnings: st_list(r?.warnings, 10, 300)};
}

export function snsDraft(p) {
  const label = {instagram: '장', youtube: '장면', tiktok: '장면', threads: '이어지는 글', xiaohongshu: '장'}[p.channel] || '';
  return [p.hook, p.body, p.slides.length ? p.slides.map((s, i) => '[' + label + ' ' + (i + 1) + '] ' + s).join('\n') : '', p.cta, p.hashtags.length ? p.hashtags.map(h => '#' + h).join(' ') : ''].filter(Boolean).join('\n\n');
}

// 블로그 발행일 다음 날부터 하루에 한 채널씩 배치한다(발행일이 없으면 날짜 없이).
export function snsItems(base, result) {
  return result.posts.map((p, n) => ({
    title: (p.title || base.title).slice(0, 120) + ' · ' + SNS_SPEC[p.channel].name,
    channel: p.channel, type: ['youtube', 'tiktok'].includes(p.channel) ? 'video' : 'social', status: '초안 작성',
    region: base.region || '', keyword: base.keyword || '', links: base.links || '', provided: base.provided || '',
    date: st_isDate(base.date) ? st_addDays(base.date, n + 1) : '',
    draft: snsDraft(p),
    notes: '원본 블로그: ' + base.title + '\n[' + SNS_SPEC[p.channel].name + ' 체크] ' + SNS_SPEC[p.channel].rule + '\n(길이·글자 수 기준은 올리기 전에 앱에서 다시 확인)' + (result.warnings.length ? '\n\n확인할 점:\n- ' + result.warnings.join('\n- ') : ''),
  }));
}

// ───────── 시리즈 기획: 주제 하나로 여러 편을 겹치지 않게 나눈다 ─────────
export const SERIES_SCHEMA = {type: 'object', additionalProperties: false, required: ['series', 'posts', 'warnings'], properties: {
  series: {type: 'string'},
  posts: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['title', 'keyword', 'angle', 'outline', 'type', 'needs'], properties: {
    title: {type: 'string'}, keyword: {type: 'string'}, angle: {type: 'string'}, outline: {type: 'array', items: {type: 'string'}}, type: {type: 'string'}, needs: {type: 'array', items: {type: 'string'}},
  }}},
  warnings: {type: 'array', items: {type: 'string'}},
}};
export function seriesPrompt({theme, count, goal, region, keywords = [], existing = []}) {
  return {
    instructions: '너는 여행·생활 블로그 ‘써즈의 동네방네’의 콘텐츠 기획자다. 주제 하나를 ' + count + '편의 블로그 시리즈로 나눈다.\n'
      + '- 편마다 검색 의도가 겹치지 않게 한다(정보 / 코스 / 비교 / 준비물 / 후기 / 비용 등으로 나눔). 같은 메인 키워드를 두 편에 쓰지 않는다.\n'
      + '- title은 네이버 검색에 맞게 메인 키워드를 앞쪽에 둔다. keyword는 메인 키워드 하나.\n'
      + '- outline은 소제목 4~6개. needs는 써즈님이 직접 준비해야 할 것(사진, 방문 확인, 가격 확인 등).\n'
      + '- type은 issue(빠른 정보), info(여행 정보), review(후기), affiliate(상품·제휴) 중 하나. 직접 다녀오지 않으면 쓸 수 없는 편은 review로 두고 needs에 ‘직접 방문’을 넣는다.\n'
      + '- 검색량·날짜·가격을 지어내지 않는다. 확인이 필요한 것은 warnings에 적는다.\n'
      + '- 이미 있는 글과 겹치는 편은 만들지 않는다.',
    data: '[주제] ' + st_text(theme, 200) + '\n[편수] ' + count + (goal ? '\n[목표] ' + st_text(goal, 300) : '') + (region ? '\n[지역] ' + st_text(region, 60) : '')
      + (keywords.length ? '\n[참고 키워드(검색량 확인된 것 포함)] ' + keywords.slice(0, 30).join(', ') : '')
      + (existing.length ? '\n[이미 있는 글 제목]\n- ' + existing.slice(0, 60).join('\n- ') : ''),
    schema: SERIES_SCHEMA,
    example: {series: '', posts: [{title: '', keyword: '', angle: '', outline: [''], type: 'info', needs: ['']}], warnings: []},
  };
}
export function normalizeSeries(r, count) {
  const seen = new Set();
  const posts = (Array.isArray(r?.posts) ? r.posts : []).map(p => ({
    title: st_text(p?.title, 120), keyword: st_text(p?.keyword, 60), angle: st_text(p?.angle, 200), outline: st_list(p?.outline, 8, 120), type: ['issue', 'info', 'review', 'affiliate'].includes(p?.type) ? p.type : 'info', needs: st_list(p?.needs, 6, 120),
  })).filter(p => p.title && !seen.has(p.title) && seen.add(p.title)).slice(0, count);
  return {series: st_text(r?.series, 80), posts, warnings: st_list(r?.warnings, 10, 300)};
}
// 시작일부터 간격(일)마다 한 편씩 배치한다. 간격 0이면 날짜 없이 글감으로만 둔다.
export function seriesItems(plan, {startDate = '', every = 0, region = '', channel = 'blog'} = {}) {
  const groupId = crypto.randomUUID();
  return plan.posts.map((p, n) => ({
    title: p.title, keyword: p.keyword, type: p.type, channel, region, status: '아이디어', groupId,
    date: st_isDate(startDate) && every > 0 ? st_addDays(startDate, n * every) : '',
    notes: '[시리즈] ' + (plan.series || '') + ' (' + (n + 1) + '/' + plan.posts.length + ')\n관점: ' + p.angle + '\n\n소제목\n- ' + p.outline.join('\n- ') + (p.needs.length ? '\n\n직접 준비할 것\n- ' + p.needs.join('\n- ') : ''),
    prep: {outline: p.outline.length > 0},
  }));
}

// ───────── 상품 비교 글: 담아 둔 상품 2~5개를 한 글로 ─────────
const st_won = n => (n === null || n === undefined ? '' : Math.round(n).toLocaleString('ko-KR') + '원');
export function compareDraftItem(products, keyword) {
  const list = products.slice(0, 5), kw = st_text(keyword || list[0]?.keyword, 60);
  const rows = list.map((p, i) => (i + 1) + '. ' + p.name + (p.brand ? ' (' + p.brand + ')' : '') + ' — ' + [p.price !== null && p.price !== undefined ? '가격 ' + st_won(p.price) : '', p.rating !== null && p.rating !== undefined ? '평점 ' + p.rating : '', p.reviews !== null && p.reviews !== undefined ? '리뷰 ' + p.reviews.toLocaleString('ko-KR') + '개' : '', p.commissionAmount !== null && p.commissionAmount !== undefined ? '(내 수수료 ' + st_won(p.commissionAmount) + ', 글에는 쓰지 않음)' : ''].filter(Boolean).join(' · ') + (p.url ? '\n   링크: ' + p.url : ''));
  return {
    title: kw + ' 추천 비교 · ' + list.length + '가지 고르는 기준', type: 'affiliate', channel: 'blog', keyword: kw, status: '아이디어',
    links: list.map(p => p.url).filter(Boolean).join('\n'), provided: '제휴 링크(구매 시 수수료를 받을 수 있음)',
    notes: '[비교 글] 담아 둔 상품 ' + list.length + '개 (' + (list[0]?.capturedAt || '').slice(0, 10) + ' 화면 기준, 발행 전 가격 다시 확인)\n' + rows.join('\n')
      + '\n\n쓰는 방법: 고르는 기준 3가지 → 상품별 장단점 표 → 이런 분께 추천 → 제휴 고지.\n써 보지 않은 상품은 사용 후기처럼 쓰지 않는다. 확인된 정보·선택 기준 중심으로 쓴다.',
  };
}
