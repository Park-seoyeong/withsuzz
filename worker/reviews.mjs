import {refreshSignals} from './refresh.mjs';
import {measuredMetric} from './metrics.mjs';
const reviewShift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const reviewWeek=day=>reviewShift(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
const inPeriod=(value,start,end)=>typeof value==='string'&&value.slice(0,10)>=start&&value.slice(0,10)<=end;

export function buildManagerReview(state,kind,day,at,automatic=true){
 if(!['daily','weekly'].includes(kind))throw new Error('리포트 종류를 확인해 주세요.');
 const input=JSON.stringify({reviewVersion:2,refreshDay:day,items:(state.items||[]).map(i=>[i.id,i.status,i.channel,i.publishedAt,i.date,i.deadline,i.updatedAt,i.topic,i.prep]),tasks:(state.tasks||[]).map(t=>[t.id,t.status,t.updatedAt]),metrics:state.metrics||[],stats:state.naverStats||null,sync:state.naverSync||null});
 let digest=2166136261;for(let i=0;i<input.length;i++)digest=Math.imul(digest^input.charCodeAt(i),16777619);const fingerprint=(digest>>>0).toString(16);
 const key=kind+':'+(kind==='weekly'?reviewWeek(day):day),existing=(state.managerReports||[]).find(r=>r.key===key);
 if(existing?.fingerprint===fingerprint)return {report:existing,duplicate:true};
 const end=kind==='weekly'?reviewShift(reviewWeek(day),-1):day,start=kind==='weekly'?reviewShift(end,-6):day;
 const items=state.items||[],published=items.filter(i=>inPeriod(i.publishedAt,start,end)),manual=published.filter(i=>i.channel==='blog'&&!i.automatic),prepared=items.filter(i=>inPeriod(i.updatedAt,start,end)&&(i.prep?.photos||i.prep?.outline));
 const overdue=items.filter(i=>i.date&&i.date<day&&i.status!=='게시됨');
 const deadlines=items.filter(i=>i.deadline&&i.deadline>=day&&i.deadline<=reviewShift(day,3)&&i.status!=='게시됨').map(i=>({id:i.id,title:i.title,date:i.deadline}));
 const tasks=(state.tasks||[]).reduce((map,t)=>{map[t.status]=(map[t.status]||0)+1;return map;},{});
 const visitors=(state.naverStats?.visitors||[]).filter(r=>inPeriod(r.date,start,end)&&r.date<day);
 const keywords=(state.naverStats?.keywords||[]).slice().sort((a,b)=>b.percentage-a.percentage).slice(0,5);
 const warnings=[];
 if(!state.naverStats)warnings.push('네이버 통계가 아직 없어요.');
 else if(state.naverStats.keywordDate<reviewShift(day,-7))warnings.push('유입 검색어가 7일 이상 지난 자료예요.');
 if(state.naverSync?.status==='확인 필요')warnings.push('네이버 통계 갱신: '+state.naverSync.message);
 if((tasks['실패']||0)+(tasks['확인 필요']||0)>0)warnings.push('실패·확인 필요 작업 '+((tasks['실패']||0)+(tasks['확인 필요']||0))+'개를 확인해 주세요.');
 if(overdue.length)warnings.push('밀린 콘텐츠 '+overdue.length+'개가 있어요. 일정 조정을 확인해 주세요.');
 const counts={published:published.length,manual:manual.length,automatic:published.filter(i=>i.automatic).length,prepared:prepared.length,overdue:overdue.length,tasks};
 let memory=null;
 if(kind==='weekly'){
  const metricStart=reviewShift(end,-27),groups=new Map(),linked=items.filter(i=>i.channel==='blog'&&i.status==='게시됨');
  for(const m of state.metrics||[]){
   const item=linked.find(i=>i.id===m.itemId);
   const visits=measuredMetric(m,'visits');if(!item||!m.source||m.channel!=='blog'||m.keyword||!inPeriod(m.date,metricStart,end)||visits===null)continue;
   if(!groups.has(m.source))groups.set(m.source,new Map());const posts=groups.get(m.source);
   if(!posts.has(item.id))posts.set(item.id,{item,days:new Map()});const p=posts.get(item.id);if(!p.days.has(m.date))p.days.set(m.date,visits);else if(p.days.get(m.date)!==visits)p.days.set(m.date,null);
  }
  for(const posts of groups.values())for(const [id,p]of posts){for(const [date,n]of p.days)if(n===null)p.days.delete(date);if(!p.days.size)posts.delete(id);}
  const best=[...groups].sort((a,b)=>b[1].size-a[1].size)[0],profile={at,periodStart:metricStart,periodEnd:end,source:best?.[0]||null,sampleSize:best?.[1].size||0,topicBoost:{}};
  if(best&&best[1].size>=3){
   const posts=[...best[1].values()].map(p=>({topic:p.item.topic||'기타',average:[...p.days.values()].reduce((a,b)=>a+b,0)/p.days.size})),baseline=posts.reduce((n,p)=>n+p.average,0)/posts.length;
   const topics=new Map();for(const p of posts){if(!topics.has(p.topic))topics.set(p.topic,[]);topics.get(p.topic).push(p.average);}
   if(baseline>0)for(const [topic,values]of topics)profile.topicBoost[topic]=Math.min(4,Math.max(0,Math.round((values.reduce((a,b)=>a+b,0)/values.length/baseline-1)*2)));
   state.recommendationProfile=profile;
  }
  const changed=Object.entries(profile.topicBoost).filter(([,v])=>v>0).map(([k])=>k);
  memory={id:key,at,automatic,summary:(keywords.length?'참고 검색어 ('+state.naverStats.keywordDate+'): '+keywords.map(k=>k.keyword+' '+k.percentage.toFixed(2)+'%').join(', ')+'. ':'검색어 자료가 없어요. ')+(profile.sampleSize>=3?'같은 성과 출처의 글 '+profile.sampleSize+'개를 참고했어요.':'글별 성과가 충분하지 않아 기존 추천 기준을 유지했어요.'),changes:changed.length?'성과 참고를 추가한 소재: '+changed.join(', '):'검색어 관련성·지역 다양성 기준 유지',evidence:{keywordDate:state.naverStats?.keywordDate||null,metricSource:profile.source,sampleSize:profile.sampleSize,periodStart:metricStart,periodEnd:end,topicBoost:profile.topicBoost}};
  state.memory=[memory,...(state.memory||[]).filter(m=>m.id!==key)].slice(0,100);
 }
 const refresh=refreshSignals(state,day);const refreshReview={candidateCount:refresh.candidates.length,comparablePosts:refresh.coverage.comparablePosts,recentStart:refresh.recentStart,recentEnd:refresh.recentEnd,warnings:refresh.warnings,candidates:refresh.candidates.slice(0,3).map(r=>({itemId:r.itemId,title:r.title,basisLabel:r.basisLabel,source:r.source,decline:r.decline,peak:r.peak,recent:r.recent,cautions:r.cautions}))};
 const report={key,kind,at,automatic,start,end,fingerprint,counts,deadlines,keywords,refresh:refreshReview,keywordDate:state.naverStats?.keywordDate||null,visitorDays:visitors.length,visitorAverage:visitors.length?visitors.reduce((n,r)=>n+r.count,0)/visitors.length:null,warnings,memory,summary:manual.length+'개 여행 글 발행 · 자료 준비 '+prepared.length+'개 · 밀린 콘텐츠 '+overdue.length+'개'+(kind==='daily'?' (작성 시점 기준)':'')};
 state.managerReports=[report,...(state.managerReports||[]).filter(r=>r.key!==key)].slice(0,90);
 return {report,duplicate:false};
}
