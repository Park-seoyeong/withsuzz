import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,award} from '../worker/domain.mjs';
import {questBoard,findQuest,levelInfo,dailyQuestList,achievementList} from '../worker/quests.mjs';

const day='2026-10-07';
const item=(x)=>({id:crypto.randomUUID(),title:'글',channel:'blog',status:'아이디어',region:'제주',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',...x});

test('레벨은 150 EXP마다 오르고 단계별 성장 모습이 바뀐다',()=>{
 assert.equal(levelInfo(0).level,1);assert.equal(levelInfo(0).stage.id,'start');assert.equal(levelInfo(149).toNext,1);
 assert.equal(levelInfo(150).stage.id,'ready');assert.equal(levelInfo(300).stage.id,'camera');assert.equal(levelInfo(600).stage.id,'editor');
 assert.equal(levelInfo(1050).stage.id,'guide');assert.equal(levelInfo(1650).stage.id,'author');assert.equal(levelInfo(1650).next,null);
});

test('하루 퀘스트는 같은 날 늘 같고, 실제 기록으로만 완료된다',()=>{
 const s=initialState();
 const a=dailyQuestList(s,day),b=dailyQuestList(s,day);assert.deepEqual(a.map(q=>q.key),b.map(q=>q.key));
 assert.equal(a.length,4);assert.ok(a.every(q=>!q.done));
 assert.ok(!a.some(q=>q.key.startsWith('bonus:sponsor')),'진행 중 협찬이 없으면 협찬 퀘스트를 내지 않는다');
 const keys=new Set();for(let d=1;d<=28;d++)for(const q of dailyQuestList(s,'2026-10-'+String(d).padStart(2,'0')))keys.add(q.key.split(':').slice(0,2).join(':'));
 assert.ok([...keys].filter(k=>k.startsWith('bonus')).length>=5,'한 달 동안 여러 종류의 보너스 퀘스트가 나온다');
 s.items.push(item({status:'게시됨',publishedAt:day+'T12:00:00+09:00'}),item({status:'게시됨',publishedAt:day+'T12:00:00+09:00'}));
 assert.equal(dailyQuestList(s,day)[0].done,true);
});

test('주간·장기 업적은 누락된 방문자 통계를 0으로 보지 않고, 보상은 한 번만 받는다',()=>{
 const s=initialState();
 for(let n=0;n<10;n++)s.items.push(item({status:'게시됨',region:['제주','부산','서울'][n%3],publishedAt:'2026-10-0'+(5+n%3)+'T12:00:00+09:00'}));
 const board=questBoard(s,day);
 assert.equal(board.weekly.find(q=>q.key.startsWith('weekly-publish')).done,true);
 assert.equal(board.weekly.find(q=>q.key.startsWith('weekly-regions')).done,true);
 const pub10=board.achievements.find(a=>a.key==='achv:pub-10');assert.equal(pub10.done,true);
 const v=board.achievements.find(a=>a.key==='achv:visitors-650');assert.equal(v.current,null);assert.equal(v.done,false);assert.equal(v.needsData,true);
 s.naverStats={visitors:[577,530,660,628,595,613,740].map((count,n)=>({date:'2026-09-'+String(29+n>30?n-1:29+n).padStart(2,'0'),count}))};
 s.naverStats.visitors=[577,530,660,628,595,613,740].map((count,n)=>{const d=new Date(Date.UTC(2026,8,29+n));return {date:d.toISOString().slice(0,10),count};});
 assert.equal(achievementList(s).find(a=>a.id==='visitors-650').done,false);
 assert.equal(achievementList(s).find(a=>a.id==='visitors-650').current,620);
 s.naverStats.visitors.splice(3,1);assert.equal(achievementList(s).find(a=>a.id==='visitors-650').current,null,'날짜가 빠지면 평균을 내지 않는다');
 const q=findQuest(s,'achv:pub-10',day);assert.ok(q);assert.equal(award(s,q.key,q.xp),true);assert.equal(award(s,q.key,q.xp),false);
 assert.equal(questBoard(s,day).achievements.find(a=>a.key==='achv:pub-10').claimed,true);
});
