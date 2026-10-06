import {formattingDocument,formattingProfileForItem} from './formatting.mjs';
// This module prepares work and records independently verified Naver results.
// It never sends a post to Naver and never treats a queued job as a reservation.
export const PUBLICATION_LANES={manual:'직접 작성한 여행 글','asia-issue':'아시아 이슈 자동 글','brand-shopping':'브랜드 커넥트 자동 글'};
const publishingError=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const publicationText=(x,max=10000)=>String(x??'').slice(0,max);
const activePublication=j=>!['취소','게시 확인됨','실패'].includes(j.status);
const editorReady=(state,now)=>state.publishingAccess?.editorAccessible===true&&Number.isFinite(Date.parse(state.publishingAccess.checkedAt))&&new Date(state.publishingAccess.checkedAt)<=new Date(now)&&new Date(now)-new Date(state.publishingAccess.checkedAt)<=24*3600000;
const publishingDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const actualDay=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
export function publicationTime(value){
 const s=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|\+09:00)?$/.test(s)||!actualDay(s.slice(0,10)))publishingError('발행 시각을 확인해 주세요. 한국 시간으로 입력해요.');
 const d=new Date(/(?:Z|\+09:00)$/.test(s)?s:s+'+09:00');
 if(Number.isNaN(d.getTime()))publishingError('발행 시각을 확인해 주세요.');
 return d.toISOString();
}
function publicationRun(url){if(!/^https:\/\/agent\.tinyfish\.ai\/runs\/[a-f0-9-]{36}$/.test(url||''))publishingError('실제 브라우저 실행 기록이 필요해요.');return url;}
function ownPost(url){
 try{const u=new URL(url);if(u.protocol!=='https:'||!['blog.naver.com','m.blog.naver.com'].includes(u.hostname)||u.username||u.password||u.port)throw 0;
  if(/^\/withsuzz\/[1-9]\d+$/.test(u.pathname))return 'https://blog.naver.com'+u.pathname;
  if(u.pathname==='/PostView.naver'&&u.searchParams.get('blogId')==='withsuzz'&&/^[1-9]\d+$/.test(u.searchParams.get('logNo')||''))return 'https://blog.naver.com/withsuzz/'+u.searchParams.get('logNo');
 }catch{}publishingError('써즈 블로그의 실제 게시글 링크를 확인해 주세요.');
}
function publicationItem(state,id){const i=state.items.find(i=>i.id===id);if(!i)publishingError('글감이 없어요.',404);return i;}
function publicationJob(state,id){const j=(state.publishJobs||[]).find(j=>j.id===id);if(!j)publishingError('발행 준비 기록이 없어요.',404);return j;}
async function publicationRevision(item,state,hash){
 return hash(JSON.stringify({item,formattingProfile:formattingProfileForItem(state,item),files:(item.attachmentIds||[]).map(id=>state.files.find(f=>f.id===id)||{id,missing:true})}));
}
function publicationBody(item,title){const lines=String(item.draft||'').trim().split('\n');if([title,item.title].includes(lines[0]?.replace(/^#+\s*/,'')))lines.shift();return lines.join('\n').trim();}
function publicationImages(state,item,input,paragraphs){
 if(!Array.isArray(input)||input.length>40)publishingError('사진은 최대 40개까지 배치할 수 있어요.');
 return input.map(x=>{
  const f=state.files.find(f=>f.id===x.fileId),afterParagraph=Number(x.afterParagraph);
  if(!f||!(item.attachmentIds||[]).includes(f.id)||!['image/jpeg','image/png','image/webp'].includes(f.type))publishingError('이 글감에 첨부한 이미지 파일만 배치할 수 있어요.');
  if(!Number.isInteger(afterParagraph)||afterParagraph<0||afterParagraph>paragraphs)publishingError('사진 위치는 원고의 문단 번호 안에서 선택해 주세요.');
  const rights=['own','licensed','seller-authorized','generated'].includes(x.rights)?x.rights:'unknown';
  let licenseUrl='';if(x.licenseUrl){try{const u=new URL(x.licenseUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw 0;licenseUrl=u.href;}catch{publishingError('이미지 이용 근거 링크를 확인해 주세요.');}}
  return {fileId:f.id,name:f.name,type:f.type,afterParagraph,rights,licenseUrl,caption:publicationText(x.caption,500)};
 }).sort((a,b)=>a.afterParagraph-b.afterParagraph);
}
export async function publicationChecks(state,job,hash,now=new Date().toISOString()){
 const item=state.items.find(i=>i.id===job.itemId),issues=[];
 if(!item)return {ready:false,issues:['글감이 삭제됐어요.'],paragraphs:0};
 if(await publicationRevision(item,state,hash)!==job.revision)issues.push('원고·자료·일정이 바뀌었어요. 발행 준비를 다시 저장해 주세요.');
 if(item.channel!=='blog')issues.push('네이버 블로그 글만 발행 준비할 수 있어요.');
 if(item.status==='게시됨'&&job.status!=='게시 확인됨')issues.push('이미 게시된 글이에요. 중복 발행하지 않아요.');
 if(!job.title.trim()||!job.body.trim())issues.push('제목과 완성 원고가 필요해요.');
 if(job.formatting?.stalePlan)issues.push('원고가 바뀌어 서식 위치를 다시 확인해야 해요.');
 if(job.formatting?.bodyMappingVerified===false)issues.push('발행 본문과 꾸미기 문단 연결을 다시 확인해 주세요.');
 if(!job.reviewed)issues.push('실제 경험·최신 정보·가이드라인 검수를 완료해 주세요.');
 const target=publishingDay(job.scheduledAt),start=new Date(job.scheduledAt).getTime();
 if(item.deadline&&target>item.deadline)issues.push('발행 시각이 협찬 마감 이후예요.');
 if(item.deadline&&!actualDay(item.deadline))issues.push('협찬 마감 날짜를 확인해 주세요.');
 if(item.embargo&&start<new Date(publicationTime(item.embargo)).getTime())issues.push('엠바고 해제 시각 이전에는 발행할 수 없어요.');
 if(item.date&&item.date!==target)issues.push('글감의 발행 예정일과 준비 시각이 달라요. 일정 상세에서 맞춰 주세요.');
 if(job.lane!=='manual'){
  if(job.lane==='asia-issue'&&item.type!=='issue'||job.lane==='brand-shopping'&&item.type!=='affiliate')issues.push('아시아 이슈는 정보·이슈, 브랜드 커넥트는 상품·제휴 유형으로 준비해 주세요.');
  if(!item.automatic)issues.push('새벽 자동 글로 구분되지 않았어요. 글감 설정에서 운영 구분을 바꿔 주세요.');
  if(!job.scheduledAt.endsWith('T16:00:00.000Z'))issues.push('자동 글은 한국 시간 새벽 1시로 준비해 주세요.');
  if(!job.images.length)issues.push('자동 글에는 이용 권한을 확인한 사진이 한 장 이상 필요해요.');
  if(job.lane==='brand-shopping'&&!/https:\/\//.test(item.links||''))issues.push('브랜드 커넥트 상품의 실제 제휴 링크가 필요해요.');
  if((state.publishJobs||[]).some(j=>j.id!==job.id&&!['취소','실패'].includes(j.status)&&j.lane===job.lane&&publishingDay(j.scheduledAt)===target))issues.push('같은 날 같은 주제의 자동 글이 이미 준비돼 있어요.');
 }else{
  if(item.automatic)issues.push('자동 글의 운영 구분과 발행 준비 종류를 맞춰 주세요.');
  const ids=new Set(state.items.filter(i=>i.id!==item.id&&i.channel==='blog'&&!i.automatic&&i.date===target).map(i=>i.id));
  for(const j of state.publishJobs||[])if(j.id!==job.id&&j.itemId!==item.id&&j.lane==='manual'&&activePublication(j)&&publishingDay(j.scheduledAt)===target)ids.add(j.itemId);
  if(ids.size>=4)issues.push('직접 작성하는 글은 하루 최대 4개예요.');
 }
 if(job.images.some(x=>x.rights==='unknown'||['licensed','seller-authorized'].includes(x.rights)&&!x.licenseUrl))issues.push('사진의 이용 권한과 필요한 근거 링크를 확인해 주세요.');
 if(job.images.some(x=>(state.files.find(f=>f.id===x.fileId)?.size||0)>8*1024*1024))issues.push('발행 이미지 한 장은 8MB 이하로 준비해 주세요.');
 const paragraphs=job.body.split(/\n\s*\n/).filter(x=>x.trim()).length;
 if(/\[(?:사진\s*\d+|메뉴판 사진|객실 사진)\]/.test(job.body))issues.push('원고의 사진 위치 표시를 정리하고 사진 배치로 지정해 주세요.');
 if(job.images.some(x=>x.afterParagraph>paragraphs))issues.push('사진 위치가 현재 원고의 문단 수를 넘어요.');
 if(Number(item.minWords)>0&&job.body.replace(/\s/g,'').length<Number(item.minWords))issues.push('가이드라인의 최소 글자 수보다 짧아요.');
 if(item.keyword){const count=(job.title+'\n'+job.body).split(item.keyword).length-1;if(!count||Number(item.keywordCount)>0&&count!==Number(item.keywordCount))issues.push('제목·본문의 메인 키워드 횟수를 확인해 주세요.');if(!job.title.includes(item.keyword))issues.push('제목에 메인 키워드를 정확하게 넣어 주세요.');}
 if(['sponsor','affiliate'].includes(item.type)){
  if(!/제공받|제휴|수수료|광고/.test(job.body.slice(0,500)))issues.push('본문 상단에 실제 제공 조건에 맞는 광고·제휴 고지가 필요해요.');
  if(item.type==='sponsor'&&/내돈내산|광고 없이|직접 구매|우연히 방문/.test(job.body))issues.push('협찬 글의 금지 표현을 수정해 주세요.');
 }
 if(job.images.length&&state.publishingAccess?.imageUploadVerified!==true)issues.push('네이버에 사진 파일을 전달하는 실제 업로드 경로 확인이 필요해요.');
 if(!editorReady(state,now))issues.push('네이버 글쓰기 화면의 로그인·접근 확인이 필요해요.');
 return {ready:issues.length===0,issues,paragraphs,characters:job.body.replace(/\s/g,'').length,targetDate:target};
}
export async function preparePublication(state,input,hash,now=new Date().toISOString()){
 if(!/^[\w-]{20,80}$/.test(input.requestId||''))publishingError('발행 준비 요청 번호를 확인해 주세요.');
 const duplicate=(state.publishJobs||[]).find(j=>j.requestId===input.requestId);if(duplicate)return {job:duplicate,duplicate:true};
 const item=publicationItem(state,input.itemId);if(item.channel!=='blog'||item.status==='게시됨')publishingError('아직 게시하지 않은 네이버 글감으로 준비해 주세요.');
 const active=(state.publishJobs||[]).find(j=>j.itemId===item.id&&activePublication(j));
 if(active&&['실행 중','확인 필요','예약 확인됨'].includes(active.status))publishingError('기존 발행의 실제 결과를 먼저 확인해 주세요. 중복 실행을 막고 있어요.',409);
 if(!active&&(state.publishJobs||[]).filter(activePublication).length>=100)publishingError('미완료 발행 준비가 100개예요. 기존 준비를 정리한 뒤 추가해 주세요.',429);
 const scheduledAt=publicationTime(input.scheduledAt);if(new Date(scheduledAt)<new Date(now)-60000)publishingError('발행 시각이 이미 지났어요. 다음 시각으로 준비해 주세요.');
 const lane=input.lane||'manual';if(!Object.hasOwn(PUBLICATION_LANES,lane))publishingError('발행 종류를 확인해 주세요.');
 const title=publicationText(input.title||item.title,200).trim(),body=publicationBody(item,title);
 const images=publicationImages(state,item,input.images||[],body.split(/\n\s*\n/).filter(x=>x.trim()).length);
 const job={id:crypto.randomUUID(),requestId:input.requestId,itemId:item.id,lane,title,body,images,scheduledAt,reviewed:input.reviewed===true,revision:await publicationRevision(item,state,hash),createdAt:now,updatedAt:now,status:'준비 중',attempts:[],receipt:null};
 job.formatting=await formattingDocument(state,item,hash,body);
 const checks=await publicationChecks({...state,publishJobs:(state.publishJobs||[]).filter(j=>j.id!==active?.id)},job,hash,now);job.status=checks.ready?'발행 대기':'준비 중';job.checks=checks;
 if(active){active.status='취소';active.message='새 발행 준비로 교체했어요.';active.updatedAt=now;}
 state.publishJobs=[job,...(state.publishJobs||[])];
 // Never prune a job with an unresolved external outcome.
 state.publishJobs=state.publishJobs.filter((j,n)=>n<100||activePublication(j));
 return {job,duplicate:false};
}
export async function publicationOverview(state,hash,now=new Date().toISOString()){
 const ordered=[...(state.publishJobs||[]).filter(activePublication),...(state.publishJobs||[]).filter(j=>!activePublication(j))];
 const jobs=[];for(const j of ordered.slice(0,100)){
  const unresolved=j.status==='실행 중'&&new Date(j.lease?.expiresAt)<new Date(now);
  const terminal=['취소','게시 확인됨','실패'].includes(j.status);
  const checks=terminal?j.checks:await publicationChecks(state,j,hash,now);
  jobs.push({id:j.id,itemId:j.itemId,title:j.title,lane:j.lane,scheduledAt:j.scheduledAt,status:unresolved?'확인 필요':j.status==='발행 대기'&&!checks.ready?'준비 중':j.status,checks,updatedAt:j.updatedAt,receipt:j.receipt,message:unresolved?'실행 응답이 끝나지 않았어요. 네이버 결과 확인 전에는 재실행하지 않아요.':j.message||'',imageCount:j.images.length,attempts:j.attempts.length});
 }
 return {jobs,access:state.publishingAccess||null,editorReady:editorReady(state,now),automaticTime:'01:00',timezone:'Asia/Seoul',schedulerConnected:false};
}
export async function publicationContext(state,id,hash,now=new Date().toISOString()){
 const job=publicationJob(state,id),checks=await publicationChecks(state,job,hash,now);
 return {job:{...job,lease:job.lease?{expiresAt:job.lease.expiresAt}:null},checks,blogId:'withsuzz',instructions:'검수 통과와 실행권 확보 후만 진행한다. 로그인·계정·엠바고·원고·사진을 실제 확인한다. 예약·게시 결과를 네이버에서 재조회한다. 불명확하면 재발행하지 않고 확인 필요로 기록한다.'};
}
export function recordPublishingAccess(state,input,now=new Date().toISOString()){
 const runUrl=publicationRun(input.runUrl),u=new URL(input.entryUrl||'https://blog.naver.com/PostWriteForm.naver?blogId=withsuzz');
 if(u.protocol!=='https:'||u.hostname!=='blog.naver.com'||u.username||u.password||u.port)publishingError('네이버 글쓰기 확인 주소가 필요해요.');
 const controls=Array.isArray(input.observedControls)?[...new Set(input.observedControls.filter(x=>['title','body','image','publish','reservation','temporary-save'].includes(x)))]:[];
 const accessible=input.editorAccessible===true&&input.blogId==='withsuzz'&&input.loginRequired===false&&input.accountMismatch===false&&['title','body','image','publish'].every(x=>controls.includes(x));
 state.publishingAccess={editorAccessible:accessible,loginRequired:input.loginRequired===true,blogId:'withsuzz',entryUrl:u.href,runUrl,observedControls:controls,checkedAt:now,imageTransferMethod:publicationText(input.imageTransferMethod||'',200),imageUploadVerified:input.imageUploadVerified===true&&!!input.imageVerification,imageVerification:publicationText(input.imageVerification||'',500),message:publicationText(input.message||(accessible?'ネ이버 글쓰기 화면 접근을 확인했어요.':'글쓰기 화면 접근 확인이 필요해요.'),500)};
 return state.publishingAccess;
}
export async function claimPublication(state,input,hash,now=new Date().toISOString()){
 const job=publicationJob(state,input.jobId);
 if(!['발행 대기','준비 중'].includes(job.status))publishingError('이미 실행됐거나 결과 확인이 필요한 발행이에요. 다시 실행하지 않아요.',409);
 const checks=await publicationChecks(state,job,hash,now);if(!checks.ready)publishingError(checks.issues.join(' '),409);
 const mode=input.mode||'publish';if(!['publish','reserve'].includes(mode))publishingError('발행 또는 예약 실행 종류를 확인해 주세요.');
 if(mode==='publish'&&new Date(job.scheduledAt)>new Date(now))publishingError('발행 예정 시각이 아직 오지 않았어요.',409);
 if(mode==='publish'&&publishingDay(job.scheduledAt)!==publishingDay(now))publishingError('예정 발행일이 지났어요. 다음 일정을 조정한 뒤 새로 준비해 주세요.',409);
 if(mode==='reserve'&&(new Date(job.scheduledAt)<=new Date(now)||!state.publishingAccess.observedControls.includes('reservation')))publishingError('미래 예약 시각과 실제 네이버 예약 기능 접근이 필요해요.',409);
 const item=publicationItem(state,job.itemId);if(item.deadline&&publishingDay(now)>item.deadline)publishingError('협찬 마감이 지나 실행을 중단했어요.',409);
 const lease={id:crypto.randomUUID(),createdAt:now,expiresAt:new Date(new Date(now).getTime()+10*60000).toISOString()};
 job.lease=lease;job.status='실행 중';job.updatedAt=now;job.checks=checks;job.attempts.push({id:lease.id,startedAt:now,status:'실행 중',mode});
 return {jobId:job.id,leaseId:lease.id,expiresAt:lease.expiresAt,mode,title:job.title,body:job.body,images:job.images,formatting:job.formatting||null,scheduledAt:job.scheduledAt,blogId:'withsuzz'};
}
export async function recordPublication(state,input,hash,now=new Date().toISOString()){
 const job=publicationJob(state,input.jobId),outcome=input.outcome;
 if(!job.lease||job.lease.id!==input.leaseId)publishingError('발행 실행 기록과 결과가 일치하지 않아요.',409);
 if(job.receipt&&job.receipt.outcome===outcome&&job.receipt.runUrl===input.runUrl)return {job,duplicate:true};
 if(!['실행 중','확인 필요','예약 확인됨'].includes(job.status))publishingError('발행 실행 기록과 결과가 일치하지 않아요.',409);
 const runUrl=publicationRun(input.runUrl);
 if(!['published','reserved','unknown','failed'].includes(outcome))publishingError('발행 결과 종류를 확인해 주세요.');
 const attempt=job.attempts.find(a=>a.id===job.lease.id),item=publicationItem(state,job.itemId);
 if(['unknown','failed'].includes(outcome)){
  // A failed browser run can still have published. No automatic retry.
  job.status='확인 필요';job.message=publicationText(input.message||'실제 네이버 예약·게시 상태를 확인해 주세요.',500);job.updatedAt=now;attempt.status='확인 필요';attempt.runUrl=runUrl;
  return {job,duplicate:false};
 }
 if(input.verifiedTitle!==job.title||input.bodyVerified!==true||job.images.length&&input.imagesVerified!==true||typeof input.verification!=='string'||!input.verification.trim())publishingError('네이버에서 제목·원고·사진을 재조회한 확인 근거가 필요해요.');
 if(await publicationRevision(item,state,hash)!==job.revision)publishingError('실행 중 원고가 수정됐어요. 현재 원고를 보존하며 실제 발행 결과를 별도로 확인해 주세요.',409);
 if(job.formatting?.hasCustomFormatting&&input.formattingVerified!==true)publishingError('네이버에서 인용구·색·글자 크기의 실제 적용 결과를 확인해 주세요.');
 let receipt={outcome,runUrl,formattingVerified:input.formattingVerified===true,verifiedAt:now,verification:publicationText(input.verification,1500)};
 if(outcome==='published'){
  const postUrl=ownPost(input.postUrl),publishedAt=publicationTime(input.publishedAt);
  if(new Date(publishedAt)>new Date(now).getTime()+300000||new Date(publishedAt)<new Date(job.scheduledAt)-60000)publishingError('실제 게시 시각과 발행 예정 시각을 확인해 주세요.');
  if(publishingDay(publishedAt)!==publishingDay(job.scheduledAt))publishingError('예정일과 실제 게시일이 달라요. 실제 네이버 결과를 별도로 확인해 주세요.',409);
  if((state.publishJobs||[]).some(j=>j.id!==job.id&&j.receipt?.postUrl===postUrl))publishingError('이 게시글은 다른 발행 기록에 이미 연결돼 있어요.',409);
  receipt={...receipt,postUrl,publishedAt};job.status='게시 확인됨';item.status='게시됨';item.url=postUrl;item.publishedAt=publishedAt;item.date=publishingDay(publishedAt);
 }else{
  if(publicationTime(input.scheduledAt)!==job.scheduledAt||new Date(job.scheduledAt)<=new Date(now))publishingError('네이버에서 확인한 미래 예약 시각이 필요해요.');
  let u;try{u=new URL(input.reservationUrl||'');}catch{publishingError('써즈 블로그의 실제 예약 확인 주소가 필요해요.');}if(u.protocol!=='https:'||!['blog.naver.com','admin.blog.naver.com'].includes(u.hostname)||u.username||u.password||u.port||!u.href.includes('withsuzz'))publishingError('써즈 블로그의 실제 예약 확인 주소가 필요해요.');
  if(!input.reservationId||String(input.reservationId).length>200)publishingError('실제 네이버 예약 식별값이 필요해요.');
  receipt={...receipt,scheduledAt:job.scheduledAt,reservationUrl:u.href,reservationId:String(input.reservationId)};job.status='예약 확인됨';item.status='예약됨';item.date=publishingDay(job.scheduledAt);
 }
 item.updatedAt=now;job.revision=await publicationRevision(item,state,hash);job.receipt=receipt;job.message=outcome==='published'?'네이버 게시글을 재조회해 확인했어요.':'네이버 예약 목록에서 확인했어요.';job.updatedAt=now;attempt.status=job.status;attempt.runUrl=runUrl;
 return {job,duplicate:false};
}
export function cancelPublication(state,id,now=new Date().toISOString()){
 const job=publicationJob(state,id);if(!['준비 중','발행 대기'].includes(job.status))publishingError('실행된 발행은 네이버 결과 확인 전에는 취소·재실행할 수 없어요.',409);
 job.status='취소';job.updatedAt=now;job.message='사이트 발행 준비를 취소했어요. 원고와 일정은 유지돼요.';return job;
}

// 네이버 글쓰기 API가 없어 예약은 네이버 편집기에서 직접(또는 Claude 데스크톱의 브라우저 조작으로) 한다.
// 사이트는 사용자가 예약·게시를 마쳤다고 확인한 사실만 '직접 기록'으로 남긴다. 원격 재조회 확인과는 구분한다.
export async function recordManualReservation(state,input,hash,now=new Date().toISOString()){
 const job=publicationJob(state,input.jobId);
 if(!['준비 중','발행 대기'].includes(job.status))publishingError('이미 예약·게시 기록이 있거나 취소된 준비예요.',409);
 if(input.confirmed!==true)publishingError('네이버에서 예약을 마쳤는지 확인해 주세요.');
 if(new Date(job.scheduledAt)<=new Date(now))publishingError('예약 시각이 이미 지났어요. 게시를 마쳤다면 ‘게시 확인’으로 기록해 주세요.');
 const item=publicationItem(state,job.itemId),checks=await publicationChecks(state,job,hash,now);
 job.status='예약 확인됨';job.updatedAt=now;job.message='써즈님이 네이버에서 직접 예약했다고 기록했어요. 예약 시각이 지나면 게시글 링크로 확인해 주세요.';
 job.receipt={outcome:'reserved',method:'manual',scheduledAt:job.scheduledAt,confirmedAt:now,note:publicationText(input.note||'',500),openIssues:(checks.issues||[]).slice(0,10)};
 item.status='예약됨';item.date=publishingDay(job.scheduledAt);item.updatedAt=now;job.revision=await publicationRevision(item,state,hash);
 return {job};
}
export async function recordManualPublished(state,input,hash,now=new Date().toISOString()){
 const job=publicationJob(state,input.jobId);
 if(!['준비 중','발행 대기','예약 확인됨'].includes(job.status)||job.status==='예약 확인됨'&&job.receipt?.method!=='manual')publishingError('이 준비는 직접 게시 기록을 남길 수 없어요.',409);
 const postUrl=ownPost(input.postUrl);
 if((state.publishJobs||[]).some(j=>j.id!==job.id&&j.receipt?.postUrl===postUrl))publishingError('이 게시글은 다른 발행 기록에 이미 연결돼 있어요.',409);
 const item=publicationItem(state,job.itemId),due=new Date(job.scheduledAt)<=new Date(now).getTime()+300000,publishedAt=due?job.scheduledAt:now;
 job.status='게시 확인됨';job.updatedAt=now;job.message='써즈님이 게시글 링크를 확인해 기록했어요.';
 job.receipt={...(job.receipt||{}),outcome:'published',method:'manual',postUrl,publishedAt,confirmedAt:now};
 item.status='게시됨';item.url=postUrl;item.publishedAt=publishedAt;item.date=publishingDay(publishedAt);item.updatedAt=now;job.revision=await publicationRevision(item,state,hash);
 return {job};
}
