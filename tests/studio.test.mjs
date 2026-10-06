import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {normalizeSns,snsItems,snsPrompt,normalizeSeries,seriesItems,compareDraftItem} from '../worker/studio.mjs';

function setup(answer){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 const prompts=[];
 const env={ARTIFACT:'1',SAMPLE:{json:async input=>{prompts.push(input);return answer(input);},limits:async()=>({})},DB:{prepare(q){let a=[];return {bind(...x){a=x;return this;},async first(){return sql.prepare(q).get(...a)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...a).changes}};}};}}};
 const call=async(p,b)=>{const r=await worker.fetch(new Request('https://t.local'+p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{}),env);return {status:r.status,body:await r.json()};};
 return {call,prompts};
}
const SNS={posts:[{channel:'instagram',title:'제주 억새 명소',hook:'억새가 은빛으로 흔들리는 곳',body:'새별오름 억새 이야기',slides:['1장 전경','2장 길'],hashtags:['#제주억새','새별 오름'],cta:'저장해 두세요'},{channel:'threads',title:'',hook:'',body:'억새 보러 가실 분?',slides:['첫 글','둘째 글'],hashtags:[],cta:''},{channel:'tiktok',title:'안 고른 채널',hook:'',body:'x',slides:[],hashtags:[],cta:''}],warnings:['주차 요금 확인']};

test('SNS 나누기는 고른 채널만 남기고, 블로그 다음 날부터 하루씩 배치한다',()=>{
 const r=normalizeSns(SNS,['instagram','threads']);
 assert.deepEqual(r.posts.map(p=>p.channel),['instagram','threads']);assert.deepEqual(r.posts[0].hashtags,['제주억새','새별오름']);
 const items=snsItems({title:'제주 억새 명소 5곳',date:'2026-10-10',region:'제주',keyword:'제주 억새'},r);
 assert.deepEqual(items.map(i=>i.date),['2026-10-11','2026-10-12']);assert.equal(items[0].type,'social');assert.equal(items[0].status,'초안 작성');
 assert.match(items[0].draft,/\[장 1\] 1장 전경/);assert.match(items[0].draft,/#제주억새 #새별오름/);assert.match(items[1].draft,/\[이어지는 글 2\] 둘째 글/);assert.match(items[0].notes,/주차 요금 확인/);
 assert.match(snsPrompt({title:'t',draft:'d'},['instagram']).instructions,/지어내지 않는다/);
});

test('시리즈 기획은 같은 제목을 거르고 간격대로 날짜를 넣으며, 비교 글은 수수료를 글에 쓰지 않게 표시한다',()=>{
 const plan=normalizeSeries({series:'제주 가을',posts:[{title:'제주 억새 명소',keyword:'제주 억새',angle:'명소',outline:['새별오름','산굼부리'],type:'info',needs:['사진']},{title:'제주 억새 명소',keyword:'x',angle:'',outline:[],type:'info',needs:[]},{title:'제주 가을 코스',keyword:'제주 가을 여행',angle:'코스',outline:[],type:'weird',needs:[]}],warnings:[]},5);
 assert.equal(plan.posts.length,2);assert.equal(plan.posts[1].type,'info');
 const items=seriesItems(plan,{startDate:'2026-10-08',every:2,region:'제주'});
 assert.deepEqual(items.map(i=>i.date),['2026-10-08','2026-10-10']);assert.equal(items[0].groupId,items[1].groupId);assert.match(items[0].notes,/\(1\/2\)/);assert.match(items[0].notes,/- 새별오름/);
 assert.deepEqual(seriesItems(plan).map(i=>i.date),['','']);
 const c=compareDraftItem([{name:'A 가습기',price:39000,rating:4.7,reviews:1200,commissionAmount:1170,url:'https://a.example/1',keyword:'가습기',capturedAt:'2026-10-06T00:00:00Z'},{name:'B 가습기',price:null,rating:null,reviews:null,commissionAmount:null,url:''}],'가습기');
 assert.equal(c.type,'affiliate');assert.match(c.title,/가습기 추천 비교 · 2가지/);assert.match(c.notes,/글에는 쓰지 않음/);assert.equal(c.links,'https://a.example/1');
});

test('API: SNS 묶음·시리즈·비교 글·일괄 초안 자동 적용',async()=>{
 const {call,prompts}=setup(input=>/SNS 담당 에디터/.test(input)?SNS:/콘텐츠 기획자/.test(input)?{series:'제주 가을',posts:[{title:'제주 억새 명소',keyword:'제주 억새',angle:'',outline:['a'],type:'info',needs:[]},{title:'제주 가을 코스',keyword:'제주 가을 여행',angle:'',outline:[],type:'review',needs:['직접 방문']}],warnings:[]}:{kind:'draft',title:'제목',disclosure:'',body:'본문입니다',questions:[],warnings:[],linkPositions:[],summary:'요약'});
 const saved=(await call('/api/action',{action:'saveItem',item:{title:'제주 억새 명소 5곳',channel:'blog',date:'2026-10-10',draft:'새별오름 억새가 좋아요.'}})).body.result;
 let r=await call('/api/ai/sns',{itemId:saved.id,channels:['instagram','threads']});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.made.length,2);assert.deepEqual(r.body.warnings,['주차 요금 확인']);
 r=await call('/api/ai/sns',{itemId:saved.id,channels:['instagram']});assert.equal(r.status,400,'이미 만든 채널은 다시 만들지 않는다');
 r=await call('/api/ai/series',{theme:'제주 가을 여행',count:2});assert.equal(r.status,200);assert.equal(r.body.plan.posts.length,2);assert.match(prompts.at(-1),/제주 억새 명소 5곳/,'이미 있는 글을 알려 준다');
 r=await call('/api/action',{action:'addSeries',plan:r.body.plan,startDate:'2026-10-12',every:3});assert.equal(r.body.result.count,2);
 await call('/api/action',{action:'saveProducts',source:'brand',keyword:'가습기',rows:[{name:'A 가습기',price:'39000'},{name:'B 가습기',price:'59000'}]});
 let st=(await call('/api/state')).body.state;
 r=await call('/api/action',{action:'compareToItem',ids:st.products.map(p=>p.id)});assert.equal(r.body.result.type,'affiliate');
 const idea=st.items.find(i=>i.title==='제주 가을 코스');
 r=await call('/api/ai/write',{requestId:'req-'+'x'.repeat(24),itemId:idea.id,mode:'draft',autoApply:true});assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.task.appliedAt);
 st=(await call('/api/state')).body.state;const after=st.items.find(i=>i.id===idea.id);assert.match(after.draft,/본문입니다/);assert.equal(after.status,'초안 작성');
 assert.equal(st.items.filter(i=>i.parentId===saved.id).map(i=>i.date).join(),'2026-10-11,2026-10-12');
 r=await call('/api/ai/write',{requestId:'req-'+'y'.repeat(24),itemId:saved.id,mode:'draft',autoApply:true});assert.equal(r.body.task.appliedAt,undefined,'원고가 있던 글은 자동으로 덮어쓰지 않는다');
});

test('API: 학습 자료는 Claude가 읽고 요약·적용점을 남기며, 링크는 읽지 않았다고 경고한다',async()=>{
 const {call,prompts}=setup(()=>({summary:'요약입니다',points:'- 배울 점',apply:'- 적용할 것',warnings:[]}));
 const l=(await call('/api/action',{action:'saveLesson',lesson:{title:'제목 짓는 법',source:'제목에는 키워드를 앞에 둔다.',url:'https://example.com/a',category:'글쓰기'}})).body.result;
 const r=await call('/api/ai/lesson',{lessonId:l.id});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.status,'자료 일부 확인');
 const st=(await call('/api/state')).body.state,x=st.lessons.find(y=>y.id===l.id);assert.equal(x.summary,'요약입니다');assert.match(x.analysis.warnings.join(),/원본 링크/);assert.match(prompts[0],/키워드를 앞에/);
 assert.equal((await call('/api/ai/lesson',{lessonId:'none'})).status,404);
});

test('API: SNS 게시 기록은 블로그 글을 거절하고 경험치를 한 번만 준다',async()=>{
 const {call}=setup(()=>({}));
 const blog=(await call('/api/action',{action:'saveItem',item:{title:'블로그 글',channel:'blog'}})).body.result;
 const sns=(await call('/api/action',{action:'saveItem',item:{title:'인스타 글',channel:'instagram',type:'social'}})).body.result;
 assert.equal((await call('/api/action',{action:'snsPosted',id:blog.id})).status,400);
 await call('/api/action',{action:'snsPosted',id:sns.id});await call('/api/action',{action:'snsPosted',id:sns.id});
 const st=(await call('/api/state')).body.state;assert.equal(st.items.find(i=>i.id===sns.id).status,'게시됨');assert.equal(st.xp,10);
});

test('API: 자동 초안 실행 기록은 하루 한 번만 통과한다',async()=>{
 const {call}=setup(()=>({}));
 assert.equal((await call('/api/action',{action:'autoDraftRan',day:'2026-10-07'})).body.result.already,false);
 assert.equal((await call('/api/action',{action:'autoDraftRan',day:'2026-10-07'})).body.result.already,true);
 assert.equal((await call('/api/action',{action:'autoDraftRan',day:''})).status,400);
});
