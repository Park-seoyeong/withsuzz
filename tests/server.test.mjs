import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
const database=()=>{const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));return {prepare(q){let args=[];return {bind(...a){args=a;return this},async first(){return sql.prepare(q).get(...args)||null},async run(){const result=sql.prepare(q).run(...args);return {meta:{changes:result.changes}}}}}}};
async function session(){const env={DB:database(),ADMIN_PASSWORD:'only-for-tests'};const r=await worker.fetch(new Request('https://test.local/api/login',{method:'POST',headers:{'oai-authenticated-user-id':'owner','Content-Type':'application/json'},body:JSON.stringify({password:'only-for-tests'})}),env);assert.equal(r.status,200);return {env,cookie:r.headers.get('Set-Cookie').split(';')[0]};}
const request=(path,body,cookie='',id='owner')=>new Request('https://test.local'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':id,'Cookie':cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('발행 준비는 관리자 인증·이미지 범위를 유지하고 접근 미확인 상태를 성공으로 표시하지 않는다',async()=>{
 const {env,cookie}=await session();
 const save=await (await worker.fetch(request('/api/action',{action:'saveItem',item:{title:'준비할 실제 원고',draft:'확인한 내용만 적었습니다.',channel:'blog',type:'info'}},cookie),env)).json();
 const itemId=save.result.id,body={action:'preparePublication',itemId,requestId:crypto.randomUUID(),scheduledAt:'2099-10-07T09:00',reviewed:true,images:[]};
 assert.equal((await worker.fetch(request('/api/action',body),env)).status,401);
 const prepared=await (await worker.fetch(request('/api/action',body,cookie),env)).json();assert.equal(prepared.result.status,'준비 중');assert.ok(prepared.result.issues.some(x=>x.includes('글쓰기')));
 assert.equal((await worker.fetch(request('/api/publishing-agent'),env)).status,401);
 let r=await worker.fetch(request('/api/publishing-agent',null,'',''),env),overview=await r.json();assert.equal(overview.editorReady,false);assert.equal(overview.jobs.length,1);assert.equal(overview.jobs[0].body,undefined);assert.equal(overview.state,undefined);
 const image=await worker.fetch(request('/api/publishing-agent',{op:'image',jobId:prepared.result.jobId,fileId:'unrelated'},'',''),env);assert.equal(image.status,403);
 const req=request('/api/publishing-agent',{op:'access',runUrl:'https://agent.tinyfish.ai/runs/7b9a3d97-e183-4b18-ab56-ed3f5ac05463'},cookie);req.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(req,env)).status,403);
 assert.equal((await worker.fetch(request('/api/publishing-agent',{op:'changeSettings'},'',''),env)).status,400);
 const state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json());assert.equal(state.publishing.jobs.length,1);assert.equal(state.state.items[0].status,'아이디어');assert.equal(state.state.xp,0);assert.equal(state.state.naverStats,undefined);
});
test('사진 없는 준비는 취소 가능하며 새벽 자동 글과 직접 작업 상한을 분리한다',async()=>{
 const {env,cookie}=await session();const post=x=>worker.fetch(request('/api/action',x,cookie),env);
 for(let n=0;n<4;n++)assert.equal((await post({action:'saveItem',item:{title:'직접 '+n,date:'2099-10-07'}})).status,200);
 const auto=await post({action:'saveItem',item:{title:'아시아 이슈',type:'issue',channel:'blog',automaticLane:'asia-issue',date:'2099-10-07'}});assert.equal(auto.status,200);const item=(await auto.json()).result;assert.equal(item.automatic,true);
 assert.equal((await post({action:'saveItem',item:{title:'잘못된 구분',type:'review',automaticLane:'brand-shopping'}})).status,400);
 const queue=await (await post({action:'preparePublication',itemId:item.id,lane:'asia-issue',requestId:crypto.randomUUID(),scheduledAt:'2099-10-07T01:00',images:[]})).json();assert.ok(queue.result.issues.some(x=>x.includes('사진')));
 assert.equal((await post({action:'cancelPublication',jobId:queue.result.jobId})).status,200);
 const state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.items.length,5);assert.equal(state.items.find(i=>i.id===item.id).date,'2099-10-07');assert.equal(state.publishJobs[0].status,'취소');
});
test('private dispatch 뒤의 통계 전용 갱신은 중복 저장을 막고 실패시 수치를 보존한다',async()=>{const {env,cookie}=await session();const snapshot={blogId:'withsuzz',observedAt:'2026-10-06T00:00:00Z',runUrl:'https://agent.tinyfish.ai/runs/7b9a3d97-e183-4b18-ab56-ed3f5ac05463',visitors:[{date:'2026-10-05',count:12}],keywordDate:'2026-10-05',keywords:[],pageViews:null};const body={kind:'snapshot',snapshot};assert.equal((await worker.fetch(request('/api/naver-sync',body),env)).status,401);let r=await worker.fetch(request('/api/naver-sync',body,'',''),env);assert.equal(r.status,200);assert.equal((await r.json()).saved,true);r=await worker.fetch(request('/api/naver-sync',body,'',''),env);assert.equal((await r.json()).duplicate,true);await worker.fetch(request('/api/naver-sync',{kind:'failure',message:'네이버 재로그인 필요'},'',''),env);const data=await (await worker.fetch(request('/api/naver-sync',null,'',''),env)).json();assert.equal(data.snapshot.visitors[0].count,12);assert.equal(data.sync.status,'확인 필요');assert.equal(data.state,undefined);assert.equal((await worker.fetch(request('/api/state',null,'',''),env)).status,401);});
test('네이버 통계 저장은 인증·검증 후 수행하며 글별 성과와 분리한다',async()=>{const {env,cookie}=await session();const snapshot={blogId:'withsuzz',observedAt:'2026-10-05T12:00:00Z',runUrl:'https://agent.tinyfish.ai/runs/7b9a3d97-e183-4b18-ab56-ed3f5ac05463',visitors:[{date:'2026-10-04',count:613}],keywordDate:'2026-10-05',keywords:[{keyword:'대련 날씨',percentage:1.15}],pageViews:{date:'2026-10-05',count:723}};const save=x=>request('/api/action',{action:'importNaver',snapshot:x},cookie);assert.equal((await worker.fetch(request('/api/action',{action:'importNaver',snapshot}),env)).status,401);assert.equal((await worker.fetch(save(snapshot),env)).status,200);assert.equal((await worker.fetch(save(snapshot),env)).status,200);let state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.naverStats.visitors.length,1);assert.equal(state.metrics.length,0);assert.equal(state.connections.naver,false);for(const bad of [{...snapshot,keywords:[{keyword:'bad',percentage:101}]},{...snapshot,visitors:[{date:'2026-02-30',count:1}]},{...snapshot,observedAt:'2026-10-04T12:00:00Z'},{...snapshot,blogId:'another'}])assert.equal((await worker.fetch(save(bad),env)).status,400);state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.naverStats.pageViews.count,723);});
test('未로그인 API와 정적 앱 코드를 보호한다',async()=>{const env={DB:database(),ADMIN_PASSWORD:'only-for-tests'};assert.equal((await worker.fetch(request('/api/state'),env)).status,401);const res=await worker.fetch(request('/app.js'),env);assert.match(await res.text(),/관리자 비밀번호/);});
test('비밀번호 실패와 사이트 소유자 인증 누락을 거절한다',async()=>{const env={DB:database(),ADMIN_PASSWORD:'only-for-tests'};assert.equal((await worker.fetch(request('/api/login',{password:'wrong'}),env)).status,401);assert.equal((await worker.fetch(request('/api/login',{password:'only-for-tests'},'',''),env)).status,401);});
test('세션을 다른 사용자에게 재사용할 수 없다',async()=>{const {env,cookie}=await session();assert.equal((await worker.fetch(request('/api/state',null,cookie,'other'),env)).status,401);});
test('글감 저장과 재조회, 경험치 중복 방지',async()=>{const {env,cookie}=await session();let r=await worker.fetch(request('/api/action',{action:'saveItem',item:{title:'실제 글감',channel:'blog',type:'review',prep:{photos:true,outline:true}}},cookie),env);assert.equal(r.status,200);const saved=await r.json();const id=saved.result.id;await worker.fetch(request('/api/action',{action:'saveItem',item:{id,title:'실제 글감',status:'게시됨'}},cookie),env);await worker.fetch(request('/api/action',{action:'saveItem',item:{id,title:'실제 글감',status:'게시됨'}},cookie),env);r=await worker.fetch(request('/api/state',null,cookie),env);const {state}=await r.json();assert.equal(state.items.length,1);assert.equal(state.xp,45);});
test('하루 직접 작업 5번째 글은 거절한다',async()=>{const {env,cookie}=await session();for(let n=0;n<4;n++)assert.equal((await worker.fetch(request('/api/action',{action:'saveItem',item:{title:'글 '+n,date:'2026-10-09'}},cookie),env)).status,200);const r=await worker.fetch(request('/api/action',{action:'saveItem',item:{title:'초과',date:'2026-10-09'}},cookie),env);assert.equal(r.status,400);});
test('외부 Origin의 변경을 거절하고 로그아웃 후 API 접근을 차단한다',async()=>{const {env,cookie}=await session();const req=request('/api/action',{action:'saveSettings',settings:{}},cookie);req.headers.set('Origin','https://evil.example');assert.equal((await worker.fetch(req,env)).status,403);await worker.fetch(request('/api/logout',{},cookie),env);assert.equal((await worker.fetch(request('/api/state',null,cookie),env)).status,401);});
test('실행 서비스 미연결 요청을 성공으로 위장하지 않는다',async()=>{const {env,cookie}=await session();const r=await worker.fetch(request('/api/action',{action:'requestTask',type:'draft',title:'초안'},cookie),env);assert.equal(r.status,200);const data=await r.json();assert.equal(data.result.status,'확인 필요');assert.match(data.result.message,/연결/);});
test('검색어 추천은 인증된 상태에서 계산하고 선택·등록은 중복되지 않으며 연동 기록을 보존한다',async()=>{
 const {env,cookie}=await session();
 const snapshot={blogId:'withsuzz',observedAt:new Date().toISOString(),runUrl:'https://agent.tinyfish.ai/runs/7b9a3d97-e183-4b18-ab56-ed3f5ac05463',visitors:[{date:'2026-10-05',count:613}],keywordDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),keywords:[{keyword:'하코네 료칸',percentage:.86}],pageViews:null};
 const post=(body)=>worker.fetch(request('/api/action',body,cookie),env);
 await worker.fetch(request('/api/naver-sync',{kind:'schedule',automationId:'existing-test-schedule'},'',''),env);
 await worker.fetch(request('/api/naver-sync',{kind:'snapshot',snapshot},'',''),env);
 const before=await (await worker.fetch(request('/api/naver-sync',null,'',''),env)).json();
 let data=await (await worker.fetch(request('/api/state',null,cookie),env)).json();
 assert.equal(data.recommendations.ideas.length,1);
 const body={action:'chooseRecommendation',id:data.recommendations.ideas[0].id,keywordDate:snapshot.keywordDate};
 assert.equal((await worker.fetch(request('/api/action',body),env)).status,401);
 const item=(await (await post(body)).json()).result;
 const same=(await (await post(body)).json()).result;
 assert.equal(item.id,same.id);assert.equal(item.keyword,'하코네 료칸');assert.equal(item.status,'아이디어');assert.equal(item.date,'');assert.equal(item.draft,undefined);
 assert.equal(item.recommendationSource.keywords[0].percentage,.86);
 data=await (await worker.fetch(request('/api/state',null,cookie),env)).json();assert.equal(data.state.items.length,1);assert.equal(data.recommendations.ideas.length,0);assert.equal(data.recommendations.existing[0].itemId,item.id);
 assert.equal((await post({...body,keywordDate:'2001-01-01'})).status,409);
 assert.equal((await post({...body,id:'idea:nonexistent'})).status,409);
 const after=await (await worker.fetch(request('/api/naver-sync',null,'',''),env)).json();assert.deepEqual(after,before);
});
test('추천 글감의 발행일 선택도 기존 하루4개·엠바고 제한을 통과해야 한다',async()=>{
 const {env,cookie}=await session(),call=body=>worker.fetch(request('/api/action',body,cookie),env);
 for(let n=0;n<4;n++)await call({action:'saveItem',item:{title:'정해둔 글'+n,date:'2026-10-09'}});
 const item=(await (await call({action:'saveItem',item:{title:'대련 날씨',embargo:'2026-10-08T12:00:00+09:00'}})).json()).result;
 assert.equal((await call({action:'saveItem',item:{id:item.id,title:item.title,date:'2026-10-07'}})).status,400);
 assert.equal((await call({action:'saveItem',item:{id:item.id,title:item.title,date:'2026-10-09'}})).status,400);
});
test('리포트 서비스는 제한된 결과만 제공하고 중복 실행·잘못된 Origin·브라우저 미인증을 차단한다',async()=>{
 const {env,cookie}=await session();
 assert.equal((await worker.fetch(request('/api/manager-review',{kind:'daily'}),env)).status,401);
 let r=await worker.fetch(request('/api/manager-review',{kind:'daily'},'',''),env);assert.equal(r.status,200);assert.equal((await r.json()).duplicate,false);
 r=await worker.fetch(request('/api/manager-review',{kind:'daily'},'',''),env);assert.equal((await r.json()).duplicate,true);
 r=await worker.fetch(request('/api/manager-review',{kind:'weekly'},'',''),env);assert.equal(r.status,200);
 const data=await (await worker.fetch(request('/api/manager-review',null,'',''),env)).json();assert.equal(data.reports.length,2);assert.equal(data.state,undefined);assert.equal(data.memory.automatic,true);
 assert.equal((await worker.fetch(request('/api/manager-review',{kind:'wrong'},'',''),env)).status,400);
 const badOrigin=request('/api/manager-review',{kind:'daily'},'','');badOrigin.headers.set('Origin','https://evil.example');assert.equal((await worker.fetch(badOrigin,env)).status,403);
 const state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.managerReports.length,2);assert.equal(state.memory.length,1);assert.equal(state.events.filter(e=>e.kind==='report').length,2);assert.equal(state.naverStats,undefined);
});
test('재작성 API는 실제 글별 감소를 연결하고 중복 기획·무인 변경 범위·원본 보존을 검증한다',async()=>{
 const {env,cookie}=await session(),call=body=>worker.fetch(request('/api/action',body,cookie),env);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),shift=n=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 await call({action:'importNotion',data:{items:[{sourceId:'test-old',title:'교통 요금 과거 원고',channel:'blog',type:'info',status:'게시됨',date:shift(-60),publishedAt:shift(-60)+'T03:00:00Z',draft:'실제 원본',url:'https://blog.naver.com/withsuzz/123456789'}]}});
 let before=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state,original=before.items[0];
 const rows=Array.from({length:28},(_,n)=>({date:shift(-n-1),title:original.title,itemId:original.id,source:'naver-post',visits:n<14?0:100,clicks:''}));
 const imported=await (await call({action:'importMetrics',rows})).json();assert.equal(imported.result.count,28);
 assert.equal((await worker.fetch(request('/api/refresh-agent'),env)).status,401);
 assert.equal((await worker.fetch(request('/api/refresh-agent',null,cookie,'other'),env)).status,401);
 let overview=await (await worker.fetch(request('/api/refresh-agent',null,'',''),env)).json();assert.equal(overview.candidates.length,1);assert.equal(overview.candidates[0].recent.average,0);assert.equal(overview.candidates[0].decline,1);assert.equal(overview.state,undefined);assert.equal(overview.candidates[0].draft,undefined);
 const row=overview.candidates[0],choice={op:'choose',id:row.id,fingerprint:row.fingerprint};
 assert.equal((await worker.fetch(request('/api/refresh-agent',{...choice,fingerprint:'stale'},'',''),env)).status,409);
 assert.equal((await worker.fetch(request('/api/refresh-agent',{op:'changeSettings'},'',''),env)).status,400);
 assert.equal((await worker.fetch(request('/api/refresh-agent',{...choice,padding:'x'.repeat(1600)},'',''),env)).status,413);
 const foreign=request('/api/refresh-agent',choice,'','');foreign.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(foreign,env)).status,403);
 const selected=await (await worker.fetch(request('/api/refresh-agent',choice,'',''),env)).json();assert.equal(selected.duplicate,false);assert.equal(selected.item.refreshOf,original.id);assert.equal(selected.item.draft,'');assert.equal(selected.item.date,'');assert.equal(selected.item.status,'아이디어');
 const repeated=await (await worker.fetch(request('/api/refresh-agent',choice,'',''),env)).json();assert.equal(repeated.duplicate,true);assert.equal(repeated.item.id,selected.item.id);
 const data=await (await worker.fetch(request('/api/state',null,cookie),env)).json();assert.equal(data.state.items.length,2);assert.deepEqual(data.state.items.find(i=>i.id===original.id),original);assert.equal(data.state.xp,before.xp);assert.equal(data.state.metrics[0].clicks,null);assert.equal(data.analytics[0].clicks,null);assert.equal(data.analytics[0].linkCTR,null);assert.equal(data.refresh.plans.length,1);assert.equal(data.refresh.plans[0].postTotal,null);assert.deepEqual(data.state.naverStats,before.naverStats);assert.deepEqual(data.state.naverSync,before.naverSync);assert.deepEqual(data.state.publishJobs,before.publishJobs);
});
test('글별 무인 수집은 인증·원본 링크·실측 검증 후 저장하고 기존 통계·일정과 분리한다',async()=>{
 const {env,cookie}=await session();const original=(await (await worker.fetch(request('/api/action',{action:'saveItem',item:{title:'상하이 내 원고',url:'https://blog.naver.com/withsuzz/224427002632',draft:'내 실제 경험',date:'2099-10-07'}},cookie),env)).json()).result;
 const snapshot={blogId:'withsuzz',authenticated:true,grain:'day',observedAt:new Date().toISOString(),runUrl:'https://agent.tinyfish.ai/runs/cfe9d835-5be2-4f05-92c3-cdfcc4c39b6e',sourceUrl:'https://admin.blog.naver.com/withsuzz/stat/rank_pv',metricDefinition:'날짜별 글 조회수',posts:[{title:'상하이 10월 날씨',url:original.url,publishedDate:'2026-09-30',sourceUrl:'https://blog.stat.naver.com/blog/article/224427002632/cv',rows:[{date:'2026-10-05',views:187},{date:'2026-10-04',views:125}]}]};
 assert.equal((await worker.fetch(request('/api/naver-post-sync'),env)).status,401);
 assert.equal((await worker.fetch(request('/api/naver-post-sync',{kind:'snapshot',snapshot}),env)).status,401);
 const bad=request('/api/naver-post-sync',{kind:'snapshot',snapshot},'','');bad.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(bad,env)).status,403);
 assert.equal((await worker.fetch(request('/api/naver-post-sync',{kind:'changeSettings'},'',''),env)).status,400);
 assert.equal((await worker.fetch(request('/api/naver-post-sync',{kind:'snapshot',snapshot:{...snapshot,grain:'month'}},'',''),env)).status,400);
 let result=await (await worker.fetch(request('/api/naver-post-sync',{kind:'snapshot',snapshot},'',''),env)).json();assert.equal(result.saved,true);assert.equal(result.linked,1);assert.equal(result.count,2);
 result=await (await worker.fetch(request('/api/naver-post-sync',{kind:'snapshot',snapshot},'',''),env)).json();assert.equal(result.duplicate,true);
 await worker.fetch(request('/api/naver-post-sync',{kind:'schedule',automationId:'actual-existing-09-job'},'',''),env);
 await worker.fetch(request('/api/naver-post-sync',{kind:'failure',message:'읽기 지연'},'',''),env);
 const overview=await (await worker.fetch(request('/api/naver-post-sync',null,'',''),env)).json();assert.equal(overview.state,undefined);assert.equal(overview.posts[0].latestMeasurement.views,187);assert.equal(overview.posts[0].measurementDays,2);assert.equal(overview.sync.status,'확인 필요');assert.equal(overview.sync.automationId,'actual-existing-09-job');assert.equal(overview.stats.rowCount,2);
 const data=await (await worker.fetch(request('/api/state',null,cookie),env)).json();assert.deepEqual(data.state.items[0],original);assert.equal(data.state.metrics.length,2);assert.equal(data.state.naverStats,undefined);assert.equal(data.state.naverSync,undefined);assert.equal(data.state.xp,0);assert.equal(data.naverPosts.posts[0].itemId,original.id);assert.equal(data.analytics[0].visits,null);assert.equal(data.analytics[0].views,312);
});
test('꾸미기 관측·적용 API는 관리자 인증과 최신 원고를 검증하고 통계·원문을 보존한다',async()=>{
 const {env,cookie}=await session(),post=x=>worker.fetch(request('/api/action',x,cookie),env);
 const saved=await (await post({action:'saveItem',item:{title:'꾸미기 검증',draft:'제목\n\n확인한 정보입니다.',type:'info',status:'초안 작성'}})).json(),itemId=saved.result.id;
 const study={op:'study',runUrl:'https://agent.tinyfish.ai/runs/43f271ce-bd0c-4967-b365-2b4eafc67f9c',posts:[{url:'https://blog.naver.com/withsuzz/224427002632',title:'정보 글',contentType:'info',body:{method:'visual',fontSizePx:null,color:null},headings:[],quotes:[],emphasis:[],limitations:['정확한 수치는 확인되지 않음']}]};
 assert.equal((await worker.fetch(request('/api/formatting-agent',study),env)).status,401);
 assert.equal((await worker.fetch(request('/api/formatting-agent',study,'',''),env)).status,200);
 const duplicate=await (await worker.fetch(request('/api/formatting-agent',study,'',''),env)).json();assert.equal(duplicate.duplicate,true);
 const overview=await (await worker.fetch(request('/api/formatting-agent',null,'',''),env)).json();assert.equal(overview.studies.length,1);assert.deepEqual(overview.profiles[0].body,{});assert.equal(overview.state,undefined);
 const doc=await (await worker.fetch(request('/api/formatting-agent?itemId='+itemId,null,cookie),env)).json();
 const data={op:'apply',itemId,draftHash:doc.draftHash,paragraph:{index:1,kind:'quote',style:{color:'#4286b5',fontSizePx:19}}};
 const foreign=request('/api/formatting-agent',data,cookie);foreign.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(foreign,env)).status,403);
 assert.equal((await worker.fetch(request('/api/formatting-agent',data,'',''),env)).status,200);
 const fresh=await (await worker.fetch(request('/api/formatting-agent?itemId='+itemId,null,cookie),env)).json();assert.equal(fresh.blocks[1].kind,'quote');assert.equal(fresh.blocks[1].style.color,'#4286b5');
 let state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.items[0].draft,'제목\n\n확인한 정보입니다.');assert.equal(state.items[0].status,'초안 작성');assert.equal(state.xp,0);assert.equal(state.metrics.length,0);
 await post({action:'saveItem',item:{id:itemId,title:'꾸미기 검증',draft:'수정한 원고'}});assert.equal((await worker.fetch(request('/api/formatting-agent',data,'',''),env)).status,409);assert.equal((await worker.fetch(request('/api/formatting-agent',{op:'publish'},'',''),env)).status,400);
});
test('자동 글 API는 관리자 인증·원고 범위·실제 사진 저장과 기존 통계를 보존한다',async()=>{
 const {env,cookie}=await session(),files=new Map();env.BUCKET={async put(k,b){files.set(k,b)},async delete(k){files.delete(k)}};
 const now=new Date().toISOString(),b={op:'brief',requestId:crypto.randomUUID(),title:'자동 자료 확인',lane:'asia-issue',scheduledAt:'2099-10-07T01:00',region:'일본',reason:'공식 제도 변경 안내',sources:[{url:'https://www.japan.travel/',title:'공식 정보',kind:'official',checkedAt:now,facts:['공식 일정 확인']}]};
 assert.equal((await worker.fetch(request('/api/automatic-agent',b),env)).status,401);const created=await worker.fetch(request('/api/automatic-agent',b,'',''),env);assert.equal(created.status,200);const itemId=(await created.json()).itemId;
 assert.equal((await (await worker.fetch(request('/api/automatic-agent',b,'',''),env)).json()).duplicate,true);
 const ctx=await (await worker.fetch(request('/api/automatic-agent?itemId='+itemId,null,cookie),env)).json();assert.equal(ctx.status,'아이디어');
 const form=new FormData();form.set('itemId',itemId);form.set('rights','licensed');form.set('sourceUrl','https://commons.wikimedia.org/wiki/File:Photo.jpg');form.set('licenseUrl','https://creativecommons.org/publicdomain/zero/1.0/');form.set('permissionText','CC0');form.set('file',new File([new Uint8Array([255,216,255,224,0])],'photo.jpg',{type:'image/jpeg'}));
 const upload=()=>new Request('https://test.local/api/automatic-agent?op=asset',{method:'POST',body:form});assert.equal((await worker.fetch(upload(),env)).status,200);assert.equal((await (await worker.fetch(upload(),env)).json()).duplicate,true);assert.equal(files.size,1);
 const latest=await (await worker.fetch(request('/api/automatic-agent?itemId='+itemId,null,cookie),env)).json();assert.equal(latest.attachments.length,1);
 const draft={op:'draft',itemId,revision:latest.revision,title:'자동 자료 확인',body:'확인한 정보만 작성합니다. '.repeat(15),reviewed:true,latestInformationVerified:true,checkedSourceUrls:['https://www.japan.travel/']};assert.equal((await worker.fetch(request('/api/automatic-agent',draft,'',''),env)).status,200);
 const state=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.equal(state.xp,0);assert.equal(state.items[0].status,'초안 작성');assert.equal(state.metrics.length,0);
 assert.equal((await worker.fetch(request('/api/automatic-agent',{op:'publish'},'',''),env)).status,400);const foreign=request('/api/automatic-agent',b,cookie);foreign.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(foreign,env)).status,403);
});

test('외부 트렌드 수집은 관리자·Origin을 확인하고 고정 피드를 15분 캐시하며 기존 통계를 보존한다',async()=>{
 const {env,cookie}=await session();
 assert.equal((await worker.fetch(request('/api/trends-agent'),env)).status,401);
 const wrongOrigin=request('/api/trends-agent',{op:'refresh'},cookie);wrongOrigin.headers.set('Origin','https://other.example');assert.equal((await worker.fetch(wrongOrigin,env)).status,403);
 assert.equal((await worker.fetch(request('/api/trends-agent',{op:'unknown'},cookie),env)).status,400);
 const post=body=>worker.fetch(request('/api/action',body,cookie),env),saved=await (await post({action:'saveItem',item:{title:'직접 작성한 글',draft:'원래 원고'}})).json(),before=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;
 const originalFetch=globalThis.fetch,urls=[],now=new Date().toUTCString();
 globalThis.fetch=async url=>{urls.push(url);return new Response(`<rss><channel><item><title>상하이 면세</title><link>https://trends.google.com/trending?geo=KR</link><pubDate>${now}</pubDate><ht:approx_traffic>2000+</ht:approx_traffic></item></channel></rss>`);};
 try{
  const first=await (await worker.fetch(request('/api/trends-agent',{op:'refresh'},cookie),env)).json();assert.equal(first.cached,false);assert.equal(urls.length,3);assert.ok(first.trends.rows.length);
  const second=await (await worker.fetch(request('/api/trends-agent',{op:'refresh'},cookie),env)).json();assert.equal(second.cached,true);assert.equal(urls.length,3);
  const result=await (await post({action:'chooseTrendRecommendation',id:first.trends.rows[0].id,snapshotAt:first.trends.lastAttemptAt})).json();assert.equal(result.result.keyword,'상하이 면세');
  const after=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.deepEqual(after.items.find(i=>i.id===saved.result.id),before.items[0]);assert.equal(after.xp,before.xp);assert.deepEqual(after.naverStats,before.naverStats);assert.deepEqual(after.naverSync,before.naverSync);
 }finally{globalThis.fetch=originalFetch;}
});

test('인수인계 ZIP은 관리자 인증과 비공개 경계에서만 저장·다운로드하고 원고를 보존한다',async()=>{
 const {env,cookie}=await session(),files=new Map();env.BUCKET={async put(key,bytes){files.set(key,new Uint8Array(bytes));},async get(key){const bytes=files.get(key);return bytes?{body:bytes,size:bytes.length}:null;},async delete(key){files.delete(key);}};
 assert.equal((await worker.fetch(request('/api/handoff-agent'),env)).status,401);
 assert.equal((await worker.fetch(request('/download/handoff',null,cookie),env)).status,404);
 const make=bytes=>{const form=new FormData();form.append('file',new File([bytes],'handoff.zip',{type:'application/zip'}));return new Request('https://test.local/api/handoff-agent',{method:'POST',headers:{'oai-authenticated-user-id':'owner',Cookie:cookie},body:form});};
 assert.equal((await worker.fetch(make(new Uint8Array([60,104,116,109,108])),env)).status,400);
 const before=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state,bytes=new Uint8Array([0x50,0x4b,3,4,1,2,3]);
 const uploaded=await worker.fetch(make(bytes),env);assert.equal(uploaded.status,200);assert.equal((await uploaded.json()).downloadPath,'/download/handoff');
 const download=await worker.fetch(request('/download/handoff',null,cookie),env);assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition'),/^attachment;/);assert.equal(download.headers.get('Content-Type'),'application/zip');assert.deepEqual(new Uint8Array(await download.arrayBuffer()),bytes);
 const service=await worker.fetch(request('/api/handoff-agent?download=1',null,'',''),env);assert.equal(service.status,200);
 const after=(await (await worker.fetch(request('/api/state',null,cookie),env)).json()).state;assert.deepEqual(after.items,before.items);assert.equal(after.xp,before.xp);assert.deepEqual(after.naverSync,before.naverSync);
});
