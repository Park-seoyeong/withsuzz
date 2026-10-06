import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';

async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 const env={ADMIN_PASSWORD:'test-password',DB:{prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};}}};
 const req=(path,body,cookie='',user='owner')=>new Request('https://test.local'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Cookie':cookie,...(user?{'oai-authenticated-user-id':user}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=await worker.fetch(req('/api/login',{password:'test-password'}),env),cookie=login.headers.get('Set-Cookie').split(';')[0];
 const action=async b=>{const r=await worker.fetch(req('/api/action',b,cookie),env);return {status:r.status,data:await r.json()};};
 const mcp=async (method,params={},user='owner')=>{const r=await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:1,method,params},'',user),env);return {status:r.status,data:await r.json()};};
 const invoke=(name,args={},user='owner')=>mcp('tools/call',{name,arguments:args},user);
 const state=async()=> (await (await worker.fetch(req('/api/state',undefined,cookie),env)).json()).state;
 const item=async x=>(await action({action:'saveItem',item:{title:'사용자 실제 글감',notes:'직접 기억한 메모',...x}})).data.result;
 return {env,req,cookie,action,mcp,invoke,state,item};
}
const result={kind:'draft',title:'직접 확인한 주제',disclosure:'',body:'안녕하세요, 써즈입니다.\n\n사용자가 확인한 내용만으로 만든 초안입니다.',questions:[],warnings:[],linkPositions:[],summary:'실제 메모로 구성한 초안'};

test('MCP 발견에는 자료가 없고 사용자 없는 서비스·다른 사용자·로그아웃 후 자료 호출은 차단한다',async()=>{
 const f=await fixture();await f.item({});
 const init=await f.mcp('initialize',{protocolVersion:'2025-03-26'},'');assert.equal(init.data.result.protocolVersion,'2025-03-26');
 const discovery=await f.mcp('tools/list',{},'');assert.equal(discovery.data.result.tools.length,8);assert.equal(JSON.stringify(discovery).includes('직접 기억한 메모'),false);
 for(const user of ['', 'different-owner'])assert.equal((await f.invoke('suzz_list_writing_requests',{},user)).status,401);
 const before=await f.state();assert.equal((await f.invoke('suzz_list_writing_requests')).status,200);assert.deepEqual(await f.state(),before);
 await worker.fetch(f.req('/api/logout',{},f.cookie),f.env);assert.equal((await f.invoke('suzz_list_writing_requests')).status,401);
});

test('ChatGPT 초안 저장은 원고·일정을 보존하고 중복을 막으며 미리보기 적용·되돌리기를 재사용한다',async()=>{
 const f=await fixture(),i=await f.item({draft:'기존 원고',date:'2026-10-11'});
 const context=(await f.invoke('suzz_get_writing_context',{itemId:i.id})).data.result.structuredContent;
 assert.equal(context.context.item.notes,'직접 기억한 메모');assert.match(context.instructions,/경험/);
 const args={itemId:i.id,requestId:context.requestId,revision:context.revision,result,sources:[{url:'https://example.com/official',title:'직접 확인할 공식 정보'}]};
 const saved=(await f.invoke('suzz_save_writing_proposal',args)).data.result.structuredContent;
 assert.equal(saved.applied,false);assert.equal(saved.duplicate,false);
 const reread=(await f.invoke('suzz_get_writing_context',{itemId:i.id})).data.result.structuredContent;assert.equal(reread.latestProposal.id,saved.taskId);assert.equal(reread.latestProposal.result.body,result.body);assert.equal(reread.draft,'기존 원고');
 assert.equal((await f.invoke('suzz_save_writing_proposal',args)).data.result.structuredContent.duplicate,true);
 let state=await f.state();assert.equal(state.items[0].draft,'기존 원고');assert.equal(state.items[0].date,'2026-10-11');assert.equal(state.items[0].status,'아이디어');assert.equal(state.tasks.filter(t=>t.provider==='chatgpt').length,1);assert.equal(state.tasks[0].result.searchUsed,false);
 assert.equal((await worker.fetch(f.req('/api/ai/apply',{taskId:saved.taskId},f.cookie),f.env)).status,200);
 state=await f.state();assert.match(state.items[0].draft,/사용자가 확인한/);assert.equal(state.items[0].status,'초안 작성');
 assert.equal((await worker.fetch(f.req('/api/ai/undo',{taskId:saved.taskId},f.cookie),f.env)).status,200);assert.equal((await f.state()).items[0].draft,'기존 원고');
});

test('자료를 수정한 뒤 오래된 ChatGPT 결과 저장을 거절하고 현재 원고를 보존한다',async()=>{
 const f=await fixture(),i=await f.item({draft:'원본'}),context=(await f.invoke('suzz_get_writing_context',{itemId:i.id})).data.result.structuredContent;
 await f.action({action:'saveItem',item:{id:i.id,title:i.title,notes:'새 경험 메모'}});
 const r=await f.invoke('suzz_save_writing_proposal',{itemId:i.id,requestId:context.requestId,revision:context.revision,result});assert.equal(r.data.result.isError,true);assert.match(r.data.result.content[0].text,/바뀌었/);assert.equal((await f.state()).items[0].draft,'원본');assert.equal((await f.state()).tasks.length,0);
});

test('사이트의 선택 수정 요청을 읽고 저장해도 적용 때 선택 문장 바깥은 그대로다',async()=>{
 const f=await fixture(),i=await f.item({draft:'앞쪽|중간|뒤쪽'}),requestId=crypto.randomUUID();
 const request={action:'requestAssistant',itemId:i.id,requestId,mode:'revision',scope:'selection',instruction:'중간만 바꿔줘',range:{start:3,end:5},verifyLatest:false};
 assert.equal((await f.action(request)).status,200);
 const context=(await f.invoke('suzz_get_writing_context',{itemId:i.id,requestId})).data.result.structuredContent;assert.equal(context.scope,'selection');assert.equal(context.context.selection,'중간');
 const saved=(await f.invoke('suzz_save_writing_proposal',{itemId:i.id,requestId,revision:context.revision,result:{...result,kind:'partial',title:'',body:'수정'}})).data.result.structuredContent;
 assert.equal((await worker.fetch(f.req('/api/ai/apply',{taskId:saved.taskId},f.cookie),f.env)).status,200);assert.equal((await f.state()).items[0].draft,'앞쪽|수정|뒤쪽');
});

test('취소된 요청은 살리지 않고 잘못된 출처·초과 질문·알 수 없는 도구를 거절한다',async()=>{
 const f=await fixture(),i=await f.item({}),requestId=crypto.randomUUID();
 const queued=(await f.action({action:'requestAssistant',itemId:i.id,requestId})).data.result;
 const context=(await f.invoke('suzz_get_writing_context',{itemId:i.id,requestId})).data.result.structuredContent;
 await f.action({action:'cancelAssistant',taskId:queued.id});
 const body={itemId:i.id,requestId,revision:context.revision,result};assert.equal((await f.invoke('suzz_save_writing_proposal',body)).data.result.isError,true);
 const fresh=(await f.invoke('suzz_get_writing_context',{itemId:i.id})).data.result.structuredContent;
 assert.equal((await f.invoke('suzz_save_writing_proposal',{...body,requestId:fresh.requestId,sources:[{url:'javascript:alert(1)',title:'금지 주소'}]})).data.result.isError,true);
 assert.equal((await f.invoke('suzz_save_writing_proposal',{...body,requestId:fresh.requestId,result:{...result,kind:'questions',questions:['1','2','3','4']}})).data.result.isError,true);
 assert.equal((await f.invoke('not-a-real-write-tool')).data.error.code,-32602);assert.equal((await f.state()).tasks[0].status,'취소');
});

test('소유자 에이전트 경로도 브라우저의 관리자 인증·Origin·허용 작업 제한을 유지한다',async()=>{
 const f=await fixture(),i=await f.item({});assert.equal((await worker.fetch(f.req('/api/editor-assistant'),f.env)).status,401);
 const r=await worker.fetch(f.req('/api/editor-assistant',undefined,'',''),f.env);assert.equal(r.status,200);const data=await r.json();assert.equal(data.items[0].id,i.id);assert.equal(data.state,undefined);assert.equal(data.items[0].draft,undefined);
 const denied=f.req('/api/editor-assistant',{tool:'suzz_save_writing_proposal',arguments:{}},'','');denied.headers.set('Origin','https://different-site.example');assert.equal((await worker.fetch(denied,f.env)).status,403);
 assert.equal((await worker.fetch(f.req('/api/editor-assistant',{tool:'deleteItem',arguments:{id:i.id}},'',''),f.env)).status,400);assert.equal((await f.state()).items.length,1);
});

test('첨부는 요청한 글감에 연결된 것만 읽고 확인 없이 다른 자료로 대체하지 않는다',async()=>{
 const f=await fixture(),i=await f.item({});const store=new Map();f.env.BUCKET={async put(key,bytes){store.set(key,bytes);},async get(key){const bytes=store.get(key);return bytes?{async arrayBuffer(){return bytes;}}:null;}};
 const form=new FormData();form.set('file',new File(['실제 메뉴판 텍스트'], 'menu.txt',{type:'text/plain'}));
 const uploaded=await worker.fetch(new Request('https://test.local/api/upload',{method:'POST',headers:{Cookie:f.cookie,'oai-authenticated-user-id':'owner'},body:form}),f.env);const file=await uploaded.json();assert.equal(uploaded.status,200);
 assert.equal((await f.invoke('suzz_get_writing_attachment',{itemId:i.id,fileId:file.id})).data.result.isError,true);
 await f.action({action:'saveItem',item:{id:i.id,title:i.title,attachmentIds:[file.id]}});
 assert.equal((await f.invoke('suzz_get_writing_attachment',{itemId:i.id,fileId:file.id})).data.result.structuredContent.text,'실제 메뉴판 텍스트');
});

test('학습 요청은 원문을 읽고 분석을 저장하며 활성 체크·원본·고정 규칙을 보존하고 중복하지 않는다',async()=>{
 const f=await fixture();const l=(await f.action({action:'saveLesson',lesson:{title:'사용자 글쓰기 자료',source:'모바일에서는 문단을 짧게 쓰고 실제 경험을 살린다.',active:false}})).data.result;
 const requestId=crypto.randomUUID();assert.equal((await f.action({action:'requestLearning',lessonId:l.id,requestId})).status,200);
 const c=(await f.invoke('suzz_get_learning_context',{lessonId:l.id})).data.result.structuredContent;assert.equal(c.source,l.source);assert.equal(c.requestId,requestId);
 const b={lessonId:l.id,requestId,revision:c.revision,summary:'짧은 모바일 문단과 실제 경험을 강조한다.',points:'문단마다 한두 가지 내용만 담는다.',apply:'써즈 원고를 의미 단위로 2~4줄씩 나눈다.',readFileIds:[],checkedURLs:[],warnings:[]};
 const before=await f.state();assert.equal((await f.invoke('suzz_save_learning_analysis',b)).data.result.structuredContent.status,'ChatGPT 분석 완료');assert.equal((await f.invoke('suzz_save_learning_analysis',b)).data.result.structuredContent.duplicate,true);
 const s=await f.state();assert.equal(s.lessons[0].active,false);assert.equal(s.lessons[0].source,l.source);assert.equal(s.lessons[0].apply,b.apply);assert.equal(s.tasks[0].status,'완료');assert.deepEqual(s.settings,before.settings);
});

test('학습 자료 변경·읽은 원문 누락·다른 첨부와 위험한 주소는 완료 분석으로 저장할 수 없다',async()=>{
 const f=await fixture(),l=(await f.action({action:'saveLesson',lesson:{title:'링크만 있는 자료',url:'https://example.com/guide',active:true}})).data.result;
 const c=(await f.invoke('suzz_get_learning_context',{lessonId:l.id})).data.result.structuredContent;
 const b={lessonId:l.id,requestId:c.requestId,revision:c.revision,summary:'요약',points:'포인트',apply:'적용점',readFileIds:[],checkedURLs:[],warnings:[]};
 for(const change of [{},{checkedURLs:['javascript:alert(1)']},{readFileIds:['not-linked']}])assert.equal((await f.invoke('suzz_save_learning_analysis',{...b,...change})).data.result.isError,true);
 await f.action({action:'saveLesson',lesson:{...l,source:'새로 추가한 실제 원문'}});
 assert.equal((await f.invoke('suzz_save_learning_analysis',{...b,checkedURLs:[l.url]})).data.result.isError,true);assert.equal((await f.state()).lessons[0].summary,'');
 const fresh=(await f.invoke('suzz_get_learning_context',{lessonId:l.id})).data.result.structuredContent;
 const saved=(await f.invoke('suzz_save_learning_analysis',{...b,requestId:fresh.requestId,revision:fresh.revision,warnings:['원본 링크는 접근이 차단됐어요. 텍스트만 분석했어요.']})).data.result.structuredContent;
 assert.equal(saved.status,'자료 일부 확인');const lesson=(await f.state()).lessons[0];assert.equal(lesson.active,true);assert.match(lesson.analysis.warnings.join(' '),/직접 확인하지/);
});
