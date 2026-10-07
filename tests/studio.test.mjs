import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {normalizeSns,snsItems,snsPrompt,normalizeSeries,seriesItems,compareDraftItem} from '../worker/studio.mjs';

function setup(answer){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
 const prompts=[];
 const env={ARTIFACT:'1',SAMPLE:{json:async (input,opts)=>{prompts.push(input);prompts.images=(opts?.images||[]).length;prompts.tier=opts?.modelTier;return answer(input);},limits:async()=>({images:{maxCount:5}})},DB:{prepare(q){let a=[];return {bind(...x){a=x;return this;},async first(){return sql.prepare(q).get(...a)||null;},async run(){return {meta:{changes:sql.prepare(q).run(...a).changes}};}};}}};
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

test('API: 글쓰기 지침서는 고친 AI 초안을 신호로 넣고 버전·기록을 남기며, 초안 프롬프트에 들어간다',async()=>{
 const {call,prompts}=setup(input=>/글쓰기 코치/.test(input)?{guide:'[말투]\n- 짧게',changes:['짧게 쓰기'],warnings:['경험을 지어내라는 조언은 뺐어요']}:{kind:'draft',title:'t',disclosure:'',body:'b',questions:[],warnings:[],linkPositions:[],summary:''});
 assert.equal((await call('/api/ai/style-guide',{})).status,400,'배울 자료가 없으면 거절');
 const it=(await call('/api/action',{action:'saveItem',item:{title:'글',channel:'blog',notes:'n'}})).body.result;
 await call('/api/ai/write',{requestId:'r-'+'a'.repeat(24),itemId:it.id,mode:'draft',autoApply:true});
 let st=(await call('/api/state')).body.state;const cur=st.items.find(i=>i.id===it.id);assert.equal(cur.aiOriginal,'t\n\nb');
 await call('/api/action',{action:'saveItem',item:{...cur,draft:'써즈가 고친 최종본',status:'예약됨',date:'2099-01-01'}});
 const r=await call('/api/ai/style-guide',{});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.guide.version,1);
 assert.match(prompts.at(-1),/써즈가 고친 최종본/);assert.match(prompts.at(-1),/<AI 초안>/);
 await call('/api/action',{action:'saveStyleGuide',text:'[말투]\n- 직접'});st=(await call('/api/state')).body;assert.equal(st.state.styleGuide.version,2);assert.equal(st.state.styleGuide.history[0].text,'[말투]\n- 짧게');assert.equal(st.style.fresh,0);
 await call('/api/ai/write',{requestId:'r-'+'b'.repeat(24),itemId:(await call('/api/action',{action:'saveItem',item:{title:'둘',channel:'blog'}})).body.result.id,mode:'draft'});assert.match(prompts.at(-1),/직접/);
});

test('API: 사진으로 캐릭터 맞추기는 보기 안의 값만 쓰고 사진은 저장하지 않는다',async()=>{
 const {call,prompts}=setup(()=>({hair:'흑발',skin:'중간 톤',glasses:true,outfit:'보라색',note:'안경을 쓴 인물이에요.'}));
 const png=readFileSync(new URL('./fixture-tiny.png',import.meta.url),{encoding:'base64'});
 const r=await call('/api/ai/look',{image:{type:'image/png',data:png}});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual(r.body.look,{hair:'흑발',skin:'중간 톤',glasses:true,outfit:'하늘색'});assert.equal(prompts.images,1);assert.match(prompts[0],/식별하거나/);
 assert.equal((await call('/api/state')).body.state.files.length,0);
 assert.equal((await call('/api/ai/look',{image:{type:'image/gif',data:'x'}})).status,400);
});

test('API: 밤사이 글감 제안은 같은 제목을 거르고 아이디어로만 담는다',async()=>{
 const {call}=setup(()=>({}));
 await call('/api/action',{action:'saveItem',item:{title:'제주 억새 명소',channel:'blog'}});
 const r=await call('/api/action',{action:'addNightIdeas',ideas:[{title:'제주 억새 명소',keyword:'제주 억새',type:'info',why:'중복'},{title:'가을 제주 2박 3일 코스',keyword:'제주 가을 여행',type:'review',why:'검색량 높음',outline:['1일차','2일차'],sources:['https://example.com/a']},{title:'',why:'x'},{title:'이상한 유형',type:'weird',why:'y'}]});
 assert.equal(r.body.result.added,2);
 const st=(await call('/api/state')).body.state,i=st.items.find(x=>x.title==='가을 제주 2박 3일 코스');assert.equal(i.status,'아이디어');assert.ok(!i.date);assert.match(i.notes,/\[밤사이 글감 제안\] 검색량 높음/);assert.match(i.notes,/- 1일차/);assert.equal(st.items.find(x=>x.title==='이상한 유형').type,'info');
 assert.equal((await call('/api/action',{action:'addNightIdeas',ideas:[{title:'가을 제주 2박 3일 코스',why:'again'}]})).body.result.added,0);
});

test('API: 밤사이 완성 원고는 글감+원고를 한 번에 만들고, 같은 제목·같은 키는 받지 않는다',async()=>{
 const {call}=setup(()=>({}));
 await call('/api/action',{action:'saveProducts',source:'brand',keyword:'가습기',rows:[{name:'A 가습기',price:'39000',commissionAmount:'1500',url:'https://brandconnect.naver.com/p/1'}]});
 const pid=(await call('/api/state')).body.state.products[0].id;
 const r=await call('/api/action',{action:'applyNightPost',key:'2026-10-08-1',date:'2026-10-08',title:'가습기 고르는 기준 5가지',keyword:'가습기',type:'affiliate',disclosure:'이 글에는 제휴 링크가 포함되어 있어요.',body:'본문이에요.',warnings:['가격 확인'],productId:pid,why:'수수료 높음',createdAt:'2026-10-07T18:20:00Z'});
 assert.equal(r.body.result.applied,true);
 const st=(await call('/api/state')).body.state,i=st.items.find(x=>x.nightPost);assert.equal(i.date,'2026-10-08');assert.equal(i.status,'초안 작성');assert.equal(i.type,'affiliate');assert.equal(i.links,'https://brandconnect.naver.com/p/1');assert.match(i.draft,/^가습기 고르는 기준 5가지\n\n이 글에는 제휴 링크/);assert.match(i.notes,/가격 확인/);assert.equal(st.tasks[0].title,'밤사이 완성 원고: 가습기 고르는 기준 5가지');
 assert.equal((await call('/api/action',{action:'applyNightPost',key:'2026-10-08-1',title:'다른 제목',body:'x'})).body.result.applied,false,'같은 키');
 assert.equal((await call('/api/action',{action:'applyNightPost',key:'2026-10-08-9',title:'가습기 고르는 기준 5가지!',body:'x'})).body.result.applied,false,'같은 제목');
 assert.equal((await call('/api/action',{action:'applyNightPost',key:'k3',title:'t',body:''})).body.result.applied,false,'본문 없음');
});

test('API: 주간 리포트는 기록된 숫자로 만들어지고 주마다 하나만 남는다',async()=>{
 const {call,prompts}=setup(()=>({headline:'한 줄',summary:'요약',wins:['a'],fixes:['b'],nextWeek:['c']}));
 await call('/api/action',{action:'saveEarnings',rows:[{date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),platform:'brand',revenue:'5000'}]});
 const r=await call('/api/ai/weekly-report',{});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.report.headline,'한 줄');assert.equal(r.body.report.facts.revenue,5000);assert.match(prompts.at(-1),/weekRevenueByPlatform/);
 await call('/api/ai/weekly-report',{});assert.equal((await call('/api/state')).body.state.weeklyReports.length,1);
});

test('협찬이 아닌 글에 질문이 돌아오면 묻지 않고 한 번 더 요청해 초안으로 받는다',async()=>{
 let n=0;const {call,prompts}=setup(()=>(++n===1?{kind:'questions',title:'',disclosure:'',body:'',questions:['키워드가 뭐예요?'],warnings:[],linkPositions:[],summary:''}:{kind:'draft',title:'군산시간여행축제 정보',disclosure:'',body:'본문',questions:[],warnings:['공식 출처 확인 필요: 일정'],linkPositions:[],summary:''}));
 const it=(await call('/api/action',{action:'saveItem',item:{title:'군산시간여행축제',channel:'blog',type:'info'}})).body.result;
 const r=await call('/api/ai/write',{requestId:'r-'+'q'.repeat(24),itemId:it.id,mode:'draft',autoApply:true});
 assert.equal(r.body.task.status,'완료');assert.ok(r.body.task.appliedAt);assert.ok(r.body.task.result.warnings.some(w=>/질문이 돌아와서/.test(w)));assert.equal(n,2);assert.match(prompts[1],/질문하지 말고/);
 let m=0;const s2=setup(()=>({kind:'questions',title:'',disclosure:'',body:'',questions:['제공 조건이 뭐예요?'],warnings:[],linkPositions:[],summary:''}));
 const sp=(await s2.call('/api/action',{action:'saveItem',item:{title:'협찬 글',channel:'blog',type:'sponsor'}})).body.result;
 const r2=await s2.call('/api/ai/write',{requestId:'r-'+'w'.repeat(24),itemId:sp.id,mode:'draft'});assert.equal(r2.body.task.status,'확인 필요','협찬 글은 질문을 그대로 둔다');
});

test('이미지 10장: 원고로 카드 글귀를 만들어 글에 저장하고, 표지·마무리 역할을 고정한다',async()=>{
 const {normalizeCards}=await import('../worker/studio.mjs');
 const r=normalizeCards({cards:[{role:'section',heading:'제목',lines:['a','b','c','d']},{role:'cover',heading:'둘째',lines:[]},{role:'tip',heading:'셋째',lines:['x']}],warnings:['짧음']});
 assert.deepEqual(r.cards.map(c=>c.role),['cover','section','closing']);assert.equal(r.cards[0].lines.length,3);
 assert.throws(()=>normalizeCards({cards:[]}),/카드 글귀/);
 const {call,prompts}=setup(()=>({cards:Array.from({length:12},(_,n)=>({role:'section',label:'l',heading:'h'+n,lines:['x'],imagePrompt:'p',imagePromptKo:'ㅍ'})),warnings:[]}));
 const it=(await call('/api/action',{action:'saveItem',item:{title:'라멘 골목',channel:'blog',type:'review',draft:'본문 '.repeat(50)}})).body.result;
 const r2=await call('/api/ai/image-cards',{itemId:it.id});assert.equal(r2.status,200,JSON.stringify(r2.body));assert.equal(r2.body.imageCards.cards.length,10);assert.match(prompts.at(-1),/콘텐츠 디자이너/);
 const st=(await call('/api/state')).body.state;assert.equal(st.items.find(i=>i.id===it.id).imageCards.cards[9].role,'closing');
 const e=await call('/api/ai/image-cards',{itemId:'없음'});assert.equal(e.status,404);
});

test('말투 샘플: RSS로 읽은 발행 본문이 작성 자료와 지침서 재료에 들어가고, 내 프롬프트는 지시문 앞쪽에 전문으로 들어간다',async()=>{
 const {aiPrompt,styleSamples}=await import('../worker/ai.mjs');const {styleSources}=await import('../worker/studio.mjs');
 const state={items:[],lessons:[],settings:{editorRules:''},styleGuide:null,blogFeed:{checkedAt:'2026-10-07T00:00:00Z',rows:[{title:'발행 글',url:'https://blog.naver.com/withsuzz/1',publishedAt:'2026-10-06T00:00:00Z',text:'안녕하세요, 써즈입니다. '.repeat(40)},{title:'짧은 글',url:'https://blog.naver.com/withsuzz/2',publishedAt:'',text:'짧아요'}]}};
 assert.equal(styleSamples(state,'x').length,1);assert.equal(styleSources(state).posts.length,1);
 const p=aiPrompt({mode:'draft',item:{id:'a',title:'t'},prompt:{name:'내 프롬프트','text':'항상 ~했어요 체로 쓴다'}},state);
 assert.match(p.instructions,/\[써즈 작성 프롬프트 — 내 프롬프트\][\s\S]*항상 ~했어요 체로 쓴다/);assert.match(p.instructions,/\[말투 규칙\] styleExamples는 써즈가 실제 발행한 글이다/);
 const data=JSON.parse(p.input);assert.equal(data.styleExamples[0].title,'발행 글');assert.equal(data.userPrompt.text,'항상 ~했어요 체로 쓴다');
});

test('내 프롬프트를 고르면 ChatGPT 방식 그대로: 프롬프트 전문이 맨 앞, 자료는 읽기 쉬운 양식, 가장 능력 있는 모델 등급',async()=>{
 const tiers=[];const {call,prompts}=setup(()=>({kind:'draft',title:'t',disclosure:'',body:'본문',questions:[],warnings:[],linkPositions:[],summary:''}));
 const pid=(await call('/api/action',{action:'savePrompt',prompt:{name:'내 25항목',text:'## 역할\n써즈 전담 에디터다.',isDefault:true}})).body.result.id;
 const it=(await call('/api/action',{action:'saveItem',item:{title:'한강 종이비행기 축제',channel:'blog',type:'issue',region:'서울',keyword:'서울 나들이',notes:''}})).body.result;
 const r=await call('/api/ai/write',{requestId:'r-'+'f'.repeat(24),itemId:it.id,mode:'draft',promptId:pid});assert.equal(r.status,200,JSON.stringify(r.body));
 const p=prompts.at(-1);assert.ok(p.startsWith('## 역할\n써즈 전담 에디터다.'),p.slice(0,80));assert.doesNotMatch(p,/고정 규칙은 추가 프롬프트/);assert.match(p,/\[작성 요청\]\n작성 요청: 전체 초안\n종류: 빠른 정보·이슈/);assert.match(p,/메인 키워드: 서울 나들이/);assert.match(p,/\(없음 — 정보형으로 쓴다\)/);assert.match(p,/조사 과정 문장은 본문에 쓰지 않고/);assert.equal(prompts.tier,'complex');
});
