import {metricDate,ownedMetricPostUrl,importMetricRows} from './metrics.mjs';
const postStatsError=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const postStatsDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function postStatsSource(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='admin.blog.naver.com'&&/^\/withsuzz\/stat(?:\/|$)/.test(u.pathname)||u.hostname==='blog.stat.naver.com'&&/^\/blog\/article\/[1-9]\d*\/cv$/.test(u.pathname))?u.href:'';}catch{return '';}}
export function normalizeNaverPosts(input,day,now=new Date()){
 const invalid=()=>postStatsError('네이버 글별 일별 통계의 날짜·출처·수치를 확인해 주세요.');
 if(!input||input.blogId!=='withsuzz'||input.authenticated!==true||input.grain!=='day'||!postStatsSource(input.sourceUrl)||typeof input.metricDefinition!=='string'||!input.metricDefinition.trim()||input.metricDefinition.length>2000||!/^https:\/\/agent\.tinyfish\.ai\/runs\/[a-f0-9-]{36}$/.test(input.runUrl||'')||typeof input.observedAt!=='string'||!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>now.getTime()+300000||!Array.isArray(input.posts)||!input.posts.length||input.posts.length>30)invalid();
 const observedDay=postStatsDay(input.observedAt),seenPosts=new Set();let count=0;
 const posts=input.posts.map(p=>{
  const url=ownedMetricPostUrl(p?.url);if(!url||seenPosts.has(url)||typeof p.title!=='string'||!p.title.trim()||p.title.length>200||!Array.isArray(p.rows)||!p.rows.length)invalid();seenPosts.add(url);
  const publishedDate=p.publishedDate||null;if(publishedDate&&(!metricDate(publishedDate)||publishedDate>day))invalid();
  const seenDays=new Set(),rows=p.rows.map(row=>{
   if(!row||!metricDate(row.date)||row.date>=day||row.date>=observedDay||publishedDate&&row.date<publishedDate||seenDays.has(row.date))invalid();seenDays.add(row.date);
   const clean={date:row.date};let fields=0;for(const key of ['visits','views','searchClicks'])if(Object.hasOwn(row,key)&&row[key]!=null){if(!Number.isSafeInteger(row[key])||row[key]<0)invalid();clean[key]=row[key];fields++;}if(!fields)invalid();if(++count>1500)invalid();return clean;
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const postId=url.split('/').at(-1);let sourceUrl=null;if(p.sourceUrl){try{const u=new URL(p.sourceUrl);if(u.protocol!=='https:'||u.hostname!=='blog.stat.naver.com'||u.username||u.password||u.port||u.pathname!=='/blog/article/'+postId+'/cv')invalid();sourceUrl=u.href;}catch{invalid();}}
  return {postId,url,title:p.title.trim(),publishedDate,sourceUrl,rows};
 });
 const sourceId=new URL(input.sourceUrl).hostname==='blog.stat.naver.com'?new URL(input.sourceUrl).pathname.split('/')[3]:null;if(sourceId&&!posts.some(p=>p.postId===sourceId))invalid();
 return {blogId:'withsuzz',authenticated:true,grain:'day',observedAt:new Date(input.observedAt).toISOString(),runUrl:input.runUrl,sourceUrl:postStatsSource(input.sourceUrl),metricDefinition:input.metricDefinition.trim(),posts,limitations:(Array.isArray(input.limitations)?input.limitations:[]).filter(s=>typeof s==='string').slice(0,10).map(s=>s.slice(0,500))};
}
export function saveNaverPosts(state,snapshot,createContent,channels,at=new Date().toISOString()){
 if((state.naverPostStats?.runUrls||[]).includes(snapshot.runUrl))return {saved:false,duplicate:true};
 if(state.naverPostStats?.observedAt&&snapshot.observedAt<state.naverPostStats.observedAt)postStatsError('더 오래된 글별 조회 결과로 덮어쓸 수 없어요.',409);
 const catalog=state.naverPostCatalog||[],rows=[],warnings=[];let created=0,linked=0;
 for(const post of snapshot.posts){
  const matches=state.items.filter(i=>i.channel==='blog'&&(ownedMetricPostUrl(i.url)===post.url||ownedMetricPostUrl(i.sourceUrl)===post.url));
  let item=matches.length===1?matches[0]:null;
  const old=catalog.find(p=>p.url===post.url),dates=post.rows.map(r=>r.date),firstObservedDate=[old?.firstObservedDate,...dates].filter(Boolean).sort()[0],firstPositiveDate=[old?.firstPositiveDate,...post.rows.filter(r=>['views','visits','searchClicks'].some(k=>r[k]>0)).map(r=>r.date)].filter(Boolean).sort()[0]||null;
  if(matches.length>1)warnings.push(post.title+' — 같은 원본 링크가 여러 글감에 있어 자동 연결을 보류했어요.');
  else if(!item){
   item=createContent({title:post.title,url:post.url,channel:'blog',type:'info',status:'게시됨',date:post.publishedDate||'',draft:'',locked:true,notes:'네이버 글별 통계에서 확인한 기존 게시글 기록입니다. 원문이나 실제 경험을 읽었다고 가정하지 않습니다.'});
   if(post.publishedDate)item.publishedAt=post.publishedDate;else delete item.publishedAt;
   item.publishedDatePrecision=post.publishedDate?'day':'unknown';item.naverObservedPublished=true;item.firstObservedDate=firstPositiveDate||undefined;item.sourceId='naver-post:'+post.postId;state.items.push(item);created++;
  }
  if(item)linked++;
  const record={...old,postId:post.postId,url:post.url,title:post.title,publishedDate:post.publishedDate||old?.publishedDate||null,itemId:item?.id||null,firstObservedDate,firstPositiveDate,lastObservedDate:[old?.lastObservedDate,...dates].filter(Boolean).sort().at(-1),observedAt:snapshot.observedAt,runUrl:snapshot.runUrl,sourceUrl:post.sourceUrl||snapshot.sourceUrl};
  if(old)catalog[catalog.indexOf(old)]=record;else catalog.push(record);
  // Preserve existing drafts, publication status, dates and XP. Only imported
  // archive records may acquire a better observed publication date.
  if(item?.naverObservedPublished){item.firstObservedDate=firstPositiveDate||undefined;if(post.publishedDate&&item.publishedDatePrecision==='unknown'){item.publishedAt=post.publishedDate;item.publishedDatePrecision='day';}}
  if(!item)continue;
  for(const row of post.rows)rows.push({...row,title:post.title,url:post.url,itemId:item?.id||'',channel:'blog',source:'naver-post-daily',grain:'day',sourceUrl:post.sourceUrl||snapshot.sourceUrl});
 }
 const imported=importMetricRows(state,rows,channels,at);
 // Reattach per-run observation provenance to each changed daily measurement.
 for(const row of rows){const m=state.metrics.find(m=>m.date===row.date&&m.source==='naver-post-daily'&&m.url===row.url&&!m.keyword);if(m){m.runUrl=snapshot.runUrl;m.observedAt=snapshot.observedAt;m.sourceUrl=row.sourceUrl;m.metricDefinition=snapshot.metricDefinition;}}
 state.naverPostCatalog=catalog;
 state.naverPostStats={...state.naverPostStats,blogId:'withsuzz',observedAt:snapshot.observedAt,runUrl:snapshot.runUrl,sourceUrl:snapshot.sourceUrl,metricDefinition:snapshot.metricDefinition,postCount:catalog.length,rowCount:state.metrics.filter(m=>m.source==='naver-post-daily').length,lastBatchPosts:snapshot.posts.length,lastBatchRows:rows.length,limitations:snapshot.limitations,warnings,runUrls:[snapshot.runUrl,...(state.naverPostStats?.runUrls||[])].slice(0,50)};
 state.naverPostSync={...state.naverPostSync,status:'갱신 완료',lastAttemptAt:at,lastSuccessAt:at,message:'',lastBatchPosts:snapshot.posts.length,lastBatchRows:rows.length};
 return {saved:true,duplicate:false,created,linked,...imported,warnings};
}
export function naverPostsOverview(state){
 const posts=(state.naverPostCatalog||[]).map(p=>{const rows=state.metrics.filter(m=>m.source==='naver-post-daily'&&m.url===p.url).sort((a,b)=>b.date.localeCompare(a.date)),latest=rows[0];return {...p,measurementDays:new Set(rows.map(m=>m.date)).size,latestMeasurement:latest?{date:latest.date,views:latest.views,visits:latest.visits,searchClicks:latest.searchClicks}:null};}).sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
 return {stats:state.naverPostStats?Object.fromEntries(Object.entries(state.naverPostStats).filter(([k])=>k!=='runUrls')):null,sync:state.naverPostSync||null,posts:posts.slice(0,200),trackedPostCount:posts.length,source:'naver-post-daily'};
}
