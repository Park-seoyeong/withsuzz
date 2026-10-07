import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {savePrompt,deletePrompt,resolvePrompt,defaultPromptFor,PROMPT_LIMITS} from '../worker/prompts.mjs';
import {aiPrompt} from '../worker/ai.mjs';
import {initialState,brief} from '../worker/domain.mjs';

const modelResult={kind:'draft',title:'프롬프트 반영 제목',disclosure:'',body:'안녕하세요, 써즈입니다.\n\n고른 프롬프트대로 작성했어요.',questions:[],warnings:[],linkPositions:[],summary:'프롬프트 적용 초안'};
const modelResponse={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(modelResult),annotations:[]}]}],usage:{input_tokens:10,output_tokens:10}};
async function fixture(env={}){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 env={ADMIN_PASSWORD:'test-password',...env,DB:{prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};}}};
 const req=(path,body,cookie='',user='owner')=>new Request('https://test.local'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Cookie':cookie,...(user?{'oai-authenticated-user-id':user}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const cookie=(await worker.fetch(req('/api/login',{password:'test-password'}),env)).headers.get('Set-Cookie').split(';')[0];
 const call=async(path,b)=>{const r=await worker.fetch(req(path,b,cookie),env);return {status:r.status,data:await r.json()};};
 const action=b=>call('/api/action',b);
 const state=async()=>(await call('/api/state')).data.state;
 const item=(await action({action:'saveItem',item:{title:'후쿠오카 맛집 후기',type:'review',notes:'직접 먹은 메뉴만 써 주세요.',draft:'기존 원고'}})).data.result;
 return {env,req,cookie,call,action,state,item};
}

test('프롬프트 저장은 이름·내용·개수·중복 이름을 검사하고 내용이 바뀔 때만 버전을 올린다',()=>{
 const s=initialState();
 assert.throws(()=>savePrompt(s,{name:'',text:'x'}),/이름/);
 assert.throws(()=>savePrompt(s,{name:'a',text:'  '}),/내용/);
 assert.throws(()=>savePrompt(s,{name:'a',text:'x'.repeat(PROMPT_LIMITS.text+1)}),/줄여/);
 const p=savePrompt(s,{name:'맛집 기본형',text:'메뉴 중심으로',types:['review','review','sponsor'],isDefault:true});
 assert.equal(p.version,1);assert.deepEqual(p.types,['review','sponsor']);
 assert.equal(savePrompt(s,{id:p.id,name:'맛집 기본형',text:'메뉴 중심으로'}).version,1);
 assert.equal(savePrompt(s,{id:p.id,name:'맛집 기본형',text:'메뉴와 동선 중심으로'}).version,2);
 assert.throws(()=>savePrompt(s,{name:'맛집 기본형',text:'다른 내용'}),/같은 이름/);
 const q=savePrompt(s,{name:'날씨형',text:'평균과 예보 구분',isDefault:true});
 assert.equal(p.isDefault,false);assert.equal(q.isDefault,true);
 assert.equal(defaultPromptFor(s,'info').id,q.id);
 savePrompt(s,{id:q.id,name:'날씨형',text:'평균과 예보 구분',types:['info']});
 assert.equal(defaultPromptFor(s,'review'),null);
 assert.throws(()=>resolvePrompt(s,'missing'),/찾지 못했/);
 assert.equal(resolvePrompt(s,''),null);
 deletePrompt(s,p.id);assert.equal(s.prompts.length,1);
 assert.throws(()=>deletePrompt(s,p.id),/찾지 못했/);
 for(let n=s.prompts.length;n<PROMPT_LIMITS.count;n++)savePrompt(s,{name:'p'+n,text:'t'});
 assert.throws(()=>savePrompt(s,{name:'초과',text:'t'}),/까지/);
});

test('고른 프롬프트는 고정 원칙 뒤의 참고 데이터로 들어가고 작성 프롬프트 복사에도 포함된다',()=>{
 const s=initialState(),item={id:'i',title:'제목',type:'review'};
 const p=aiPrompt({item,mode:'draft',scope:'whole',day:'2026-10-06',verifyLatest:false,instruction:'',prompt:{name:'맛집 기본형',text:'메뉴별 비중을 맞춰 줘'}},s);
 assert.deepEqual(JSON.parse(p.input).userPrompt,{name:'맛집 기본형',text:'메뉴별 비중을 맞춰 줘'});
 assert.match(p.instructions,/userPrompt가 있으면/);assert.match(p.instructions,/고정 규칙을 따르고/);
 assert.equal(JSON.parse(aiPrompt({item,mode:'draft',scope:'whole',day:'2026-10-06'},s).input).userPrompt,null);
 const text=brief(item,'기본 원칙',[],{name:'맛집 기본형',text:'메뉴별 비중을 맞춰 줘'});
 assert.match(text,/내 추가 프롬프트 \(맛집 기본형\):\n메뉴별 비중을 맞춰 줘/);assert.match(text,/필수 작성 규칙을 따른다/);
 assert.doesNotMatch(brief(item,'기본 원칙',[]),/내 추가 프롬프트/);
});

test('사이트 즉시 생성은 요청 시점의 프롬프트를 보내고 결과에 프롬프트 이름을 남긴다',async()=>{
 const f=await fixture({OPENAI_API_KEY:'test-provider-key'});
 const saved=await f.action({action:'savePrompt',prompt:{name:'맛집 기본형',text:'메뉴별 비중을 맞춰 줘'}});assert.equal(saved.status,200);
 const promptId=saved.data.result.id;
 const missing=await f.call('/api/ai/write',{itemId:f.item.id,mode:'draft',requestId:crypto.randomUUID(),verifyLatest:false,promptId:'not-a-prompt'});
 assert.equal(missing.status,404);assert.equal((await f.state()).tasks.length,0);
 let sent;const previous=globalThis.fetch;globalThis.fetch=async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json(modelResponse);};
 let done;try{done=await f.call('/api/ai/write',{itemId:f.item.id,mode:'draft',requestId:crypto.randomUUID(),verifyLatest:false,promptId});}finally{globalThis.fetch=previous;}
 assert.equal(done.status,200);assert.equal(done.data.task.promptName,'맛집 기본형');assert.equal(done.data.task.promptVersion,1);
 const input=JSON.parse(sent.input[0].content[0].text);assert.equal(input.userPrompt.text,'메뉴별 비중을 맞춰 줘');
 const s=await f.state();assert.equal(s.prompts[0].uses,1);assert.equal(s.items[0].draft,'기존 원고');
 const copied=await f.call('/api/brief',{item:{title:'후쿠오카 맛집 후기',type:'review'},promptId});assert.match(copied.data.text,/메뉴별 비중을 맞춰 줘/);
 const removed=await f.action({action:'deletePrompt',id:promptId});assert.equal(removed.status,200);
 assert.equal((await f.state()).tasks[0].promptName,'맛집 기본형');
});

test('ChatGPT 작성 요청도 고른 프롬프트를 읽고, 삭제되면 기본 원칙만 적용한다고 알린다',async()=>{
 const f=await fixture();
 const promptId=(await f.action({action:'savePrompt',prompt:{name:'후기 흐름형',text:'선택 고민부터 시작해 줘'}})).data.result.id;
 const requestId=crypto.randomUUID();
 const task=(await f.action({action:'requestAssistant',itemId:f.item.id,requestId,mode:'draft',promptId})).data.result;
 assert.equal(task.promptId,promptId);assert.equal(task.promptName,'후기 흐름형');
 const mcp=async args=>(await (await worker.fetch(f.req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'suzz_get_writing_context',arguments:args}},'','owner'),f.env)).json()).result.structuredContent;
 let context=await mcp({itemId:f.item.id,requestId});
 assert.equal(context.context.userPrompt.text,'선택 고민부터 시작해 줘');assert.equal(context.promptNotice,null);
 await f.action({action:'deletePrompt',id:promptId});
 context=await mcp({itemId:f.item.id,requestId});
 assert.equal(context.context.userPrompt,null);assert.match(context.promptNotice,/후기 흐름형/);
 await f.action({action:'cancelAssistant',taskId:task.id});
 assert.equal((await f.action({action:'requestAssistant',itemId:f.item.id,requestId:crypto.randomUUID(),mode:'draft',promptId:'gone'})).status,404);
 assert.equal((await f.state()).tasks.filter(t=>t.status==='작성 요청').length,0);
});

test('써즈 프롬프트 전문은 한 번만 설치되고 기본 프롬프트가 되며, 초안 요청에 들어간다',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{readFileSync}=await import('node:fs'),{default:worker}=await import('../dist/server/index.js');
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));const prompts=[];
 const env={ARTIFACT:'1',SAMPLE:{json:async input=>{prompts.push(input);return {kind:'draft',title:'t',disclosure:'',body:'b',questions:[],warnings:[],linkPositions:[],summary:''};},limits:async()=>({})},DB:{prepare(q){let a=[];return {bind(...x){a=x;return this;},async first(){return sql.prepare(q).get(...a)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...a).changes}};}};}}};
 const call=async(p,b)=>{const r=await worker.fetch(new Request('https://t.local'+p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}),env);return r.json();};
 assert.equal((await call('/api/action',{action:'installSuzzPrompt'})).result.installed,true);
 assert.equal((await call('/api/action',{action:'installSuzzPrompt'})).result.installed,false);
 const st=(await call('/api/state')).state;assert.equal(st.prompts.length,1);assert.equal(st.prompts[0].isDefault,true);assert.match(st.prompts[0].text,/## 8\. 써즈 말투/);assert.ok(st.prompts[0].text.length>8000);
 const it=(await call('/api/action',{action:'saveItem',item:{title:'글',channel:'blog'}})).result;
 await call('/api/ai/write',{requestId:'r-'+'z'.repeat(24),itemId:it.id,mode:'draft',promptId:st.prompts[0].id});
 assert.match(prompts.at(-1),/써즈 말투/);
});
