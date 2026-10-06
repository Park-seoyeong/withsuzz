// Provider observations and editorial priorities are different measures.
export const TREND_REFRESH_MS=15*60*1000;
export const TREND_FEEDS=[
 {id:'google-trends-kr',name:'Google 급상승 검색 · 한국',kind:'search',url:'https://trends.google.com/trending/rss?geo=KR'},
 {id:'google-news-travel',name:'Google 뉴스 · 여행·축제·항공',kind:'news',url:'https://news.google.com/rss/search?q=%EC%97%AC%ED%96%89+OR+%EC%B6%95%EC%A0%9C+OR+%ED%95%AD%EA%B3%B5+when:1d&hl=ko&gl=KR&ceid=KR:ko'},
 {id:'bing-news-travel',name:'Bing 뉴스 · 여행',kind:'news',url:'https://www.bing.com/news/search?q=%EC%97%AC%ED%96%89&format=rss&mkt=ko-KR'}
];
const trendPlaces=['상하이','베이징','대련','칭다오','장가계','홍콩','마카오','타이베이','후쿠오카','오비히로','도쿠시마','하코네','도쿄','오사카','교토','삿포로','다낭','하노이','방콕','치앙마이','푸켓','싱가포르','발리','몽골','일본','중국','대만','베트남','태국','스위스','제주','부산','여수','양구','서울','인천','김포','강릉','속초','양양','춘천','평창','포천','문경','구미','양산','수원','대구','대전','광주','전주','경주','울산','한탄강','한강','경기도','강원도','충청도','경상도','전라도'];
const trendCompact=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const trendError=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
function trendDecode(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,key)=>{const values={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(key[0]!=='#')return values[key.toLowerCase()]||'';const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}).trim();}
function trendXMLField(xml,name){const match=xml.match(new RegExp('<(?:[\\w.-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'>','i'));return trendDecode(match?.[1]||'');}
function trendSafeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function trendTrafficLowerBound(label){const m=String(label||'').replaceAll(',','').match(/^(\d+(?:\.\d+)?)\s*([KMB]?)\+?$/i);if(!m)return null;const n=Number(m[1])*({K:1000,M:1000000,B:1000000000}[m[2].toUpperCase()]||1);return Number.isFinite(n)&&n>=0?n:null;}
export function parseTrendFeed(xml,feed,checkedAt){
 if(typeof xml!=='string'||xml.length>1500000||!/<rss[\s>]/i.test(xml))trendError('RSS 자료 형식을 확인할 수 없어요.');
 const now=Date.parse(checkedAt),rows=[];
 for(const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){
  const title=trendXMLField(m[1],'title').slice(0,240),published=Date.parse(trendXMLField(m[1],'pubDate'));
  if(!title||!Number.isFinite(published)||published>now+300000||now-published>48*3600000)continue;
  const keyword=feed.kind==='search'?title:null,trafficLabel=feed.kind==='search'?trendXMLField(m[1],'approx_traffic').slice(0,50):null;
  const rawLink=trendXMLField(m[1],'link');let link=trendSafeUrl(rawLink);
  if(feed.id==='bing-news-travel'){try{const wrapper=new URL(rawLink);if(wrapper.hostname==='www.bing.com')link=trendSafeUrl(wrapper.searchParams.get('url'))||link;}catch{}}
  link=link||feed.url;
  rows.push({title,keyword,url:link,publisher:trendXMLField(m[1],'source').slice(0,100),publishedAt:new Date(published).toISOString(),sourceId:feed.id,sourceKind:feed.kind,sourceCheckedAt:checkedAt,trafficLabel,trafficLowerBound:trendTrafficLowerBound(trafficLabel)});
  if(rows.length>=120)break;
 }
 return rows;
}
export function trendCacheFresh(state,now=new Date().toISOString()){if(TREND_FEEDS.some(f=>!state.trendSnapshot?.sources?.some(s=>s.id===f.id)))return false;const age=Date.parse(now)-Date.parse(state.trendSnapshot?.lastAttemptAt);return Number.isFinite(age)&&age>=0&&age<TREND_REFRESH_MS;}
async function trendResponseText(response){
 if(!response.ok)throw new Error('피드 응답 '+response.status);
 if(Number(response.headers.get('Content-Length'))>1500000)throw new Error('피드 크기 초과');
 const reader=response.body?.getReader();if(!reader)throw new Error('피드 본문 없음');
 const decoder=new TextDecoder(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1500000)throw new Error('피드 크기 초과');parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());return parts.join('');}finally{await reader.cancel().catch(()=>{});}
}
export async function fetchTrendSnapshot(previous={},now=new Date().toISOString(),fetcher=fetch){
 const sources=await Promise.all(TREND_FEEDS.map(async feed=>{
  const old=previous.sources?.find(s=>s.id===feed.id);
  try{const response=await fetcher(feed.url,{headers:{Accept:'application/rss+xml, application/xml, text/xml','User-Agent':'SuzzManager/1.0'},signal:AbortSignal.timeout(12000)}),rows=parseTrendFeed(await trendResponseText(response),feed,now);return {...feed,status:'연결됨',checkedAt:now,lastAttemptAt:now,error:null,rows};}
  catch(e){const failureType=['AbortError','TimeoutError'].includes(e?.name)?'timeout':/^피드 응답 \d{3}$/.test(e?.message)?e.message:/RSS/.test(e?.message)?'invalid-rss':/크기 초과/.test(e?.message)?'size-limit':'network';return {...feed,status:'확인 필요',failureType,checkedAt:old?.checkedAt||null,lastAttemptAt:now,error:'현재 피드를 가져오지 못했어요. 마지막 성공 자료가 있으면 함께 보여드려요.',rows:old?.rows||[]};}
 }));
 return {lastAttemptAt:now,sources};
}
function trendRegion(text){return trendPlaces.find(p=>String(text).includes(p))||'미분류';}
function trendScope(text){if(/여행|관광|축제|페스티벌|항공|공항|항공권|호텔|숙소|료칸|면세|입국|출국|비자|기차|교통패스|날씨|옷차림|단풍|벚꽃|eSIM|이심|해외|국내선|맛집/i.test(text))return 'travel';if(/쇼핑|세일|할인|쇼핑몰|가방|캐리어|보조배터리|운동화|제품|이어폰/.test(text))return 'shopping';return 'other';}
function trendNewsKeyword(row){
 const title=row.title.replace(/\s+-\s+[^-]+$/,'').replace(/\[[^\]]*\]/g,'').trim(),region=trendRegion(title);
 const festival=title.match(/[가-힣A-Za-z0-9]{2,18}(?:축제|페스티벌|박람회)/)?.[0];
 const topic=festival||title.match(/한글날|추석|연휴|단풍|벚꽃|항공권|면세|입국|출국|비자|날씨|옷차림|호텔|숙소|맛집|교통패스|축제|쇼핑|항공|여행/)?.[0];
 if(region!=='미분류'&&topic)return region+(topic.startsWith(region)?'': ' ')+ (topic.startsWith(region)?topic.slice(region.length):topic);
 if(topic&&/한글날|추석|연휴/.test(topic))return topic+' 여행';
 return title.slice(0,80);
}
function trendMatch(text,keyword){const a=trendCompact(text),b=trendCompact(keyword);return b.length>=2&&a.includes(b);}
export function trendRecommendations(state,now=new Date().toISOString(),limit=40){
 const time=Date.parse(now),snapshot=state.trendSnapshot||{},candidates=new Map(),sources=snapshot.sources||[],day=new Date(time+9*3600000).toISOString().slice(0,10);
 for(const source of sources)for(const row of source.rows||[]){
  const age=time-Date.parse(row.publishedAt),observedAge=time-Date.parse(row.sourceCheckedAt);
  if(!Number.isFinite(age)||age< -300000||age>48*3600000||!Number.isFinite(observedAge)||observedAge<0)continue;
  const keyword=row.keyword||trendNewsKeyword(row),key=trendCompact(keyword);if(!key)continue;
  let c=candidates.get(key);if(!c){c={id:'trend:'+encodeURIComponent(key),keyword,title:keyword,region:trendRegion(keyword),scope:trendScope(keyword+' '+row.title),search:null,evidence:[],newsMentions:0};candidates.set(key,c);}
  if(c.evidence.some(e=>e.url===row.url&&e.title===row.title))continue;
  c.evidence.push({...row});if(row.sourceKind==='news')c.newsMentions++;
  if(row.sourceKind==='search'&&(!c.search||Date.parse(row.publishedAt)>Date.parse(c.search.publishedAt)))c.search={label:row.trafficLabel,lowerBound:row.trafficLowerBound,publishedAt:row.publishedAt,checkedAt:row.sourceCheckedAt};
 }
 // Only exact normalized keyword anchors connect observed blog traffic to a candidate.
 const stats=state.naverStats,statsAge=time-Date.parse(stats?.observedAt),keywordAge=time-Date.parse(stats?.keywordDate+'T00:00:00+09:00'),incoming=Number.isFinite(statsAge)&&statsAge>=0&&statsAge<=7*86400000&&Number.isFinite(keywordAge)&&keywordAge>=0&&keywordAge<=7*86400000?stats.keywords||[]:[];
 const items=state.items||[],rows=[...candidates.values()].map(c=>{
  const newest=Math.max(...c.evidence.map(e=>Date.parse(e.publishedAt))),hours=Math.max(0,(time-newest)/3600000),stale=c.evidence.every(e=>time-Date.parse(e.sourceCheckedAt)>3600000);
  const blog=incoming.filter(k=>trendMatch(k.keyword,c.keyword)&&typeof k.percentage==='number'&&k.percentage>0&&k.percentage<=100).sort((a,b)=>b.percentage-a.percentage)[0]||null;
  const related=items.filter(i=>i.channel==='blog'&&!i.automatic&&!['예약됨','게시됨'].includes(i.status)&&!i.date&&trendMatch([i.title,i.keyword].join(' '),c.keyword));
  const recent=items.filter(i=>i.channel==='blog'&&i.status==='게시됨'&&trendMatch([i.title,i.keyword].join(' '),c.keyword)&&time-Date.parse(i.publishedAt||i.date)>=0&&time-Date.parse(i.publishedAt||i.date)<14*86400000);
  const sameRegion=c.region!=='미분류'&&items.some(i=>i.channel==='blog'&&i.date===day&&i.region===c.region);
  const parts={freshness:hours<=6?15:hours<=24?10:5,searchSignal:c.search?.lowerBound>0?Math.min(35,Math.round(Math.log10(1+c.search.lowerBound)*7)):0,newsSignal:Math.min(15,c.newsMentions*3),blogSignal:blog?15:0,fit:c.scope==='travel'?15:c.scope==='shopping'?10:0,ready:related.some(i=>i.prep?.photos&&i.prep?.outline)?5:0,overlapPenalty:recent.length?20:0,regionPenalty:sameRegion?10:0,stalePenalty:stale?20:0};
  const score=Math.max(0,Math.min(100,parts.freshness+parts.searchSignal+parts.newsSignal+parts.blogSignal+parts.fit+parts.ready-parts.overlapPenalty-parts.regionPenalty-parts.stalePenalty));
  const reasons=[hours<=24?'24시간 안에 나온 자료가 있어요.':'최근 48시간 자료를 참고해요.'];if(c.search?.label)reasons.push('Google 급상승 피드에 실제 등장했어요.');if(c.newsMentions)reasons.push('가져온 뉴스 표본에서 '+c.newsMentions+'건을 확인했어요.');if(blog)reasons.push('내 블로그 유입 검색어와 연결돼요.');if(related.length)reasons.push('보관함에 이어서 쓸 수 있는 글감이 있어요.');
  const cautions=[];if(!c.search)cautions.push('뉴스 기반 글감이에요. 검색량·급상승 지수는 확인되지 않았어요.');if(stale)cautions.push('마지막 수집 후 1시간이 지났어요. 최신 자료를 확인해 주세요.');if(recent.length)cautions.push('최근 14일 안에 비슷한 소재를 발행했어요.');if(sameRegion)cautions.push('오늘 예정된 글과 지역이 같아요.');
  return {...c,evidence:c.evidence.slice(0,5),score,scoreParts:parts,stale,reasons,cautions,blogKeyword:blog,relatedItems:related.slice(0,3).map(i=>({id:i.id,title:i.title})),latestPublishedAt:new Date(newest).toISOString()};
 }).sort((a,b)=>b.score-a.score||b.latestPublishedAt.localeCompare(a.latestPublishedAt)||a.keyword.localeCompare(b.keyword)).slice(0,limit);
 return {lastAttemptAt:snapshot.lastAttemptAt||null,cacheMinutes:15,rows,sources:sources.map(({rows,...s})=>({...s,count:rows?.length||0})),warnings:sources.filter(s=>s.error).map(s=>s.name+': '+s.error),providers:[{name:'Google 급상승 검색',connected:sources.some(s=>s.id==='google-trends-kr'&&s.checkedAt),measure:'피드 표시 검색량 · 근사치 · 집계 기간 미표기'},{name:'Google 뉴스',connected:sources.some(s=>s.id==='google-news-travel'&&s.checkedAt),measure:'가져온 기사 표본 · 검색량 아님'},{name:'Bing 뉴스',connected:sources.some(s=>s.id==='bing-news-travel'&&s.checkedAt),measure:'가져온 기사 표본 · 검색량 아님'},{name:'네이버 데이터랩·다음',connected:false,measure:'공식 지수 연동 전'}],notice:'0~100점은 최신성·내 블로그 적합도 등을 합친 편집 우선순위입니다. 검색량·검색 순위·조회수 예측 지수가 아닙니다.'};
}
export function chooseTrendRecommendation(state,input,makeContent,now=new Date().toISOString()){
 if(!state.trendSnapshot?.lastAttemptAt||input.snapshotAt!==state.trendSnapshot.lastAttemptAt)trendError('트렌드 자료가 갱신됐어요. 새 추천을 확인해 주세요.',409);
 const row=trendRecommendations(state,now,200).rows.find(r=>r.id===input.id);if(!row)trendError('자료의 유효 시간이 지났어요. 최신 키워드를 확인해 주세요.',409);
 const previous=state.items.find(i=>i.trendSource?.id===row.id&&i.trendSource?.snapshotAt===input.snapshotAt);if(previous)return {item:previous,duplicate:true};
 const item=row.relatedItems.length?state.items.find(i=>i.id===row.relatedItems[0].id):makeContent({title:row.title,keyword:row.keyword,region:row.region,channel:'blog',type:row.scope==='shopping'?'affiliate':'issue',date:'',notes:'최신 외부 자료를 참고한 기획입니다. 기사 속 경험을 내 경험처럼 쓰지 말고, 일정·가격·참여 조건은 공식 자료로 확인해 주세요.',links:row.evidence.map(e=>e.url).join('\n')});
 item.trendSource={id:row.id,snapshotAt:input.snapshotAt,selectedAt:now,keyword:row.keyword,score:row.score,scoreParts:row.scoreParts,evidence:row.evidence,search:row.search,newsMentions:row.newsMentions,blogKeyword:row.blogKeyword};
 if(!row.relatedItems.length)state.items.unshift(item);return {item,duplicate:false};
}
