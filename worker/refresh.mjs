import {metricDate,measuredMetric} from './metrics.mjs';
export const REFRESH_BASES={searchClicks:'검색 유입 클릭',visits:'방문 유입',views:'글 조회수'};
const refreshShift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const refreshError=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const refreshPublishedDay=item=>{
 if(item.publishedAt){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.publishedAt));}catch{return '';}}
 return metricDate(item.date)?item.date:item.naverObservedPublished&&metricDate(item.firstObservedDate)?item.firstObservedDate:'';
};
function refreshWindow(days,start,end){
 const observed=[...days].filter(([date,v])=>date>=start&&date<=end&&v!==null).sort((a,b)=>a[0].localeCompare(b[0]));
 const total=observed.reduce((n,[,v])=>n+v,0);
 return {start,end,days:observed.length,expectedDays:14,total,average:observed.length?total/observed.length:null,observations:observed.map(([date,count])=>({date,count}))};
}
function refreshGroups(state,day){
 const items=new Map(state.items.filter(i=>i.channel==='blog'&&i.status==='게시됨').map(i=>[i.id,i])),groups=new Map();
 const coverage={totalRows:state.metrics.length,unlinkedRows:0,unknownSourceRows:0,keywordRows:0,unknownValueRows:0,conflictingDays:0,publishedPosts:items.size,comparablePosts:0};
 for(const row of state.metrics){
  if(row.channel!=='blog'||!metricDate(row.date)||row.date>=day||row.date<refreshShift(day,-182)||row.grain&&row.grain!=='day')continue;
  const item=items.get(row.itemId);if(!item){coverage.unlinkedRows++;continue;}
  if(!row.source?.trim()){coverage.unknownSourceRows++;continue;}
  if(row.keyword?.trim()){coverage.keywordRows++;continue;}
  const published=refreshPublishedDay(item);if(!published||row.date<published)continue;
  let known=false;
  for(const basis of Object.keys(REFRESH_BASES)){
   const value=measuredMetric(row,basis);if(value===null)continue;known=true;
   const key=JSON.stringify([item.id,row.source,basis]);
   if(!groups.has(key))groups.set(key,{item,source:row.source,basis,days:new Map(),conflicts:new Set()});const g=groups.get(key);
   if(g.days.has(row.date)&&g.days.get(row.date)!==value){g.days.set(row.date,null);g.conflicts.add(row.date);}else if(!g.conflicts.has(row.date))g.days.set(row.date,value);
  }
  if(!known)coverage.unknownValueRows++;
 }
 coverage.conflictingDays=[...groups.values()].reduce((n,g)=>n+g.conflicts.size,0);
 return {groups:[...groups.values()],coverage};
}
function refreshActions(item){
 const actions=['최신 공식 정보로 가격·운영시간·예약 조건을 확인하기','기존 경험과 사진에서 지금도 유효한 내용 골라 구성하기'];
 if(/날씨|옷차림|기온/.test(item.title+' '+item.keyword))actions.unshift('현재 여행 시기에 맞는 기온·옷차림·준비물을 확인하기');
 else if(/교통|공항|패스|입국/.test(item.title+' '+item.keyword))actions.unshift('이동 방법·요금·입국 규정의 변경 여부 확인하기');
 else if(/숙소|호텔|료칸/.test(item.title+' '+item.keyword))actions.unshift('현재 객실·예약 조건·이동 동선 다시 확인하기');
 if(item.links)actions.push('기존 제휴 링크의 상품·날짜·혜택이 유효한지 확인하기');
 return actions;
}
export function refreshSignals(state,day){
 const {groups,coverage}=refreshGroups(state,day),recentStart=refreshShift(day,-14),recentEnd=refreshShift(day,-1),byItem=new Map(),comparable=new Set();
 for(const g of groups){
  const published=refreshPublishedDay(g.item);if(published>refreshShift(day,-28))continue;
  const recent=refreshWindow(g.days,recentStart,recentEnd);
  if(recent.days<7||recent.observations.at(-1)?.date<refreshShift(recentEnd,-3))continue;
  const history=[];for(let n=1;n<=12;n++){const end=refreshShift(recentStart,-(n-1)*14-1),start=refreshShift(end,-13);const w=refreshWindow(g.days,start,end);if(w.days>=7)history.push(w);}
  const peak=history.sort((a,b)=>b.average-a.average||b.end.localeCompare(a.end))[0];if(!peak)continue;comparable.add(g.item.id);
  if(peak.average<5||recent.average>peak.average*.5)continue;
  const plans=(state.refreshPlans||[]).filter(p=>p.originalItemId===g.item.id),active=plans.find(p=>{const item=state.items.find(i=>i.id===p.newItemId);return item&&item.status!=='게시됨';});
  if(!active&&plans.some(p=>{const i=state.items.find(i=>i.id===p.newItemId);return i?.status==='게시됨'&&refreshPublishedDay(i)>refreshShift(day,-28);} ))continue;
  const cautions=['유입 감소의 원인이나 재작성 후 효과는 이 수치만으로 확정할 수 없어요.'];
  if(g.item.publishedDatePrecision==='unknown')cautions.push('정확한 게시일은 확인되지 않았어요. 가장 이른 일별 관측일을 기준으로 글의 최소 경과 기간을 확인했어요.');
  if(peak.days<14||recent.days<14)cautions.push('일부 날짜가 없어 관측된 날짜의 하루 평균끼리 비교했어요. 누락 날짜를 0으로 계산하지 않았어요.');
  if(g.basis==='views')cautions.push('글 조회수 비교예요. 검색 유입·방문자 수를 뜻하지 않아요.');
  const month=Number((g.item.title+' '+(g.item.keyword||'')).match(/(?:^|\D)(1[0-2]|[1-9])월/)?.[1]);
  if(month&&month!==Number(day.slice(5,7)))cautions.push('제목의 여행 월과 현재 월이 달라요. 계절 수요 변화인지 먼저 확인해 주세요.');
  if(g.item.type==='issue'||/축제|행사|국경절/.test(g.item.title))cautions.push('이슈·행사는 종료 후 수요가 줄 수 있어요. 새 일정이 있는지 확인한 뒤 재작성해요.');
  if(g.item.type==='sponsor')cautions.push('기존 협찬의 고지와 재발행 조건을 확인해 주세요.');
  if(g.conflicts.size)cautions.push('같은 날짜·출처의 수치가 충돌한 날은 비교에서 제외했어요.');
  const row={itemId:g.item.id,title:g.item.title,region:g.item.region||'',topic:g.item.topic||'',url:g.item.url||'',published,source:g.source,basis:g.basis,basisLabel:REFRESH_BASES[g.basis],peak,recent,decline:1-recent.average/peak.average,cautions,actions:refreshActions(g.item),activeItemId:active?.newItemId||null};
  const rank={searchClicks:3,visits:2,views:1};const old=byItem.get(g.item.id);if(!old||rank[row.basis]>rank[old.basis]||row.basis===old.basis&&row.peak.average>old.peak.average)byItem.set(g.item.id,row);
 }
 coverage.comparablePosts=comparable.size;
 const warnings=[];
 if(!state.metrics.length)warnings.push('글별 일별 성과 자료가 아직 없어요. 전체 블로그 방문자·검색어 비율만으로는 감소한 글을 찾을 수 없어요.');
 else if(!coverage.comparablePosts)warnings.push('같은 출처의 최근 14일과 이전 14일에 각각 7일 이상 자료가 있는 글이 필요해요.');
 if(coverage.unlinkedRows)warnings.push('게시글에 연결되지 않은 성과 '+coverage.unlinkedRows+'행이 있어요. 글감 ID 또는 원본 게시글 링크를 연결해 주세요.');
 if(coverage.unknownSourceRows)warnings.push('출처가 없는 '+coverage.unknownSourceRows+'행은 비교에서 제외했어요.');
 if(coverage.keywordRows)warnings.push('키워드별 자료는 글 전체 유입과 중복될 수 있어 비교에서 제외했어요.');
 return {candidates:[...byItem.values()].sort((a,b)=>b.peak.average*(b.decline)-a.peak.average*(a.decline)),coverage,warnings,day,recentStart,recentEnd};
}
export async function refreshRecommendations(state,day,hash){
 const result=refreshSignals(state,day);
 const candidates=[];for(const r of result.candidates.slice(0,50)){
  const item=state.items.find(i=>i.id===r.itemId),id=await hash(JSON.stringify(['refresh',r.itemId,r.source,r.basis,r.recent.end]));
  candidates.push({...r,id,fingerprint:await hash(JSON.stringify({id,evidence:r,item:{title:item.title,updatedAt:item.updatedAt,status:item.status,url:item.url}}))});
 }
 const plans=(state.refreshPlans||[]).slice(0,30).map(p=>{
  const item=state.items.find(i=>i.id===p.newItemId),original=state.items.find(i=>i.id===p.originalItemId),published=item?.status==='게시됨'?refreshPublishedDay(item):null;
  const observations=new Map();if(published)for(const m of state.metrics){if(m.itemId!==p.newItemId||m.channel!=='blog'||m.source!==p.evidence.source||m.keyword||!metricDate(m.date)||m.date<published||m.date>=day||m.date>refreshShift(published,13))continue;const value=measuredMetric(m,p.evidence.basis);if(value===null)continue;if(observations.has(m.date)&&observations.get(m.date)!==value)observations.set(m.date,null);else if(!observations.has(m.date))observations.set(m.date,value);}
  const measured=[...observations].filter(([,v])=>v!==null);return {id:p.id,originalItemId:p.originalItemId,newItemId:p.newItemId,title:item?.title||p.title,originalTitle:original?.title||p.originalTitle,status:item?.status||'글감 삭제됨',selectedAt:p.selectedAt,evidence:p.evidence,published,postDays:measured.length,postTotal:measured.length?measured.reduce((n,[,v])=>n+v,0):null,postAverage:measured.length?measured.reduce((n,[,v])=>n+v,0)/measured.length:null};
 });
 return {...result,candidates,plans};
}
export async function chooseRefreshPlan(state,input,day,hash,createContent,at=new Date().toISOString()){
 const same=(state.refreshPlans||[]).find(p=>p.candidateId===input.id&&p.fingerprint===input.fingerprint&&state.items.some(i=>i.id===p.newItemId));
 if(same)return {item:state.items.find(i=>i.id===same.newItemId),duplicate:true};
 const result=await refreshRecommendations(state,day,hash),row=result.candidates.find(r=>r.id===input.id);
 if(!row||row.fingerprint!==input.fingerprint)refreshError('성과 자료나 게시글이 바뀌었어요. 새 재작성 추천을 확인해 주세요.',409);
 if(row.activeItemId)return {item:state.items.find(i=>i.id===row.activeItemId),duplicate:true};
 const original=state.items.find(i=>i.id===row.itemId);
 const notes=['[재작성 기획]','원본 글: '+(original.url||original.title),row.basisLabel+'의 관측된 날짜 하루 평균이 '+row.peak.average.toFixed(1)+' → '+row.recent.average.toFixed(1)+'로 줄었습니다.','이전 비교: '+row.peak.start+' ~ '+row.peak.end+' / '+row.peak.days+'일 관측','최근 비교: '+row.recent.start+' ~ '+row.recent.end+' / '+row.recent.days+'일 관측','다음 확인:\n'+row.actions.map(a=>'- '+a).join('\n'),'주의:\n'+row.cautions.map(c=>'- '+c).join('\n'),'기존 경험을 새로 방문·이용한 경험처럼 쓰지 않습니다. 바뀐 정보는 최신 공식 자료로 확인합니다.',original.notes?'[원본 메모]\n'+original.notes:''].filter(Boolean).join('\n\n');
 const item=createContent({title:original.title,type:original.type,channel:'blog',region:original.region,topic:original.topic,keyword:original.keyword,keywordCount:original.keywordCount,minWords:original.minWords,provided:original.provided,guideline:original.guideline,links:original.links,notes,status:'아이디어',date:'',draft:'',automaticLane:'manual'});
 item.refreshOf=original.id;item.refreshSourceUrl=original.url||'';
 const evidence={source:row.source,basis:row.basis,basisLabel:row.basisLabel,peak:row.peak,recent:row.recent,decline:row.decline,cautions:row.cautions,actions:row.actions};
 const plan={id:crypto.randomUUID(),candidateId:row.id,fingerprint:row.fingerprint,originalItemId:original.id,newItemId:item.id,originalTitle:original.title,title:item.title,selectedAt:at,evidence};
 state.items.unshift(item);state.refreshPlans=[plan,...(state.refreshPlans||[])];
 return {item,plan,duplicate:false};
}
