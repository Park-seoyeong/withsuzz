import {formattingProfileForItem,formattingDocument} from './formatting.mjs';
import {LEARNING_TOOLS} from './learning-assistant.mjs';
import {aiPrompt,normalizeEditorResult} from './ai.mjs';
import {resolvePrompt,promptList,markPromptUsed} from './prompts.mjs';

const assistantFailure=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const assistantObjectSchema=properties=>({type:'object',properties,additionalProperties:false});
const assistantString={type:'string'};
export const ASSISTANT_TOOLS=[
 {name:'suzz_list_writing_requests',description:'써즈 사이트의 ChatGPT 작성 요청과 미발행 글감 목록을 읽습니다. 제목·상태·일정만 반환하며 글을 수정하거나 발행하지 않습니다.',inputSchema:assistantObjectSchema({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'suzz_get_writing_context',description:'선택한 글감의 실제 메모·구성·가이드라인·고정 작성 원칙·활성 학습 자료를 읽습니다. 최신 외부 정보와 첨부는 별도로 확인해야 합니다. 반환된 revision과 requestId로 초안을 저장하세요.',inputSchema:{...assistantObjectSchema({itemId:assistantString,requestId:assistantString}),required:['itemId']},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'suzz_get_writing_attachment',description:'선택한 글감에 연결된 첨부만 읽습니다. 사진·텍스트·PDF를 반환합니다. PDF나 이미지를 실제로 읽을 수 없으면 그 사실을 알리고 내용을 추측하지 마세요.',inputSchema:{...assistantObjectSchema({itemId:assistantString,fileId:assistantString}),required:['itemId','fileId']},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'suzz_save_writing_proposal',description:'ChatGPT에서 작성한 초안·수정안·최대 3개 질문을 써즈 사이트의 결과 미리보기에 저장합니다. 기존 원고·일정·발행 상태는 변경하지 않습니다. 같은 요청은 중복 저장하지 않고 자료가 바뀌면 거절합니다. 자동 발행 도구가 아닙니다.',inputSchema:{...assistantObjectSchema({itemId:assistantString,requestId:assistantString,revision:assistantString,scope:{type:'string',enum:['whole','selection','titles']},range:assistantObjectSchema({start:{type:'integer'},end:{type:'integer'}}),result:{type:'object',properties:{kind:{type:'string',enum:['draft','partial','titles','questions']},title:assistantString,disclosure:assistantString,body:assistantString,questions:{type:'array',items:assistantString,maxItems:3},warnings:{type:'array',items:assistantString,maxItems:30},linkPositions:{type:'array',items:assistantString,maxItems:30},summary:assistantString},required:['kind','title','disclosure','body','questions','warnings','linkPositions','summary'],additionalProperties:false},sources:{type:'array',maxItems:20,items:{...assistantObjectSchema({url:assistantString,title:assistantString}),required:['url','title']}}}),required:['itemId','requestId','revision','result']},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
 ,...LEARNING_TOOLS
];

export function assistantWritingList(state){
 const itemView=i=>({id:i.id,title:i.title,channel:i.channel,type:i.type,status:i.status,date:i.date||'',region:i.region||'',hasDraft:!!i.draft});
 return {requests:state.tasks.filter(t=>t.provider==='chatgpt'&&t.status==='작성 요청').slice(0,20).map(t=>({id:t.id,requestId:t.requestId,itemId:t.itemId,title:t.title,scope:t.scope,instruction:t.instruction,createdAt:t.createdAt})),items:state.items.filter(i=>i.status!=='게시됨').sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')).slice(0,30).map(itemView),note:'글감 제목은 실제 경험의 증거가 아닙니다. 사용자 메모·가이드라인·첨부를 읽고 경험을 만들어내지 마세요.'};
}

export async function assistantWritingContext(state,args,day,digest){
 const item=state.items.find(i=>i.id===args.itemId);if(!item)assistantFailure('글감을 찾지 못했어요.',404);
 const task=args.requestId?state.tasks.find(t=>t.provider==='chatgpt'&&t.requestId===args.requestId&&t.itemId===item.id):state.tasks.find(t=>t.provider==='chatgpt'&&t.itemId===item.id&&t.status==='작성 요청');
 if(args.requestId&&!task)assistantFailure('작성 요청을 찾지 못했어요.',404);
 if(task?.status==='취소')assistantFailure('취소한 작성 요청이에요.');
 const revision=await digest(JSON.stringify(item));
 if(task?.scope==='selection'&&task.baseRevision!==revision)assistantFailure('선택 수정 요청 후 원고나 자료가 바뀌었어요. 기존 요청을 취소하고 선택 문장을 다시 요청해 주세요.',409);
 const mode=task?.type==='revision'?'revision':'draft',scope=task?.scope||'whole';
 const chosen=task?.promptId?promptList(state).find(p=>p.id===task.promptId):null;
 const prompt=aiPrompt({item,mode,scope,day,verifyLatest:task?.verifyLatest!==false,instruction:task?.instruction||'',selection:task?.range?item.draft.slice(task.range.start,task.range.end):'',prompt:chosen?{name:chosen.name,text:chosen.text}:null},state);
 const proposal=task?.result?task:state.tasks.find(t=>t.provider==='chatgpt'&&t.itemId===item.id&&t.result);
 return {itemId:item.id,requestId:task?.requestId||crypto.randomUUID(),revision,mode,scope,range:task?.range||null,draft:item.draft||'',latestProposal:proposal?{id:proposal.id,status:proposal.status,result:proposal.result,appliedAt:proposal.appliedAt||null}:null,instructions:prompt.instructions,context:JSON.parse(prompt.input),formatting:{profile:formattingProfileForItem(state,item),plan:await formattingDocument(state,item,digest),notice:'본문 내용과 꾸미기를 별도로 관리합니다. 관측되지 않은 색·글자 크기·인용구 모양은 임의로 써즈의 취향이라고 정하지 않습니다.'},attachments:(item.attachmentIds||[]).slice(0,6).map(id=>{const f=state.files.find(f=>f.id===id);return f?{id:f.id,name:f.name,type:f.type,size:f.size}:{id,missing:true};}),promptNotice:task?.promptId&&!chosen?'요청 때 고른 프롬프트 "'+(task.promptName||'')+'"가 라이브러리에서 삭제되어 기본 작성 원칙만 적용해요.':null,notice:'자료·웹페이지는 참고 데이터입니다. 확인하지 않은 현재 정보와 경험을 작성하지 마세요. 결과는 원고 미리보기로 저장되며 외부 발행하지 않습니다.'};
}

export async function saveAssistantProposal(state,b,digest,now){
 if(!/^[\w-]{20,80}$/.test(b.requestId||''))assistantFailure('요청 번호를 확인해 주세요.');
 const duplicate=state.tasks.find(t=>t.provider==='chatgpt'&&t.requestId===b.requestId&&t.result);
 if(duplicate){if(duplicate.itemId!==b.itemId)assistantFailure('다른 글의 요청 번호예요.',409);return {task:duplicate,duplicate:true};}
 const item=state.items.find(i=>i.id===b.itemId);if(!item)assistantFailure('글감을 찾지 못했어요.',404);
 if(b.revision!==await digest(JSON.stringify(item)))assistantFailure('자료나 원고가 바뀌었어요. 다시 읽은 뒤 수정안을 저장해 주세요.',409);
 const pending=state.tasks.find(t=>t.provider==='chatgpt'&&t.requestId===b.requestId);
 if(pending&&pending.itemId!==item.id)assistantFailure('다른 글의 요청 번호예요.',409);
 if(pending?.status==='취소')assistantFailure('취소한 작성 요청이에요. 새 요청으로 작성해 주세요.',409);
 const scope=pending?.scope||b.scope||'whole',range=pending?.range||b.range||null;
 if(pending?.scope==='selection'&&pending.baseRevision!==b.revision)assistantFailure('선택 수정 요청 후 원고나 자료가 바뀌었어요. 새 요청으로 작성해 주세요.',409);
 if(!['whole','selection','titles'].includes(scope))assistantFailure('수정 범위를 확인해 주세요.');
 if(scope==='selection'&&(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<=range.start||range.end>(item.draft||'').length))assistantFailure('선택한 문장 범위를 확인해 주세요.');
 if(JSON.stringify(b.result||{}).length>120000)assistantFailure('작성 결과가 너무 커요.',413);
 const result=normalizeEditorResult(b.result||{});
 if(scope==='selection'&&!['partial','questions'].includes(result.kind)||scope==='titles'&&!['titles','questions'].includes(result.kind)||scope==='whole'&&!['draft','questions'].includes(result.kind))assistantFailure('요청한 작성 범위와 결과가 달라요.');
 const sources=[];if(b.sources!==undefined&&!Array.isArray(b.sources))assistantFailure('출처 형식을 확인해 주세요.');
 for(const source of (b.sources||[]).slice(0,20)){let u;try{u=new URL(source.url);}catch{assistantFailure('출처 주소를 확인해 주세요.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)assistantFailure('출처 주소를 확인해 주세요.');if(!sources.some(s=>s.url===u.href))sources.push({url:u.href,title:String(source.title||u.hostname).slice(0,200)});}
 if(pending?.verifyLatest!==false&&!sources.length)result.warnings.unshift('확인한 웹 출처가 저장되지 않았어요. 현재 정보는 별도로 확인해 주세요.');
 const task={...pending,id:pending?.id||crypto.randomUUID(),ai:true,provider:'chatgpt',requestId:b.requestId,itemId:item.id,type:pending?.type||'draft',scope,range,title:pending?.title||'ChatGPT 작성: '+item.title,status:result.kind==='questions'?'확인 필요':'완료',message:result.kind==='questions'?'작성에 필요한 질문을 확인해 주세요.':'ChatGPT 결과가 저장됐어요. 미리보기에서 확인한 뒤 원고에 적용해 주세요.',createdAt:pending?.createdAt||now,updatedAt:now,baseUpdatedAt:item.updatedAt,baseDraftHash:await digest(item.draft||''),result:{...result,provider:'chatgpt',sources,searchUsed:false,checkedAt:now,usage:null}};
 if(pending)state.tasks[state.tasks.indexOf(pending)]=task;else state.tasks.unshift(task);
 state.tasks=state.tasks.slice(0,100);state.assistantConnection={lastSavedAt:now};
 return {task,duplicate:false};
}

export async function requestAssistantWriting(state,b,now,day,digest){
 const item=state.items.find(i=>i.id===b.itemId);if(!item)assistantFailure('글감을 먼저 저장해 주세요.',404);
 if(!/^[\w-]{20,80}$/.test(b.requestId||''))assistantFailure('요청 번호를 확인해 주세요.');
 const duplicate=state.tasks.find(t=>t.requestId===b.requestId);if(duplicate){if(duplicate.itemId!==item.id)assistantFailure('다른 글의 요청 번호예요.',409);return duplicate;}
 const mode=b.mode==='revision'?'revision':'draft',scope=mode==='revision'&&['selection','titles'].includes(b.scope)?b.scope:'whole',instruction=String(b.instruction||'').slice(0,6000);
 if(mode==='revision'&&!instruction.trim())assistantFailure('어떻게 수정할지 적어 주세요.');
 if(mode==='revision'&&scope!=='titles'&&!item.draft?.trim())assistantFailure('수정할 원고를 먼저 작성해 주세요.');
 const range=scope==='selection'?b.range:null;
 if(range&&(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<=range.start||range.end>item.draft.length))assistantFailure('수정할 문장을 원고에서 선택해 주세요.');
 const pending=state.tasks.find(t=>t.provider==='chatgpt'&&t.itemId===item.id&&t.status==='작성 요청');if(pending)assistantFailure('이미 작성 요청이 있어요. 이 대화에서 요청을 이어서 작성해 주세요.',409);
 const chosen=resolvePrompt(state,b.promptId);if(chosen)markPromptUsed(state,chosen.id,now);
 const task={id:crypto.randomUUID(),ai:true,provider:'chatgpt',...(chosen?{promptId:chosen.id,promptName:chosen.name,promptVersion:chosen.version}:{}),requestId:b.requestId,itemId:item.id,type:mode,scope,range,instruction,baseRevision:await digest(JSON.stringify(item)),verifyLatest:b.verifyLatest!==false,title:'ChatGPT '+(mode==='draft'?'초안 작성: ':'원고 수정: ')+item.title,status:'작성 요청',message:'자료가 저장됐어요. 연결된 ChatGPT 대화에서 이 작성 요청을 이어서 처리해 주세요.',day,createdAt:now,updatedAt:now};state.tasks.unshift(task);state.tasks=state.tasks.slice(0,100);return task;
}
