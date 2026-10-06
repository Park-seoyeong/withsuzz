import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {aiProvider,claudeRequest,parseClaudeMessage,CLAUDE_DEFAULT_MODEL} from '../worker/ai.mjs';
import {initialState} from '../worker/domain.mjs';

const result={kind:'draft',title:'일본 면세 쇼핑 변경 안내',disclosure:'',body:'안녕하세요, 써즈입니다.\n\n공식 안내로 확인한 내용만 정리했어요.',questions:[],warnings:[],linkPositions:[],summary:'공식 안내 기준 초안'};
const message=(over={})=>({id:'msg_test',type:'message',role:'assistant',model:CLAUDE_DEFAULT_MODEL,stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:40,output_tokens:20},content:[
 {type:'server_tool_use',id:'srvtoolu_1',name:'web_search',input:{query:'일본 면세 제도 변경'}},
 {type:'web_search_tool_result',tool_use_id:'srvtoolu_1',content:[{type:'web_search_result',url:'https://www.mlit.go.jp/kankocho/tax-free/',title:'관광청 면세 안내',encrypted_content:'x'}]},
 {type:'text',text:JSON.stringify(result)}],...over});
async function fixture(env={}){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 env={ADMIN_PASSWORD:'test-password',ANTHROPIC_API_KEY:'test-claude-key',...env,DB:{prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};}}};
 const req=(path,body,cookie='')=>new Request('https://test.local'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Cookie':cookie,'oai-authenticated-user-id':'owner'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const cookie=(await worker.fetch(req('/api/login',{password:'test-password'}),env)).headers.get('Set-Cookie').split(';')[0];
 const call=async(path,b)=>{const r=await worker.fetch(req(path,b,cookie),env);return {status:r.status,data:await r.json()};};
 const item=(await call('/api/action',{action:'saveItem',item:{title:'일본 면세 쇼핑 변경',type:'issue',draft:'기존 원고'}})).data.result;
 return {env,call,item};
}
async function withFetch(fn,run){const previous=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=previous;}}
const write=(f,extra={})=>f.call('/api/ai/write',{itemId:f.item.id,mode:'draft',requestId:crypto.randomUUID(),verifyLatest:true,...extra});

test('AI 서비스 선택은 AI_PROVIDER를 따르고 없으면 기존 OpenAI 키를 먼저 쓴다',()=>{
 assert.equal(aiProvider({}),null);
 assert.equal(aiProvider({ANTHROPIC_API_KEY:'a'}),'anthropic');
 assert.equal(aiProvider({OPENAI_API_KEY:'o',ANTHROPIC_API_KEY:'a'}),'openai');
 assert.equal(aiProvider({OPENAI_API_KEY:'o',ANTHROPIC_API_KEY:'a',AI_PROVIDER:'claude'}),'anthropic');
 assert.equal(aiProvider({OPENAI_API_KEY:'o',AI_PROVIDER:'anthropic'}),null);
});

test('Claude 요청은 고정 정책을 캐시하는 system, JSON 형식, 거절 대비 fallback, 최신 확인 시 웹 검색을 담는다',()=>{
 const s=initialState(),job={item:{id:'i',title:'제목',type:'issue'},mode:'draft',scope:'whole',day:'2026-10-06',verifyLatest:true,prompt:{name:'빠른 이슈형',text:'핵심 일정부터'}};
 const body=claudeRequest(job,s,[{kind:'pdf',name:'안내.pdf',type:'application/pdf',data:'QUJD'},{kind:'image',name:'a.jpg',type:'image/jpeg',data:'QUJD'}]);
 assert.equal(body.model,'claude-opus-5-5');assert.equal(body.max_tokens,16000);
 assert.equal(body.system[0].cache_control.type,'ephemeral');assert.match(body.system[0].text,/써즈의 동네방네/);
 assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.output_config.effort,'medium');
 assert.equal(body.fallbacks,'default');assert.deepEqual(body.betas,['server-side-fallback-2026-07-01']);
 assert.deepEqual(body.tools,[{type:'web_search_20260209',name:'web_search',max_uses:5}]);
 assert.equal(body.tool_choice,undefined);assert.equal(body.thinking,undefined);
 const content=body.messages[0].content;assert.equal(content[0].type,'document');assert.equal(content.at(-1).type,'text');assert.equal(JSON.parse(content.at(-1).text).userPrompt.text,'핵심 일정부터');
 const plain=claudeRequest({...job,verifyLatest:false},s,[],{ANTHROPIC_MODEL:'claude-sonnet-5-5',ANTHROPIC_EFFORT:'high'},{structured:false});
 assert.equal(plain.tools,undefined);assert.equal(plain.model,'claude-sonnet-5-5');assert.equal(plain.output_config.effort,'high');assert.equal(plain.output_config.format,undefined);assert.match(plain.system[0].text,/JSON만 출력/);
 assert.equal(claudeRequest(job,s,[],{ANTHROPIC_EFFORT:'turbo'}).output_config.effort,'medium');
});

test('Claude 응답은 검색 결과·인용을 출처로 분리하고 거절·분량 초과·형식 오류를 성공으로 처리하지 않는다',()=>{
 const out=parseClaudeMessage(message());assert.equal(out.kind,'draft');assert.equal(out.searchUsed,true);assert.equal(out.sources[0].url,'https://www.mlit.go.jp/kankocho/tax-free/');assert.ok(out.warnings.some(w=>w.includes('검색한 페이지')));
 const cited=parseClaudeMessage(message({content:[{type:'web_search_tool_result',tool_use_id:'s',content:[]},{type:'text',text:JSON.stringify(result),citations:[{type:'web_search_result_location',url:'https://official.example/a',title:'공식'}]}]}));
 assert.equal(cited.sources[0].url,'https://official.example/a');assert.equal(cited.warnings.length,0);
 const fenced=parseClaudeMessage(message({content:[{type:'text',text:'```json\n'+JSON.stringify(result)+'\n```'}]}));assert.equal(fenced.searchUsed,false);assert.equal(fenced.title,result.title);
 assert.throws(()=>parseClaudeMessage(message({stop_reason:'refusal'})),e=>e.status===422);
 assert.throws(()=>parseClaudeMessage(message({stop_reason:'max_tokens'})),/분량/);
 assert.throws(()=>parseClaudeMessage(message({content:[{type:'text',text:'JSON이 아님'}]})),/형식/);
 const fell=parseClaudeMessage(message({model:'claude-opus-4-8',usage:{input_tokens:1,output_tokens:1,iterations:[{type:'message'},{type:'fallback_message'}]}}));assert.ok(fell.warnings.some(w=>w.includes('claude-opus-4-8')));
});

test('Claude 키만 있으면 사이트에서 바로 생성하고 결과에 서비스·모델을 남기며 원고는 적용 전까지 유지한다',async()=>{
 const f=await fixture();const calls=[];
 const done=await withFetch(async(url,init)=>{calls.push({url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)});return Response.json(message());},()=>write(f));
 assert.equal(done.status,200);assert.equal(done.data.task.status,'완료');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages?beta=true');
 assert.equal(calls[0].headers.get('x-api-key'),'test-claude-key');assert.match(calls[0].headers.get('anthropic-beta'),/server-side-fallback-2026-07-01/);
 assert.equal(calls[0].body.betas,undefined);assert.equal(calls[0].body.fallbacks,'default');
 const r=done.data.task.result;assert.equal(r.provider,'anthropic');assert.equal(r.model,'claude-opus-5-5');assert.equal(r.searchUsed,true);
 const state=(await f.call('/api/state')).data;assert.equal(state.connections.ai,true);assert.equal(state.connections.aiProviderName,'Claude');assert.equal(state.state.items[0].draft,'기존 원고');
 assert.equal(JSON.stringify(state).includes('test-claude-key'),false);
});

test('웹 검색이 pause_turn으로 멈추면 같은 대화를 이어 보내 끝까지 받는다',async()=>{
 const f=await fixture();const bodies=[];
 const done=await withFetch(async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return Response.json(bodies.length===1?message({stop_reason:'pause_turn',content:[{type:'server_tool_use',id:'s1',name:'web_search',input:{query:'q'}}]}):message());},()=>write(f));
 assert.equal(done.data.task.status,'완료');assert.equal(bodies.length,2);assert.equal(bodies[1].messages.length,2);assert.equal(bodies[1].messages[1].role,'assistant');
});

test('Claude 거절·키 오류는 실패로 기록하고, 검색+JSON 형식 거절은 형식 지정 없이 한 번만 다시 요청한다',async()=>{
 let f=await fixture();
 let done=await withFetch(async()=>Response.json(message({stop_reason:'refusal',content:[]})),()=>write(f));
 assert.equal(done.status,422);assert.equal(done.data.task.status,'실패');
 f=await fixture();
 done=await withFetch(async()=>Response.json({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}},{status:401}),()=>write(f));
 assert.equal(done.status,502);assert.match(done.data.error,/Claude 연결 키/);
 f=await fixture();const bodies=[];
 done=await withFetch(async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return bodies.length===1?Response.json({type:'error',error:{type:'invalid_request_error',message:'unsupported combination'}},{status:400}):Response.json(message());},()=>write(f));
 assert.equal(done.data.task.status,'완료');assert.equal(bodies.length,2);assert.ok(bodies[0].output_config.format);assert.equal(bodies[1].output_config.format,undefined);
 f=await fixture();let count=0;
 done=await withFetch(async()=>{count++;return Response.json({type:'error',error:{type:'invalid_request_error',message:'bad'}},{status:400});},()=>write(f,{verifyLatest:false}));
 assert.equal(count,1);assert.equal(done.data.task.status,'실패');
});
