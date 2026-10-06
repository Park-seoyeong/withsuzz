// 써즈의 프롬프트 라이브러리: 다른 프로젝트에서 쓰던 프롬프트를 사이트 안에 보관하고 글쓰기에서 골라 쓴다.
// 고정 편집 정책(editor-policy)보다 우선하지 않으며, 충돌하면 고정 정책을 따른다.
export const PROMPT_LIMITS={count:40,name:60,text:20000,note:300};
const promptError=(message,status=400)=>Object.assign(new Error(message),{status});
const clip=(v,n)=>String(v??'').slice(0,n);
export function promptList(state){return Array.isArray(state.prompts)?state.prompts:[];}
export function savePrompt(state,input={},now=new Date().toISOString()){
 if(!Array.isArray(state.prompts))state.prompts=[];
 const name=clip(input.name,PROMPT_LIMITS.name).trim(),text=clip(input.text,PROMPT_LIMITS.text).trim(),note=clip(input.note,PROMPT_LIMITS.note).trim();
 const types=Array.isArray(input.types)?[...new Set(input.types.map(String))].filter(Boolean).slice(0,10):[];
 if(!name)throw promptError('프롬프트 이름을 입력해 주세요.');
 if(!text)throw promptError('프롬프트 내용을 입력해 주세요.');
 if(String(input.text??'').trim().length>PROMPT_LIMITS.text)throw promptError('프롬프트는 '+PROMPT_LIMITS.text.toLocaleString('ko-KR')+'자 이하로 줄여 주세요.',413);
 let p=input.id?state.prompts.find(x=>x.id===input.id):null;
 if(input.id&&!p)throw promptError('수정할 프롬프트를 찾지 못했어요.',404);
 if(state.prompts.some(x=>x!==p&&x.name===name))throw promptError('같은 이름의 프롬프트가 이미 있어요.',409);
 if(!p){if(state.prompts.length>=PROMPT_LIMITS.count)throw promptError('프롬프트는 '+PROMPT_LIMITS.count+'개까지 보관할 수 있어요. 쓰지 않는 프롬프트를 정리해 주세요.',413);p={id:crypto.randomUUID(),createdAt:now,uses:0,version:0};state.prompts.push(p);}
 if(p.text!==text)p.version=(p.version||0)+1;
 Object.assign(p,{name,text,note,types,updatedAt:now});
 if(input.isDefault===true){for(const x of state.prompts)x.isDefault=x===p;}else if(input.isDefault===false)p.isDefault=false;
 return p;
}
export function deletePrompt(state,id){
 const list=promptList(state),index=list.findIndex(x=>x.id===id);if(index<0)throw promptError('삭제할 프롬프트를 찾지 못했어요.',404);
 const [removed]=list.splice(index,1);return removed;
}
// 요청 시점의 프롬프트 내용을 고정해 둔다. 이후 라이브러리를 고쳐도 진행 중인 요청은 바뀌지 않는다.
export function resolvePrompt(state,promptId){
 if(!promptId)return null;
 const p=promptList(state).find(x=>x.id===promptId);if(!p)throw promptError('선택한 프롬프트를 찾지 못했어요. 관리자 설정의 프롬프트 라이브러리를 확인해 주세요.',404);
 return {id:p.id,name:p.name,version:p.version||1,text:p.text};
}
export function markPromptUsed(state,promptId,now=new Date().toISOString()){const p=promptList(state).find(x=>x.id===promptId);if(p){p.uses=(p.uses||0)+1;p.lastUsedAt=now;}}
export function defaultPromptFor(state,type){return promptList(state).find(p=>p.isDefault&&(!p.types?.length||p.types.includes(type)))||null;}
