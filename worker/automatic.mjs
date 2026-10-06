import {publicationTime} from './publishing.mjs';
const autoError=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const autoText=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
function automaticUrl(value){let u;try{u=new URL(value);}catch{autoError('실제로 확인한 HTTPS 출처가 필요해요.');}if(u.protocol!=='https:'||u.username||u.password||u.port||/^(?:localhost|127\.|10\.|192\.168\.|\[|169\.254\.)/i.test(u.hostname))autoError('공식 출처 주소를 확인해 주세요.');return u.href;}
function automaticItem(state,id){const item=state.items.find(i=>i.id===id);if(!item||!item.automaticResearch||!['asia-issue','brand-shopping'].includes(item.automaticLane))autoError('자동 글로 새로 준비한 글감만 변경할 수 있어요.',403);if(['예약됨','게시됨'].includes(item.status)||(state.publishJobs||[]).some(j=>j.itemId===id&&['실행 중','확인 필요','예약 확인됨','게시 확인됨'].includes(j.status)))autoError('네이버 결과가 있는 원고는 변경하지 않아요.',409);return item;}
export function createAutomaticBrief(state,input,content,now=new Date().toISOString()){
 if(!/^[\w-]{20,80}$/.test(input.requestId||''))autoError('자동 글 준비 요청 번호가 필요해요.');
 const duplicate=state.items.find(i=>i.automaticResearch?.requestId===input.requestId);if(duplicate)return {duplicate:true,itemId:duplicate.id};
 if(!['asia-issue','brand-shopping'].includes(input.lane))autoError('아시아 이슈 또는 브랜드 커넥트를 선택해 주세요.');
 const scheduledAt=publicationTime(input.scheduledAt);if(!String(input.scheduledAt).endsWith('T01:00')||new Date(scheduledAt)<=new Date(now))autoError('미래 날짜의 한국 시간 새벽 01:00으로 준비해 주세요.');
 const date=input.scheduledAt.slice(0,10);if(state.items.some(i=>i.automaticLane===input.lane&&i.date===date))autoError('해당 날짜·종류의 자동 글은 이미 준비돼 있어요.',409);
 if(!autoText(input.reason)||!Array.isArray(input.sources)||!input.sources.length||input.sources.length>10)autoError('추천 이유와 실제로 확인한 공식 자료가 필요해요.');
 const sources=input.sources.map(s=>{const url=automaticUrl(s.url),checked=Date.parse(s.checkedAt);if(s.kind!=='official'||!autoText(s.title)||!Number.isFinite(checked)||checked>Date.parse(now)+300000||Date.parse(now)-checked>36*3600000||!Array.isArray(s.facts)||!s.facts.length||s.facts.length>20||s.facts.some(f=>!autoText(f)))autoError('최근 확인한 공식 자료의 제목·확인 시각·핵심 사실을 남겨 주세요.');return {url,title:autoText(s.title,200),kind:'official',checkedAt:new Date(checked).toISOString(),facts:s.facts.map(f=>autoText(f,1000))};});
 let product=null;if(input.product?.validUntil&&!Number.isFinite(Date.parse(input.product.validUntil)))autoError('상품 조건의 유효 시각을 확인해 주세요.');if(input.lane==='brand-shopping'){const p=input.product;if(!p||p.ownerChannelConfirmed!==true||!autoText(p.name)||!autoText(p.disclosure)||!p.disclosure.includes('수수료'))autoError('본인 브랜드 커넥트 상품·제휴 링크·실제 고지가 필요해요.');const affiliateUrl=automaticUrl(p.affiliateUrl);if(!/^https:\/\/naver\.me\/[a-zA-Z0-9]+$/.test(affiliateUrl))autoError('관리 화면 주소 대신 본인 계정에서 발급한 실제 구매 제휴 링크를 남겨 주세요.');product={name:autoText(p.name,200),url:automaticUrl(p.url),affiliateUrl,disclosure:autoText(p.disclosure,500),price:autoText(p.price,100),priceConditions:autoText(p.priceConditions,1000),validUntil:p.validUntil&&Number.isFinite(Date.parse(p.validUntil))?new Date(p.validUntil).toISOString():null,ownerChannelConfirmed:true,demandEvidence:autoText(p.demandEvidence,1000)};if(product.validUntil&&new Date(product.validUntil)<new Date(scheduledAt))autoError('예약 시각 전에 끝나는 상품 조건이에요.');}
 const item=content({title:input.title,channel:'blog',type:input.lane==='asia-issue'?'issue':'affiliate',automaticLane:input.lane,date,region:autoText(input.region,100),topic:input.lane==='asia-issue'?'해외 여행 이슈':'쇼핑·상품',priority:'높음',notes:sources.map(s=>s.title+'\n'+s.facts.join('\n')+'\n'+s.url).join('\n\n'),links:product?.affiliateUrl||'',status:'아이디어'});
 item.automaticResearch={requestId:input.requestId,createdAt:now,scheduledAt,reason:autoText(input.reason,1000),sources,product,status:'조사 확인',draftReviewed:false};state.items.unshift(item);return {duplicate:false,itemId:item.id};
}
export async function automaticContext(state,itemId,hash){const item=state.items.find(i=>i.id===itemId);if(!item?.automaticResearch)autoError('자동 글 기획을 찾지 못했어요.',404);return {itemId:item.id,revision:await hash(JSON.stringify(item)),title:item.title,draft:item.draft||'',status:item.status,region:item.region,research:item.automaticResearch,attachments:(item.attachmentIds||[]).map(id=>{const f=state.files.find(f=>f.id===id);return f?{id:f.id,name:f.name,type:f.type,size:f.size,automaticRights:f.automaticRights||null}:{id,missing:true};}),instructions:'확인한 사실만 써즈 말투로 작성한다. 실제 이용 경험을 만들지 않는다. 원고와 출처를 분리한다. 사진은 실제 파일과 권한을 확인한다. 준비 저장을 네이버 예약으로 취급하지 않는다.'};}
export async function saveAutomaticDraft(state,input,hash,now=new Date().toISOString()){
 const item=automaticItem(state,input.itemId);if(input.revision!==await hash(JSON.stringify(item)))autoError('자동 글 자료가 변경됐어요. 다시 확인해 주세요.',409);
 const body=autoText(input.body,80000),title=autoText(input.title,200);if(!title||body.length<100||input.reviewed!==true||input.latestInformationVerified!==true)autoError('확인한 최신 자료로 작성·검수한 전체 원고가 필요해요.');
 if(/제가\s*(?:다녀왔|방문했|직접\s*(?:먹|이용|사용))|직접\s*사용해보니|내돈내산/.test(body))autoError('자동 정보·제휴 글에 확인되지 않은 실제 경험을 쓰지 않아요.');
 const expected=item.automaticResearch.sources.map(s=>s.url);if(!Array.isArray(input.checkedSourceUrls)||!expected.every(u=>input.checkedSourceUrls.includes(u)))autoError('기획의 공식 출처를 모두 확인해 주세요.');
 if(item.automaticLane==='brand-shopping'&&!body.startsWith(item.automaticResearch.product.disclosure))autoError('실제 제휴 고지를 본문 상단에 넣어 주세요.');
 item.title=title;item.draft=title+'\n\n'+body;item.status='초안 작성';item.updatedAt=now;item.prep={...item.prep,outline:true,body:true};item.automaticResearch={...item.automaticResearch,status:'원고 확인',draftReviewed:true,draftCheckedAt:now,checkedSourceUrls:[...expected]};delete item.formatting;return {itemId:item.id,revision:await hash(JSON.stringify(item))};
}
export function automaticImageType(bytes){if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';autoError('실제 JPG·PNG·WebP 이미지 파일이 필요해요.');}
export function automaticAssetPlan(state,input,bytes,hashValue,now=new Date().toISOString()){
 const item=automaticItem(state,input.itemId);if(!bytes.length||bytes.length>8*1024*1024)autoError('사진은 8MB 이하 실제 파일로 준비해 주세요.',413);const type=automaticImageType(bytes),rights=['own','licensed','seller-authorized','generated'].includes(input.rights)?input.rights:null;if(!rights||!autoText(input.permissionText))autoError('사진의 실제 이용 권한 근거를 남겨 주세요.');
 const sourceUrl=input.sourceUrl?automaticUrl(input.sourceUrl):'',licenseUrl=input.licenseUrl?automaticUrl(input.licenseUrl):'';if(['licensed','seller-authorized'].includes(rights)&&(!sourceUrl||!licenseUrl))autoError('사진 원본과 실제 라이선스·판매자 허락 링크가 필요해요.');
 const duplicate=state.files.find(f=>(item.attachmentIds||[]).includes(f.id)&&f.contentHash===hashValue);if(duplicate)return {duplicate:true,file:duplicate};
 const id=crypto.randomUUID(),file={id,key:'files/'+id,name:autoText(input.name,200)||'자동 글 사진',type,size:bytes.length,at:now,contentHash:hashValue,automaticRights:{rights,sourceUrl,licenseUrl,permissionText:autoText(input.permissionText,1500),attribution:autoText(input.attribution,500),caption:autoText(input.caption,500)}};return {duplicate:false,file};
}
export function attachAutomaticAsset(state,input,file,now=new Date().toISOString()){const item=automaticItem(state,input.itemId);if((item.attachmentIds||[]).includes(file.id))return {duplicate:true,fileId:file.id};if((item.attachmentIds||[]).length>=20)autoError('자동 글 사진은 20장까지 보관해요.');state.files.push(file);item.attachmentIds=[...(item.attachmentIds||[]),file.id];item.prep={...item.prep,photos:true};item.updatedAt=now;return {duplicate:false,fileId:file.id};}
export function automaticPrepareInput(state,input){
 const item=automaticItem(state,input.itemId);
 if(!item.automaticResearch.draftReviewed)autoError('최신 자료로 작성한 원고 검수가 필요해요.');
 const lines=String(item.draft||'').trim().split('\n');
 if(lines[0]?.replace(/^#+\s*/,'')===item.title)lines.shift();
 const paragraphs=lines.join('\n').trim().split(/\n\s*\n/).filter(x=>x.trim()).length;
 const ids=item.attachmentIds||[];
 return {...input,itemId:item.id,scheduledAt:item.automaticResearch.scheduledAt,lane:item.automaticLane,title:item.title,reviewed:true,images:ids.map((id,n)=>{
  const file=state.files.find(f=>f.id===id),r=file?.automaticRights;
  if(!r)autoError('자동 글 사진의 권한 기록이 필요해요.');
  return {fileId:id,afterParagraph:Math.floor(n*paragraphs/ids.length),rights:r.rights,licenseUrl:r.licenseUrl,caption:[r.caption,r.attribution].filter(Boolean).join(' · ')};
 })};
}
export function automaticOverview(state){return {items:state.items.filter(i=>i.automaticResearch).slice(0,100).map(i=>({id:i.id,title:i.title,lane:i.automaticLane,date:i.date,status:i.status,preparation:i.automaticResearch.status,draftReviewed:i.automaticResearch.draftReviewed,imageCount:(i.attachmentIds||[]).length,reason:i.automaticResearch.reason,sources:i.automaticResearch.sources.map(s=>({title:s.title,url:s.url,checkedAt:s.checkedAt}))})),notice:'자동 원고·사진 준비와 네이버 실제 예약·게시 결과를 구분합니다.'};}
