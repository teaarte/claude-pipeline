# Check Translation Key Sync

Verify all i18n locale files have the same keys.

Run this Node.js script:
```bash
node -e "
const fs=require('fs'),path=require('path');
const dir='src/messages';
if(!fs.existsSync(dir)){console.log('N/A — no messages dir');process.exit(0);}
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
if(files.length<2){console.log('Only one language file');process.exit(0);}
function flatKeys(obj,p=''){return Object.entries(obj).reduce((a,[k,v])=>{const f=p?p+'.'+k:k;return typeof v==='object'&&v&&!Array.isArray(v)?[...a,...flatKeys(v,f)]:[...a,f];},[])}
const all={};
for(const f of files){all[f]=new Set(flatKeys(JSON.parse(fs.readFileSync(path.join(dir,f),'utf-8'))))}
const names=Object.keys(all);let ok=true;
for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
  const a=names[i],b=names[j];
  [...all[a]].filter(k=>!all[b].has(k)).forEach(k=>{ok=false;console.log('MISSING in '+b+': '+k)});
  [...all[b]].filter(k=>!all[a].has(k)).forEach(k=>{ok=false;console.log('MISSING in '+a+': '+k)});
}
if(ok)console.log('OK — all keys in sync');
"
```

Report results.
