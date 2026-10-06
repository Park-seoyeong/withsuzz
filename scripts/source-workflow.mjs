import {spawnSync} from 'node:child_process';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.log('Ready for ephemeral source credential on stdin');
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
process.stdin.pause();
const {credential,archivePath}=JSON.parse(input.trim());input='';
const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Bearer '+credential.token,GIT_TERMINAL_PROMPT:'0'};
function run(cmd,args,secure=false){const result=spawnSync(cmd,args,{env:secure?env:process.env,encoding:'utf8'});if(result.status!==0){console.error((result.stderr||result.stdout||'Command failed').split(credential.token).join('[redacted]'));process.exit(1);}return result.stdout.trim();}
if(!run('git',['rev-parse','--is-inside-work-tree']).includes('true'))process.exit(1);
run('git',['config','user.name','Sites']);run('git',['config','user.email','sites@openai.com']);
run('git',['remote','set-url','origin',credential.remote_url]);
run('git',['add','.']);
if(run('git',['status','--porcelain']))run('git',['commit','-m','Implement private creator manager and Notion migration']);
run('git',['push','-u','origin','HEAD:'+credential.branch],true);
const commitSha=run('git',['rev-parse','HEAD']);
run('tar',['-czf',archivePath,'.openai/hosting.json','dist/server','drizzle']);
console.log(JSON.stringify({commit_sha:commitSha,archive:archivePath}));
process.exit(0);
