// Claude 아티팩트용 한 장짜리 HTML을 만든다: 화면(app.js/app.css) + 브라우저 안 서버(worker) + 연결부(artifact/shim.js).
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit',env:{...process.env,KEEP_APP_MODULE:'1'}});
const out=await build({entryPoints:['artifact/shim.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,charset:'utf8',legalComments:'none',
 alias:{'@anthropic-ai/sdk':'./artifact/sdk-stub.mjs'},
 plugins:[{name:'server',setup(b){b.onResolve({filter:/^\.\/server\.mjs$/},()=>({path:new URL('../dist/server/app.mjs',import.meta.url).pathname}));}}]});
const esc=t=>t.replace(/<\/(script)/gi,'<\\/$1').replace(/<!--/g,'<\\!--');
const [css,pageCss,app,index]=await Promise.all(['public/app.css','artifact/page.css','public/app.js','public/index.html'].map(f=>readFile(f,'utf8')));
const body=index.match(/<body>([\s\S]*?)<script/)[1];
const html=`<title>써즈의 동네방네</title>\n<style>${css}\n${pageCss}</style>\n${body}\n<script type="module">${esc(out.outputFiles[0].text)}</script>\n<script type="module">${esc(app)}</script>\n`;
if(/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(html.replace(/<script type="module">[\s\S]*?<\/script>\n<script type="module">[\s\S]*?<\/script>/,'')))throw new Error('inline script escape failed');
await mkdir('dist/artifact',{recursive:true});await writeFile('dist/artifact/index.html',html);
console.log('Built Claude artifact page: dist/artifact/index.html',(html.length/1024).toFixed(0)+' KB');
