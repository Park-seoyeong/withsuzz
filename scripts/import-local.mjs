import {readFile} from 'node:fs/promises';
const origin='http://127.0.0.1:4173';
const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'local-test-only'})});
if(!login.ok)throw new Error('Local login failed');
const cookie=login.headers.get('Set-Cookie').split(';')[0];
const data=JSON.parse(await readFile('.sites-runtime/import.json','utf8'));
const r=await fetch(origin+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie},body:JSON.stringify({action:'importNotion',data})});
const result=await r.json();if(!r.ok)throw new Error(result.error);console.log('Imported '+result.result.count+' records');
