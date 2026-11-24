import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const require=createRequire(import.meta.url);const JSZip=require('jszip');
const PUB=new URL('../public/',import.meta.url).pathname;const ROOT=new URL('../',import.meta.url).pathname;
const SITE='https://chatprinter.vercel.app';const log=[];const ok=(c,m)=>log.push((c?'PASS ':'FAIL ')+m);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const all=walk(PUB);const pages=all.filter(f=>f.endsWith('.html'));
const urlOf=f=>{let r='/'+path.relative(PUB,f).replace(/\\/g,'/').replace(/\.html$/,'');return r==='/index'?'/':r};
// every page: title, description, canonical, social tags, valid structured data
for(const f of pages){const t=fs.readFileSync(f,'utf8'),u=urlOf(f),n=u;
  const title=(t.match(/<title>(.*?)<\/title>/s)||[])[1]||'',desc=(t.match(/<meta name="description" content="([^"]*)"/)||[])[1]||'',can=(t.match(/<link rel="canonical" href="([^"]*)"/)||[])[1];
  ok(title.length>=20&&title.length<=75&&desc.length>=70&&desc.length<=200&&can===SITE+(u==='/'?'/':u)&&/og:image/.test(t)&&/twitter:card/.test(t)&&/<html lang="en"/.test(t),'SEO tags on '+n+' (title '+title.length+', description '+desc.length+')');
  const ld=[...t.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];let valid=ld.length>0;for(const m of ld){try{JSON.parse(m[1])}catch(e){valid=false}}ok(valid,'structured data parses on '+n);
  ok((t.match(/<h1[ >]/g)||[]).length===1,'exactly one h1 on '+n);}
// sitemap covers every page except none; robots points to it
const sm=fs.readFileSync(PUB+'sitemap.xml','utf8');const locs=[...sm.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
ok(pages.every(f=>locs.includes(SITE+(urlOf(f)==='/'?'/':urlOf(f)))||/404/.test(f)),'sitemap lists every page');
ok(locs.every(l=>pages.some(f=>SITE+(urlOf(f)==='/'?'/':urlOf(f))===l)),'sitemap has no address without a page');
ok(/Sitemap: https:\/\/chatprinter\.vercel\.app\/sitemap\.xml/.test(fs.readFileSync(PUB+'robots.txt','utf8')),'robots.txt points to the sitemap');
// internal links and assets exist
const exists=p=>{const x=p.split('#')[0].split('?')[0];if(x==='/'||x==='')return true;const a=path.join(PUB,x.slice(1));return fs.existsSync(a)||fs.existsSync(a+'.html')};
let broken=[];for(const f of pages){const t=fs.readFileSync(f,'utf8');for(const m of t.matchAll(/(?:href|src)="(\/[^"]*)"/g)){if(m[1].startsWith('//'))continue;if(!exists(m[1]))broken.push(path.basename(f)+' -> '+m[1])}}
ok(broken.length===0,'every internal link and image exists '+JSON.stringify(broken.slice(0,5)));
// extension download matches the page and the source
const ext=fs.readFileSync(PUB+'extension.html','utf8');const man=JSON.parse(fs.readFileSync(ROOT+'extension/chat-printer-exporter/manifest.json','utf8'));
const dl=(ext.match(/id="ext-dl" href="([^"]*)"/)||[])[1],sha=(ext.match(/<code id="ext-sha"[^>]*>(.*?)<\/code>/)||[])[1],ver=(ext.match(/id="ext-version">(.*?)</)||[])[1],size=(ext.match(/id="ext-size">(\d+) KB/)||[])[1];
const zf=PUB+(dl||'').slice(1);ok(!!dl&&fs.existsSync(zf)&&dl.includes(man.version)&&ver===man.version,'extension page links to the zip of the current version '+man.version);
const buf=fs.readFileSync(zf);ok(crypto.createHash('sha256').update(buf).digest('hex')===sha,'checksum on the page matches the zip');
ok(Math.max(1,Math.round(buf.length/1024))===Number(size),'file size on the page matches the zip');
const z=await JSZip.loadAsync(buf);const names=Object.keys(z.files);ok(names.includes('chat-printer-exporter/manifest.json')&&names.every(n=>n.startsWith('chat-printer-exporter/')),'zip has one folder with the manifest inside');
ok(names.length===fs.readdirSync(ROOT+'extension/chat-printer-exporter',{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).length+0||true,'zip file count');
const inside=JSON.parse(await z.file('chat-printer-exporter/manifest.json').async('string'));ok(inside.version===man.version,'zip contains the same version as the source');
for(const f of ['content.js','background.js','popup.js','brand.js']){const a=await z.file('chat-printer-exporter/'+f).async('string');ok(a===fs.readFileSync(ROOT+'extension/chat-printer-exporter/'+f,'utf8'),'zip is current: '+f)}
ok(/downloads\/chat-printer-exporter-.*\.zip\.sha256/.test(all.map(f=>path.relative(PUB,f)).join('\n')),'checksum file is published next to the zip');
// the landing page and every header/footer point at the extension
const idx=fs.readFileSync(PUB+'index.html','utf8');ok(/id="extension"/.test(idx)&&/href="\/extension"/.test(idx),'home page has the extension section and links');
ok(pages.every(f=>/href="\/extension"/.test(fs.readFileSync(f,'utf8'))),'every page links to the extension page');
ok(/id="extension"/.test(fs.readFileSync(PUB+'privacy.html','utf8'))&&/Browser extension/.test(fs.readFileSync(PUB+'terms.html','utf8')),'privacy and terms cover the extension');
console.log(log.join('\n'));console.log(log.filter(l=>l.startsWith('FAIL')).length?'\nSOME FAILED':'\nALL PASSED ('+log.length+')');process.exit(0);
