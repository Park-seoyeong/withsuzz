import {ownedMetricPostUrl} from './metrics.mjs';
const formatError=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const formatTypes=['info','review','affiliate'];
export function normalizeTextStyle(input={}){
 const style={};
 if(input.fontSizePx!=null){if(!Number.isFinite(input.fontSizePx)||input.fontSizePx<10||input.fontSizePx>48)formatError('글자 크기는 10~48px 범위로 지정해 주세요.');style.fontSizePx=input.fontSizePx;}
 if(input.color){let c=String(input.color).toLowerCase();const rgb=c.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);if(rgb&&rgb.slice(1).every(x=>Number(x)<=255))c='#'+rgb.slice(1).map(x=>Number(x).toString(16).padStart(2,'0')).join('');if(!/^#[a-f0-9]{6}$/.test(c))formatError('글자 색상은 실제 확인한 RGB 또는 6자리 색상 코드로 지정해 주세요.');style.color=c;}
 if(input.bold!=null){if(typeof input.bold!=='boolean')formatError('굵게 표시 값을 확인해 주세요.');style.bold=input.bold;}
 if(input.alignment){if(!['left','center','right'].includes(input.alignment))formatError('문단 정렬을 확인해 주세요.');style.alignment=input.alignment;}
 if(input.lineHeight!=null){if(!Number.isFinite(input.lineHeight)||input.lineHeight<1||input.lineHeight>3)formatError('줄 간격 비율은 1~3 사이로 지정해 주세요.');style.lineHeight=input.lineHeight;}
 if(input.fontFamily){const font=String(input.fontFamily);if(font.length>150||/[;<>\\]/.test(font))formatError('관측한 글꼴 이름을 확인해 주세요.');style.fontFamily=font;}
 return style;
}
function observedStyle(value){if(value?.method!=='computed')return {};const clean={...value};if(typeof clean.fontSizePx==='string'&&/^\d+(?:\.\d+)?(?:px)?$/.test(clean.fontSizePx))clean.fontSizePx=parseFloat(clean.fontSizePx);if(typeof clean.lineHeight==='string'){if(/^\d+(?:\.\d+)?px$/.test(clean.lineHeight)&&Number.isFinite(clean.fontSizePx))clean.lineHeight=parseFloat(clean.lineHeight)/clean.fontSizePx;else if(/^\d+(?:\.\d+)?$/.test(clean.lineHeight))clean.lineHeight=Number(clean.lineHeight);else delete clean.lineHeight;}return normalizeTextStyle(clean);}
export function saveFormattingStudy(state,input,now=new Date().toISOString()){
 if(!/^https:\/\/agent\.tinyfish\.ai\/runs\/[a-f0-9-]{36}$/.test(input.runUrl||'')||!Array.isArray(input.posts)||!input.posts.length||input.posts.length>6)formatError('실제 게시글 서식 관측과 실행 기록이 필요해요.');
 if(state.formattingStudies?.some(s=>s.runUrl===input.runUrl))return {duplicate:true,profiles:state.formattingProfiles||[]};
 const posts=input.posts.map(p=>{const url=ownedMetricPostUrl(p.url);if(!url||typeof p.title!=='string'||!p.title.trim()||!formatTypes.includes(p.contentType))formatError('써즈 원본 글과 콘텐츠 종류를 확인해 주세요.');
  const headings=(p.headings||[]).slice(0,10).map(h=>({text:String(h.text||'').slice(0,100),style:observedStyle(h),method:['computed','visual'].includes(h.method)?h.method:'unknown'}));
  return {url,title:p.title.slice(0,200),contentType:p.contentType,viewport:['desktop','mobile'].includes(p.actualViewport)?p.actualViewport:'unknown',body:observedStyle(p.body),bodyMethod:['computed','visual'].includes(p.body?.method)?p.body.method:'unknown',headings,quotes:(p.quotes||[]).slice(0,5).map(q=>({shortText:String(q.shortText||'').slice(0,100),appearance:String(q.appearance||'').slice(0,500),location:String(q.location||'').slice(0,200),method:['computed','visual'].includes(q.method)?q.method:'unknown'})),emphasis:(p.emphasis||[]).slice(0,10).map(e=>({shortText:String(e.shortText||'').slice(0,100),style:observedStyle(e),method:['computed','visual'].includes(e.method)?e.method:'unknown'})),photoSpacing:{description:String(p.photoSpacing?.description||'').slice(0,500),method:p.photoSpacing?.method==='computed'?'computed':p.photoSpacing?.method==='visual'?'visual':'unknown'},limitations:(p.limitations||[]).filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,500))};
 });
 const study={id:crypto.randomUUID(),runUrl:input.runUrl,at:now,posts,commonPatterns:(input.commonPatterns||[]).filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,500)),differences:(input.differences||[]).filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,500)),warnings:(input.warnings||[]).filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,500))};
 state.formattingStudies=[study,...(state.formattingStudies||[])].slice(0,10);
 const profiles=[...(state.formattingProfiles||[])];
 const latestPosts=[...new Map(state.formattingStudies.flatMap(s=>s.posts).slice().reverse().map(p=>[p.url,p])).values()];
 for(const type of formatTypes){const samples=latestPosts.filter(p=>p.contentType===type);if(!samples.length)continue;
  const consensus=values=>{const out={};for(const key of ['fontSizePx','color','bold','alignment','lineHeight','fontFamily'])if(values.length&&values.every(v=>v[key]!=null&&v[key]===values[0][key]))out[key]=values[0][key];return out;};
  const headingSamples=samples.flatMap(p=>p.headings.map(h=>h.style)).filter(v=>Object.keys(v).length),profile={id:'learned-'+type,contentType:type,name:'써즈 '+({info:'정보·이슈',review:'후기',affiliate:'제휴'}[type])+' 서식',body:consensus(samples.map(p=>p.body)),heading:consensus(headingSamples),sampleCount:samples.length,sourceUrls:samples.map(p=>p.url),studyId:study.id,updatedAt:now,quotes:samples.flatMap(p=>p.quotes).slice(0,5),notes:['정확한 수치는 본문에서 계산된 스타일로 관측한 값만 반영합니다.','예시 글의 인용구 위치와 강조 문장은 새 글에 자동 복제하지 않습니다.']};
  const old=profiles.findIndex(p=>p.id===profile.id);if(old<0)profiles.push(profile);else profiles[old]=profile;
 }
 state.formattingProfiles=profiles;return {duplicate:false,study,profiles};
}
export function formattingProfileForItem(state,item){const type=['issue','info'].includes(item.type)?'info':['review','sponsor'].includes(item.type)?'review':item.type==='affiliate'?'affiliate':null;return (state.formattingProfiles||[]).find(p=>p.id===item.formatting?.profileId)||((state.formattingProfiles||[]).find(p=>p.contentType===type))||null;}
export function formattingParagraphs(text){const parts=String(text||'').split(/(\n[ \t]*\n+)/),blocks=[];let offset=0;for(let n=0;n<parts.length;n++){const part=parts[n];if(n%2===0&&part.trim()){const left=part.length-part.trimStart().length,right=part.length-part.trimEnd().length;blocks.push({index:blocks.length,start:offset+left,end:offset+part.length-right,text:part.trim()});}offset+=part.length;}return blocks;}
export async function saveItemFormatting(state,input,hash,now=new Date().toISOString()){
 const item=state.items.find(i=>i.id===input.itemId);if(!item)formatError('글감을 찾지 못했어요.',404);if(item.status==='게시됨')formatError('게시된 원본 대신 재작성 기획에서 서식을 준비해 주세요.',409);
 const draftHash=await hash(item.draft||'');if(input.draftHash!==draftHash)formatError('원고가 바뀌었어요. 최신 원고를 저장한 뒤 서식을 다시 지정해 주세요.',409);
 if(input.clear===true){delete item.formatting;item.updatedAt=now;return {cleared:true,itemId:item.id};}
 const paragraphs=formattingParagraphs(item.draft),previous=item.formatting?.draftHash===draftHash?item.formatting:{paragraphs:[],ranges:[]};
 const profileId=Object.hasOwn(input,'profileId')?input.profileId||null:previous.profileId||null;if(profileId&&!(state.formattingProfiles||[]).some(p=>p.id===profileId))formatError('저장된 서식 프로필을 확인해 주세요.');
 const decorations=[...(previous.paragraphs||[])],ranges=[...(previous.ranges||[])];
 if(input.paragraph){const p=input.paragraph;if(!Number.isInteger(p.index)||!paragraphs[p.index]||!['paragraph','heading','quote'].includes(p.kind))formatError('꾸밀 문단과 종류를 확인해 주세요.');const style=normalizeTextStyle(p.style||{}),old=decorations.findIndex(x=>x.index===p.index),decoration={index:p.index,kind:p.kind,style};if(old<0)decorations.push(decoration);else decorations[old]=decoration;}
 if(input.range){const r=input.range;if(!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>(item.draft||'').length)formatError('꾸밀 문장 범위를 확인해 주세요.');const style=normalizeTextStyle(r.style||{});if(style.alignment||style.lineHeight)formatError('정렬·줄 간격은 문단 대상으로 지정해 주세요.');if(!Object.keys(style).length)formatError('적용할 글자 서식을 골라 주세요.');for(let n=ranges.length-1;n>=0;n--)if(ranges[n].start<r.end&&ranges[n].end>r.start)ranges.splice(n,1);ranges.push({start:r.start,end:r.end,style});}
 if(decorations.length>200||ranges.length>200)formatError('한 원고의 서식 지정은 200개까지 가능해요.');item.formatting={draftHash,profileId,paragraphs:decorations,ranges,updatedAt:now};item.updatedAt=now;return {itemId:item.id,formatting:item.formatting};
}
export async function formattingDocument(state,item,hash,body=item.draft||''){
 const draftHash=await hash(item.draft||''),profile=formattingProfileForItem(state,item),active=item.formatting?.draftHash===draftHash,itemPlan=active?item.formatting:{paragraphs:[],ranges:[]},baseOffset=(item.draft||'').indexOf(body);
 const blocks=formattingParagraphs(body).map(p=>{const decoration=baseOffset>=0?(itemPlan.paragraphs||[]).find(x=>{const original=formattingParagraphs(item.draft)[x.index];return original?.start===p.start+baseOffset&&original?.end===p.end+baseOffset;}):null,auto=/^##\s+\S/.test(p.text)&&!p.text.includes('\n'),kind=decoration?.kind||(auto?'heading':'paragraph');return {...p,kind,text:auto&&kind==='heading'?p.text.replace(/^##\s+/,''):p.text,autoHeading:auto,style:{...profile?.body,...(kind==='heading'?profile?.heading:{}),...decoration?.style},ranges:baseOffset>=0?(itemPlan.ranges||[]).filter(r=>r.start<p.end+baseOffset&&r.end>p.start+baseOffset).map(r=>({start:Math.max(0,r.start-p.start-baseOffset),end:Math.min(p.text.length,r.end-p.start-baseOffset),style:r.style})).sort((a,b)=>a.start-b.start):[]};});
 const custom=blocks.some(p=>p.kind!=='paragraph'||Object.keys(p.style).length||p.ranges.length);
 return {itemId:item.id,draftHash,profileId:profile?.id||null,profileName:profile?.name||null,blocks,hasCustomFormatting:custom,stalePlan:!!item.formatting&&!active,bodyMappingVerified:!active||baseOffset>=0,notice:'서식 미리보기와 네이버 실제 적용 결과는 별도로 확인합니다. 모르는 글자 크기·색은 편집기 기본값을 유지합니다.'};
}
export function formattingOverview(state){return {profiles:state.formattingProfiles||[],studies:(state.formattingStudies||[]).slice(0,5)};}
