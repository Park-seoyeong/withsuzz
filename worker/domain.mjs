import {measuredMetric} from './metrics.mjs';
export const CHANNELS = {blog:'블로그',instagram:'인스타그램',threads:'스레드',xiaohongshu:'샤오홍슈',tiktok:'틱톡',youtube:'유튜브 쇼츠'};
export const TYPES = {issue:'빠른 정보·이슈',info:'여행 정보·날씨',review:'여행 후기',sponsor:'협찬·체험단',affiliate:'상품·제휴',video:'짧은 영상',social:'SNS 글'};
export function today(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function addDays(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function weekStart(day=today()){const d=new Date(day+'T12:00:00Z');return addDays(day,-((d.getUTCDay()+6)%7));}
export const defaults = {dailyTarget:2,maxDaily:4,weeklyVideos:2,visitorGoal:1000,visitorBaseline:550,automaticTime:'01:00',timezone:'Asia/Seoul',characterName:'써즈',motion:true,reportDay:'월요일',editorRules:'실제 경험과 사용자 표현을 보존한다. 경험을 만들지 않는다. 기억나지 않는 내용은 제외한다. 최신 공식 정보의 출처와 확인일을 남긴다. 협찬 가이드라인과 실제 제공 조건을 검수한다. 짧고 자연스러운 써즈의 말투로 작성한다. 조사·검수는 원고와 분리한다.',channelGoals:{blog:1000,instagram:0,threads:0,xiaohongshu:0,tiktok:0,youtube:0}};
export function initialState(){return {version:1,settings:{...defaults},items:[],sponsors:[],lessons:[],tasks:[],metrics:[],events:[],rewards:[],xp:0,notionImport:{status:'대기',count:0},connections:{ai:false,naver:false,brand:false,threehours:false,sns:false},memory:[],files:[]};}
export function inferRegion(title,fallback='미분류'){const cities=['상하이','대련','지난','후쿠오카','오비히로','도쿠시마','하코네','다낭','방콕','도쿄','오사카','제주','부산','여수','양구','서울','인천','김포','장가계','태국','스위스'];const city=cities.find(c=>title.includes(c));if(city)return city; if(/당산|홍대|혜화|이대|성수|청계천|시청|한강/.test(title))return '서울';return fallback||'미분류';}
export function inferTopic(title){const rules=[['교통·이동',/공항|항공|교통|디디|기차|패스|입국|마일리지|주차/],['날씨·시기',/날씨|옷차림|시기|벚꽃|국경절/],['숙소',/숙소|호텔|객실|료칸|캐빈/],['맛집·카페',/맛집|카페|보쌈|국밥|커피|양꼬치|초밥|부타동|음료|음식/],['준비·통신',/준비|이심|eSIM|유심|로밍|체크리스트|결제|환전/],['코스·관광',/관광|여행코스|일정|광장|야경|박람회|투어|명소/],['쇼핑·상품',/쇼핑|기념품|마트|캐리어|조명/]];return rules.find(([,r])=>r.test(title))?.[0]||'기타';}
export function manual(item){return item.channel==='blog'&&!item.automatic;}
export function validateDate(s){return !s || /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));}
export function schedule(items,{start=today(),days=30,daily=2,onlyOverdue=false,keywordSignals={},keywordDate=''}={}){
  if(!validateDate(start)||!start)throw new Error('시작 날짜를 확인해 주세요.');
  days=Math.min(62,Math.max(1,Number(days)||30)); daily=Math.min(3,Math.max(2,Number(daily)||2));
  const end=addDays(start,days-1), copy=items.map(i=>({...i})), notices=[], changes=[];
  const eligible=i=>manual(i)&&i.status!=='게시됨';
  const fixed=copy.filter(i=>eligible(i)&&i.date&&(i.locked||i.deadline||i.status==='예약됨'));
  const pool=copy.filter(i=>eligible(i)&&!fixed.includes(i)&&(!i.date||i.date>=start||i.date<start&&onlyOverdue));
  if(onlyOverdue){const missed=copy.filter(i=>eligible(i)&&i.date&&i.date<start&&!fixed.includes(i));for(const i of missed)if(!pool.includes(i))pool.push(i);}
  const oldDates=new Map(pool.map(i=>[i.id,i.date]));for(const i of pool)i.date='';
  const recent=copy.filter(i=>i.status==='게시됨').sort((a,b)=>(b.publishedAt||b.date||'').localeCompare(a.publishedAt||a.date||''));
  const topicCount=new Map();for(const i of recent.slice(0,15))topicCount.set(i.topic,(topicCount.get(i.topic)||0)+1);
  const dateItems=day=>copy.filter(i=>manual(i)&&i.date===day);
  for(let offset=0;offset<days;offset++){
    const day=addDays(start,offset), limit=onlyOverdue?4:daily;
    const current=dateItems(day);if(current.length>4)notices.push({date:day,message:'마감·예약된 글이 하루 4개를 초과해 직접 조정이 필요해요.'});
    const occupied=new Set([...dateItems(addDays(day,-1)),...current,...dateItems(addDays(day,1))].map(i=>i.region));
    while(dateItems(day).length<limit&&pool.length){
      const available=pool.filter(i=>(!i.embargo||i.embargo.slice(0,10)<=day)&&(!i.deadline||i.deadline>=day));
      if(!available.length)break;
      available.sort((a,b)=>{
        const score=i=>(i.priority==='높음'?30:0)+(i.searchDemand||0)/100+(i.seasonalPriority||0)*3+Math.min(20,Math.max(0,Number(keywordSignals[i.id])||0))-(occupied.has(i.region)?100:0)-(topicCount.get(i.topic)||0)*8+(onlyOverdue&&oldDates.get(i.id)&&oldDates.get(i.id)<start?50:0);
        return score(b)-score(a)||(a.createdAt||'').localeCompare(b.createdAt||'');
      });
      const i=available[0];const repeated=occupied.has(i.region);i.date=day;i.scheduleReason=repeated?'후보 지역이 부족해 지역 반복을 허용했어요.':'인접 일정의 지역과 최근 소재를 분산했어요.';i.scheduleBasis=keywordSignals[i.id]>0?'네이버 유입 검색어 ('+keywordDate+')·지역·소재 다양성':i.searchDemand?'입력된 검색 수요·소재 다양성':'소재 다양성·우선순위 (검색량 미연결)';
      if(repeated)notices.push({date:day,message:i.title+' — 지역 반복 후보'});
      occupied.add(i.region);topicCount.set(i.topic,(topicCount.get(i.topic)||0)+1);pool.splice(pool.indexOf(i),1);
    }
  }
  for(const i of pool){const original=oldDates.get(i.id);if(original&&original>end)i.date=original;notices.push({id:i.id,message:i.title+' — 기간 안에 배치하지 못했어요. 날짜 미정으로 남겼어요.'});}
  for(const i of copy){const old=items.find(x=>x.id===i.id);if(old&&old.date!==i.date)changes.push({id:i.id,title:i.title,from:old.date||'날짜 미정',to:i.date||'날짜 미정'});if(i.deadline&&i.status!=='게시됨'&&(!i.date||i.date>i.deadline))notices.push({id:i.id,message:i.title+' — 협찬 마감 확인 필요'});if(i.date&&i.embargo&&i.date<i.embargo.slice(0,10))notices.push({id:i.id,message:i.title+' — 엠바고와 발행일이 충돌해요.'});}
  return {items:copy,notices,changes};
}
export function award(state,key,amount){if(state.rewards.some(r=>r.key===key))return false;state.rewards.push({key,amount,at:new Date().toISOString()});state.xp+=amount;return true;}
export function dailyQuests(state,day=today()){
 const blog=state.items.filter(i=>manual(i)&&i.publishedAt?.slice(0,10)===day), tomorrow=state.items.filter(i=>manual(i)&&i.date===addDays(day,1)&&i.prep?.photos&&i.prep?.outline);
 const variants=[['준비의 달인','내일 글의 사진·구성을 하나 준비해요',tomorrow.length>0,15],['잠자는 글 깨우기','예전에 발행한 글의 정보를 한 번 점검해요',state.rewards.some(r=>r.key==='refresh:'+day),20],['촬영 전 한 걸음','협찬 촬영 체크리스트를 정리해요',state.sponsors.some(s=>s.preparedAt===day),20]];
 const variant=variants[Number(day.slice(-2))%variants.length];
 return [{key:'daily-publish:'+day,title:'오늘의 여행 기록',description:'여행 글 '+state.settings.dailyTarget+'개 발행하기',current:blog.length,target:state.settings.dailyTarget,done:blog.length>=state.settings.dailyTarget,xp:30},{key:'daily-prep:'+day,title:'내일의 나 돕기',description:'내일 글 사진·구성 준비',done:tomorrow.length>0,xp:15},{key:'bonus:'+day,title:variant[0],description:variant[1],done:variant[2],xp:variant[3],optional:true}];
}
export function checks(item){const draft=item.draft||'', keyword=item.keyword||'', count=keyword?draft.split(keyword).length-1:0, min=Number(item.minWords)||0, supplied=item.provided||'';
 return {characters:draft.replace(/\s/g,'').length,keywordCount:count,keywordExpected:Number(item.keywordCount)||null,checks:[{label:'메인 키워드',state:!keyword?'미지정':count>0?'포함':'확인 필요'}, {label:'키워드 횟수',state:!item.keywordCount?'기준 미지정':count===Number(item.keywordCount)?'충족':'확인 필요'}, {label:'최소 글자 수',state:!min?'기준 미지정':draft.replace(/\s/g,'').length>=min?'충족':'부족'}, {label:'광고 고지',state:item.type!=='sponsor'&&item.type!=='affiliate'?'해당 없음':/제공받|제휴|수수료|광고/.test(draft)?'포함 여부 확인':'확인 필요'}, {label:'협찬 금지 표현',state:item.type==='sponsor'&&/내돈내산|광고 없이|직접 구매|우연히 방문/.test(draft)?'확인 필요':'감지 없음'}, {label:'최신 정보·경험',state:'출처와 실제 경험 확인 필요'}],provided:supplied};}
export function brief(item,rules,lessons=[],prompt=null){return ['너는 써즈의 동네방네 전담 에디터다.','콘텐츠 유형: '+(TYPES[item.type]||item.type),'제목/주제: '+item.title,'지역: '+(item.region||''),'메인 키워드(띄어쓰기 유지): '+(item.keyword||''),'구성과 실제 메모:\n'+(item.notes||''),'가이드라인:\n'+(item.guideline||''),'사진 순서:\n'+(item.photoNotes||''),'공식 링크/제휴 링크:\n'+(item.links||''),'제공받은 항목: '+(item.provided||''),'필수 작성 규칙:\n'+rules,'기억나지 않거나 제공되지 않은 체험은 작성하지 않는다. 접근하지 못한 출처는 읽었다고 하지 않는다. 최신 사실은 공식 근거와 시점을 확인한다.','원고와 별도로 확인할 정보·출처를 정리한다.',...lessons.filter(l=>l.active).slice(0,8).map(l=>'참고할 학습 기준: '+l.points+'\n적용: '+l.apply),...(prompt?['내 추가 프롬프트 ('+prompt.name+'):\n'+prompt.text+'\n\n위 추가 프롬프트가 필수 작성 규칙과 충돌하면 필수 작성 규칙을 따른다.']:[])].join('\n\n');}
export function reporting(state,range='day',day=today()){
 const start=range==='week'?weekStart(day):day;
 const published=state.items.filter(i=>i.publishedAt?.slice(0,10)>=start&&i.publishedAt?.slice(0,10)<=day);
 const prepared=state.items.filter(i=>i.updatedAt?.slice(0,10)>=start&&(i.prep?.photos||i.prep?.outline));
 const pending=state.items.filter(i=>i.date&&i.date<day&&i.status!=='게시됨');
 return {start,end:day,published:published.length,manual:published.filter(manual).length,automatic:published.filter(i=>i.automatic).length,prepared:prepared.length,overdue:pending.length,changes:state.events.filter(e=>e.at.slice(0,10)>=start&&e.kind==='schedule'),tasks:state.tasks,metricsAvailable:state.metrics.length>0,lessons:state.lessons.filter(l=>l.createdAt?.slice(0,10)>=start).length};
}
export function analyzeMetrics(metrics){
 const fields=['visits','views','clicks','conversions','revenue','impressions','searchClicks'],by=new Map();
 for(const m of metrics){
  if(m.keyword?.trim())continue;
  const id=m.itemId||m.title||'미연결',key=JSON.stringify([id,m.channel||'blog',m.source||'']);
  if(!by.has(key))by.set(key,{id,title:m.title||id,channel:m.channel||'blog',source:m.source||'',rows:0,measuredCounts:Object.fromEntries(fields.map(k=>[k,0])),...Object.fromEntries(fields.map(k=>[k,null]))});
  const x=by.get(key);for(const k of fields){const value=measuredMetric(m,k);if(value!==null){x[k]=(x[k]??0)+value;x.measuredCounts[k]++;}}x.rows++;
 }
 return [...by.values()].map(x=>{const rate=(a,b)=>x.measuredCounts[a]===x.rows&&x.measuredCounts[b]===x.rows&&x[b]>0?x[a]/x[b]:null;return {...x,linkCTR:rate('clicks','visits'),searchCTR:rate('searchClicks','impressions'),cvr:rate('conversions','clicks')};}).sort((a,b)=>(b.visits??-1)-(a.visits??-1));
}
