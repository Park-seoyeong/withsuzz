export const METRIC_FIELDS=['visits','views','clicks','conversions','revenue','impressions','searchClicks'];
export function metricDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
export function measuredMetric(row,field){
 const value=row[field];if(!Number.isFinite(value)||value<0||field!=='revenue'&&!Number.isSafeInteger(value))return null;
 // Old imports filled missing cells with zero. Such legacy zeros are unknown.
 if(Array.isArray(row.measuredFields))return row.measuredFields.includes(field)?value:null;
 return value>0?value:null;
}
export function ownedMetricPostUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||!['blog.naver.com','m.blog.naver.com'].includes(u.hostname)||u.username||u.password||u.port)return '';
  if(/^\/withsuzz\/[1-9]\d+$/.test(u.pathname))return 'https://blog.naver.com'+u.pathname;
  if(u.pathname==='/PostView.naver'&&u.searchParams.get('blogId')==='withsuzz'&&/^[1-9]\d+$/.test(u.searchParams.get('logNo')||''))return 'https://blog.naver.com/withsuzz/'+u.searchParams.get('logNo');
 }catch{}return '';
}
export function importMetricRows(state,rows,channels,at=new Date().toISOString()){
 const result={count:0,updated:0,skipped:0,invalidFields:0,unlinked:0};
 for(const raw of rows){
  if(!raw||!metricDate(raw.date)||!String(raw.title||'').trim()||raw.grain&&raw.grain!=='day'||raw.periodStart&&raw.periodStart!==raw.date||raw.periodEnd&&raw.periodEnd!==raw.date){result.skipped++;continue;}
  const url=ownedMetricPostUrl(raw.url),byId=state.items.find(i=>i.id===raw.itemId),byUrl=url?state.items.find(i=>ownedMetricPostUrl(i.url)===url):null;
  if(byId&&byUrl&&byId.id!==byUrl.id){result.skipped++;continue;}
  const linked=byId||byUrl,channel=Object.hasOwn(channels,raw.channel)?raw.channel:linked?.channel||'blog';
  if(linked&&linked.channel!==channel){result.skipped++;continue;}
  const row={id:crypto.randomUUID(),date:raw.date,title:String(raw.title).trim().slice(0,200),channel,keyword:String(raw.keyword||'').slice(0,200),itemId:linked?.id||String(raw.itemId||'').slice(0,80),source:String(raw.source||'').trim().slice(0,100),url,grain:'day',measuredFields:[],importedAt:at};
  for(const field of METRIC_FIELDS){
   row[field]=null;const value=raw[field];if(value==null||typeof value==='string'&&!value.trim())continue;
   if(!['string','number'].includes(typeof value)){result.invalidFields++;continue;}
   const n=Number(typeof value==='string'?value.replaceAll(',','').trim():value);
   if(!Number.isFinite(n)||n<0||field!=='revenue'&&!Number.isSafeInteger(n)){result.invalidFields++;continue;}
   row[field]=n;row.measuredFields.push(field);
  }
  if(!row.measuredFields.length){result.skipped++;continue;}
  const old=state.metrics.find(m=>m.date===row.date&&m.channel===row.channel&&m.source===row.source&&m.keyword===row.keyword&&(row.itemId?m.itemId===row.itemId:!m.itemId&&m.title===row.title));
  if(old){
   const fields=METRIC_FIELDS.filter(k=>measuredMetric(old,k)!==null);
   for(const k of row.measuredFields)old[k]=row[k];
   old.measuredFields=[...new Set([...fields,...row.measuredFields])];old.title=row.title;old.grain='day';old.importedAt=at;if(url)old.url=url;result.updated++;
  }else{state.metrics.push(row);result.count++;}
  if(!linked)result.unlinked++;
 }
 return result;
}
