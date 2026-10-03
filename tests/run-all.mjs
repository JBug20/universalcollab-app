// Runs every test file in this folder one at a time and prints a summary.
// Tests that import relay code need universalcollab-relay checked out next to this repo.
// Native Electron tests only run when UC_RUNTIME points at a packaged app.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.dirname(new URL(import.meta.url).pathname);
const relay=path.resolve(dir,'../../universalcollab-relay/src');
const files=fs.readdirSync(dir).filter(f=>/\.(c|m)js$/.test(f)&&f!=='run-all.mjs').sort();
let failed=0;
for(const f of files){
 const source=fs.readFileSync(path.join(dir,f),'utf8');
 if(f.startsWith('native-')&&!process.env.UC_RUNTIME){console.log('SKIP '+f+' (set UC_RUNTIME to a packaged app to run it)');continue;}
 if(source.includes('universalcollab-relay/src/')&&!fs.existsSync(relay)){console.log('SKIP '+f+' (needs universalcollab-relay next to this repo)');continue;}
 const r=spawnSync(process.execPath,[path.join(dir,f)],{encoding:'utf8',timeout:180000});
 if(r.status===0)console.log('OK   '+f);
 else{failed++;console.log('FAIL '+f+'\n'+(r.stderr||r.stdout||'').split('\n').filter(l=>!/^\s+at /.test(l)).slice(0,12).join('\n'));}
}
process.exitCode=failed?1:0;
