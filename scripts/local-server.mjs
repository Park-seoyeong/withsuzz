import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
mkdirSync('data',{recursive:true});const sql=new DatabaseSync(process.env.LOCAL_DB_PATH||'data/workspace.sqlite');
for(const table of ['workspace','sessions','login_limits']){};
if(!sql.prepare("SELECT name FROM sqlite_master WHERE name='workspace'").get())sql.exec(readFileSync('drizzle/0000_workspace.sql','utf8'));
export const dbAdapter=db=>({prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(query).get(...args)||null;},async run(){const r=db.prepare(query).run(...args);return {meta:{changes:r.changes}};}};}});
const worker=(await import('../dist/server/index.js')).default;
const env={DB:dbAdapter(sql),ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,IMPORT_TOKEN:process.env.IMPORT_TOKEN,OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL};
// Test provider lives only in the local runner, never in the deployed Worker.
if(process.env.MOCK_AI_TEST==='1'){env.OPENAI_API_KEY='local-fixture-only';globalThis.fetch=async(url,opts)=>{if(url!=='https://api.openai.com/v1/responses')throw new Error('Unexpected fixture URL');const input=JSON.parse(JSON.parse(opts.body).input[0].content[0].text),kind=input.scope==='titles'?'titles':input.scope==='selection'?'partial':'draft',result={kind,title:'QA 검증 제목',disclosure:'',body:kind==='titles'?'제목 후보 1\n제목 후보 2\n제목 후보 3':kind==='partial'?'선택한 부분 수정':'안녕하세요, 써즈입니다.\n\n검증용 제공자에서 만든 초안이에요.',questions:[],warnings:['검증용 응답이며 실제 정보 조사를 수행하지 않았어요.'],linkPositions:[],summary:'브라우저 동작 확인용'};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result),annotations:[]}]}]});};}
const port=Number(process.env.PORT)||4173;
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,String(v));headers.set('oai-authenticated-user-id','local-owner');const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Local server error');}});
server.listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
