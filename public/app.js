(function(){
  const $ = s => document.querySelector(s);
  const DATE='(\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4})';
  const TIME='(\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?)\\s*([AaPp]\\.?\\s?[Mm]\\.?)?';
  const RE_AND=new RegExp('^'+DATE+',?\\s+'+TIME+'\\s+[-\u2013]\\s+(.*)$');
  const RE_IOS=new RegExp('^\\[\\s*'+DATE+',?\\s+'+TIME+'\\s*\\]\\s+(.*)$');
  const MEDIA=/^(<media omitted>|<attached:.*>|(image|video|audio|sticker|gif|document|contact card|voice call) omitted|\u200e?.*\(file attached\))$/i;
  const COLORS=['#c0392b','#8e44ad','#2980b9','#16a085','#d35400','#27ae60','#b9770e','#c2185b'];

  let messages=[], senders=[], titleEdited=false, fallbackTitle='Chat';
  const MIME={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',mov:'video/quicktime','3gp':'video/3gpp',webm:'video/webm',opus:'audio/ogg',ogg:'audio/ogg',m4a:'audio/mp4',mp3:'audio/mpeg',aac:'audio/aac',amr:'audio/amr',wav:'audio/wav',pdf:'application/pdf'};
  let zipMap=new Map(), urls=new Map();
  const ext=n=>(n.split('.').pop()||'').toLowerCase();
  const kindOf=n=>{const m=MIME[ext(n)]||'';return m.startsWith('image')?'image':m.startsWith('video')?'video':m.startsWith('audio')?'audio':'file';};
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){io.unobserve(e.target);e.target._load();}}),{rootMargin:'600px'});
  function mediaInfo(t){
    const L=t.split('\n');
    for(let i=0;i<L.length;i++){
      const a=L[i].trim().match(/^(?:<attached:\s*(.+?)>|(.+?)\s*\(file attached\))$/i);
      if(a)return{file:(a[1]||a[2]).trim(),cap:L.filter((_,j)=>j!==i).join('\n').trim()};
    }
    return null;
  }
  function getUrl(name){
    const k=name.toLowerCase();
    if(!urls.has(k))urls.set(k,zipMap.get(k).async('uint8array').then(u=>URL.createObjectURL(new Blob([u],{type:MIME[ext(k)]||'application/octet-stream'}))));
    return urls.get(k);
  }
  function mediaNode(name,exp,ready,inline){
    const k=kindOf(name), w=el('div','media'+(!exp&&(k==='image'||k==='video')?' big':''));
    let node;
    if(k==='image'){node=el('img');node.alt=name;}
    else if(k==='file'){node=el('a','mfile','\u{1F4CE} '+name);node.download=name;}
    else{
      node=el(k,'mplay');node.controls=true;node.preload='metadata';
      w.appendChild(el('div','mph',(k==='audio'?'\u{1F3A4} Voice/audio: ':'\u{1F39E} Video: ')+name));
    }
    w.appendChild(node);
    const load=()=>getUrl(name).then(u=>{k==='file'?node.href=u:node.src=u;w.classList.remove('big');});
    if(inline){ready.push(zipMap.get(name.toLowerCase()).async('base64').then(b=>{const d='data:'+(MIME[ext(name)]||'application/octet-stream')+';base64,'+b;k==='file'?node.href=d:node.src=d;w.classList.remove('big');}));}
    else if(exp){if(k==='image')ready.push(load().then(()=>node.decode().catch(()=>{})));}
    else{w._load=load;io.observe(w);}
    return w;
  }
  async function readZip(f){
    if(typeof JSZip==='undefined'){status('The zip library failed to load. Check your internet connection.');return;}
    try{
      status('Opening zip...');
      const z=await JSZip.loadAsync(f);
      const fs=Object.values(z.files).filter(e=>!e.dir&&!/__MACOSX|(^|\/)\._/.test(e.name));
      const tx=fs.find(e=>/\.txt$/i.test(e.name));
      if(!tx){status('No chat .txt file found in the zip.');return;}
      let skipped=0;
      fs.forEach(e=>{if(e===tx)return;if(cpMedia)zipMap.set(e.name.split('/').pop().toLowerCase(),e);else skipped++;});
      load(await tx.async('string'),tx.name.split('/').pop());
      if(skipped)status($('#status').textContent+' Photos, voice notes and videos are not included on the Free plan.');
    }catch(e){status('Zip error: '+e.message);}
  }
  function autoTitle(){
    if(titleEdited)return;
    const me=$('#me').value;
    $('#title').value=senders.length===2?(senders.find(s=>s!==me)||senders[0]):fallbackTitle;
  }

  const DEL=/^(this message was deleted|you deleted this message)\.?$/i, EDITED=/\s*<This message was edited>\s*$/i;
  const TOK=/```([\s\S]+?)```|(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)|(?<!\w)~([^~\n]+)~(?!\w)/g;
  const isDel=m=>!m.system&&DEL.test(m.text.trim());
  function fillText(sp,text){
    let i=0,m;TOK.lastIndex=0;
    while((m=TOK.exec(text))){
      if(m.index>i)sp.appendChild(document.createTextNode(text.slice(i,m.index)));
      let n;
      if(m[2]){n=el('a',null,m[2]);n.href=m[2];n.target='_blank';n.rel='noopener noreferrer';}
      else if(m[1]!=null)n=el('code',null,m[1]);
      else if(m[3]!=null)n=el('b',null,m[3]);
      else if(m[4]!=null)n=el('i',null,m[4]);
      else n=el('s',null,m[5]);
      sp.appendChild(n);i=m.index+m[0].length;
    }
    if(i<text.length)sp.appendChild(document.createTextNode(text.slice(i)));
  }
  function chatInfo(){
    const box=$('#info');
    if(!messages.length){box.hidden=true;return;}
    const del={};let ed=0,media=0,rest=0,n=0;
    messages.forEach(m=>{
      if(m.system)return;n++;
      if(isDel(m))del[m.sender]=(del[m.sender]||0)+1;
      if(EDITED.test(m.text))ed++;
      if(MEDIA.test(m.text.trim())||mediaInfo(m.text))media++;
      if(m.restored)rest++;
    });
    const nd=Object.values(del).reduce((a,b)=>a+b,0);
    const rows=[['Messages',n],['Period',messages[0].date+' to '+messages[messages.length-1].date],['Media',media],['Edited',ed],['Deleted',nd+(nd?' ('+Object.entries(del).map(([k,v])=>k+' '+v).join(', ')+')':'')]];
    if(rest)rows.push(['Restored',rest]);
    box.replaceChildren(el('b',null,'Chat info'),...rows.map(r=>el('div',null,r[0]+': '+r[1])));box.hidden=false;
  }
  const readText=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(f,'utf-8');});
  async function mergeOld(f){
    if(!messages.length){status('Load your current chat first.');return;}
    let t;
    try{
      if(/\.zip$/i.test(f.name)){
        const z=await JSZip.loadAsync(f);
        const e=Object.values(z.files).find(x=>!x.dir&&/\.txt$/i.test(x.name)&&!/__MACOSX|(^|\/)\._/.test(x.name));
        if(!e){status('No chat .txt found in that zip.');return;}
        t=await e.async('string');
      }else t=await readText(f);
    }catch(e){status('Could not read that file.');return;}
    const grp=(list,test)=>{const g=new Map();list.forEach(m=>{if(m.system||!test(m))return;const k=m.date+'|'+m.time+'|'+m.sender;if(!g.has(k))g.set(k,[]);g.get(k).push(m);});return g;};
    const olds=grp(parse(t),()=>true), dels=grp(messages,isDel), keeps=grp(messages,m=>!isDel(m));
    let n=0;
    dels.forEach((ds,k)=>{
      const have=new Set((keeps.get(k)||[]).map(m=>m.text));
      const cand=(olds.get(k)||[]).map(m=>m.text).filter(x=>!have.has(x)&&!DEL.test(x.trim()));
      if(cand.length===ds.length)ds.forEach((m,i)=>{m.text=cand[i];m.restored=true;n++;});
    });
    render();
    status(n?n+' deleted message(s) restored from the older export.':'No matching deleted messages found in that file.');
  }
  function clean(s){return s.replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g,'').replace(/[\u202f\u00a0]/g,' ');}

  function parse(text){
    const out=[]; let cur=null;
    for(const raw of text.replace(/\r/g,'').split('\n')){
      const line=clean(raw);
      const m=line.match(RE_AND)||line.match(RE_IOS);
      if(m){
        let time=m[2].replace(/^(\d{1,2}[:.]\d{2})[:.]\d{2}/,'$1');
        if(m[3]) time+=' '+m[3].toUpperCase().replace(/[.\s]/g,'');
        const rest=m[4];
        const i=rest.indexOf(': ');
        let sender=null,body=rest;
        if(i>0 && i<=60){sender=rest.slice(0,i);body=rest.slice(i+2);}
        cur={date:m[1],time:time,sender:sender,text:body,system:sender===null};
        out.push(cur);
      } else if(cur){
        cur.text+='\n'+line;
      }
    }
    return out;
  }

  function isoOf(s,fmt){
    const m=String(s).trim().match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/);
    if(!m)return '';
    let y,mo,d;
    if(m[1].length===4){y=+m[1];mo=+m[2];d=+m[3];}
    else{const a=+m[1],b=+m[2],c=+m[3];y=c<100?2000+c:c;if(fmt==='mdy'){mo=a;d=b;}else{d=a;mo=b;}}
    if(mo<1||mo>12||d<1||d>31)return '';
    return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function guessFmt(){
    let dm=0,md=0;
    new Set(messages.map(m=>m.date)).forEach(s=>{const x=String(s).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}$/);if(x){if(+x[1]>12)dm=1;if(+x[2]>12)md=1;}});
    return md&&!dm?'mdy':'dmy';
  }
  function dateSetup(){
    const pick=$('#dfmt').value,fmt=pick==='auto'?guessFmt():pick;
    messages.forEach(m=>{m.iso=isoOf(m.date,fmt);});
    const isos=messages.map(m=>m.iso).filter(Boolean).sort();
    if(isos.length){$('#dfrom').min=$('#dto').min=isos[0];$('#dfrom').max=$('#dto').max=isos[isos.length-1];}
  }
  function visible(){
    const showSys=$('#showSys').checked, hideMedia=$('#hideMedia').checked;
    return messages.filter(m=>{
      if(m.system && !showSys) return false;
      if(!$('#showDel').checked&&isDel(m))return false;
      const df=$('#dfrom').value,dt=$('#dto').value;
      if((df||dt)&&m.iso){if(df&&m.iso<df)return false;if(dt&&m.iso>dt)return false;}
      const q=$('#q').value.trim().toLowerCase();if(q&&!(m.text+' '+(m.sender||'')).toLowerCase().includes(q))return false;
      if(!m.system && hideMedia){const t=m.text.trim(),mi=zipMap.size&&mediaInfo(t);if(MEDIA.test(t)||(mi&&!mi.cap))return false;}
      return true;
    });
  }

  function colorFor(name){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;return COLORS[h%COLORS.length];}
  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}

  function buildChat(list,exportMode,inline){
    const me=$('#me').value, showTime=$('#showTime').checked;
    const title=$('#title').value.trim()||'Chat';
    const group=senders.length>2, ready=[];
    const root=el('div','chat '+($('#theme').value==='dark'?'dark':'')+(exportMode?' export':''));
    const head=el('div','chat-head');
    head.appendChild(el('div','avatar',(title[0]||'C').toUpperCase()));
    const ht=el('div');
    ht.appendChild(el('div','t',title));
    if(group){const names=senders.filter(s=>s!==me).concat(senders.includes(me)?['You']:[]).join(', ');ht.appendChild(el('div','s',names.length>90?names.slice(0,88)+'\u2026':names));}
    head.appendChild(ht); root.appendChild(head);
    const box=el('div','msgs'); root.appendChild(box);

    let lastDate=null,lastSender=null;
    for(const m of list){
      if(m.date!==lastDate){box.appendChild(el('div','day',m.date));lastDate=m.date;lastSender=null;}
      if(m.system){box.appendChild(el('div','sys',m.text));lastSender=null;continue;}
      const mine=m.sender===me, cont=lastSender===m.sender;
      const b=el('div','b '+(mine?'me':'them')+(cont?' cont':'')+(isDel(m)?' del':'')+(m.restored?' rest':''));
      if(group && !mine && !cont){const w=el('div','who',m.sender);w.style.color=colorFor(m.sender);b.appendChild(w);}
      const mi=zipMap.size?mediaInfo(m.text):null;
      if(mi&&zipMap.has(mi.file.toLowerCase())){
        b.appendChild(mediaNode(mi.file,exportMode,ready,inline));
        if(mi.cap){const c=el('span','txt');fillText(c,mi.cap);c.setAttribute('dir','auto');b.appendChild(c);}
      }else{
        const ed=EDITED.test(m.text),body=m.text.replace(EDITED,''),emo=[...body.matchAll(/\p{Extended_Pictographic}/gu)].length;
        const onlyEmo=emo&&emo<=3&&!body.replace(/[\p{Extended_Pictographic}\u200d\ufe0f\s]/gu,'');
        const t=el('span','txt'+(MEDIA.test(m.text.trim())?' media':'')+(onlyEmo?' emo':''));
        if(isDel(m))t.appendChild(document.createTextNode('\u{1F6AB} '));
        fillText(t,body);t.setAttribute('dir','auto');b.appendChild(t);
        if(m.restored)b.appendChild(el('span','ed','restored from earlier export'));
        if(ed)b.appendChild(el('span','ed','edited'));
      }
      if(showTime) b.appendChild(el('span','tm',m.time));
      box.appendChild(b);
      lastSender=m.sender;
    }
    root._ready=ready;return root;
  }

  function render(){
    const stage=$('#stage');
    if(!messages.length){return;}
    io.disconnect();chatInfo();
    const list=visible();$('#shown').textContent=list.length===messages.length?'':'Showing '+list.length+' of '+messages.length+' messages.';
    if(!list.length){stage.replaceChildren(el('div','empty','No messages match your filters.'));return;}
    stage.replaceChildren(buildChat(list,false));
  }

  function status(t){$('#status').textContent=t;}

  function load(text,name){
    messages=parse(text);
    if(!messages.length){
      $('#stage').replaceChildren(el('div','empty','No WhatsApp messages found. Make sure this is the .txt file from "Export chat".'));
      $('#pdf').disabled=$('#png').disabled=$('#html').disabled=true;$('#me').disabled=true;
      $('#info').hidden=true;status('Could not recognise the chat format.');return;
    }
    const counts={};
    messages.forEach(m=>{if(m.sender)counts[m.sender]=(counts[m.sender]||0)+1;});
    senders=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
    const sel=$('#me'); sel.replaceChildren();
    senders.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s+' ('+counts[s]+')';sel.appendChild(o);});
    sel.disabled=false;
    titleEdited=false; fallbackTitle=(name||'Chat').replace(/^WhatsApp Chat (with|-) /i,'').replace(/\.txt$/i,'');
    autoTitle();dateSetup();
    $('#pdf').disabled=$('#png').disabled=$('#html').disabled=false;
    status(messages.length+' messages, '+senders.length+' people, '+zipMap.size+' media. Pick your name under "My name".');
    render();
  }

  function readFile(f){
    if(!f)return;
    $('#fname').textContent=f.name;
    if(cpPass!==f){cpGate(f).then(ok=>{if(ok){cpPass=f;readFile(f);}});return;}cpPass=null;
    urls.forEach(p=>p.then(u=>URL.revokeObjectURL(u)));urls=new Map();zipMap=new Map();
    if(/\.zip$/i.test(f.name)){readZip(f);return;}
    const r=new FileReader();
    r.onload=()=>load(String(r.result),f.name);
    r.readAsText(f,'utf-8');
  }

  const drop=$('#drop'),file=$('#file');
  drop.addEventListener('click',()=>file.click());
  drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}});
  file.addEventListener('change',()=>readFile(file.files[0]));
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
  drop.addEventListener('drop',e=>readFile(e.dataTransfer.files[0]));

  ['me','theme','showTime','showSys','hideMedia'].forEach(id=>$('#'+id).addEventListener('change',()=>{if(id==='me')autoTitle();render();}));
  $('#title').addEventListener('input',()=>{titleEdited=true;render();});

  $('#pdf').addEventListener('click',async()=>{
    status('Preparing PDF...');
    const node=buildChat(visible(),true);
    $('#stage').replaceChildren(node);
    await Promise.all(node._ready);
    status('');window.print();
  });
  window.addEventListener('afterprint',render);
  $('#dfrom').addEventListener('change',render);$('#dto').addEventListener('change',render);
  $('#dfmt').addEventListener('change',()=>{if(messages.length){dateSetup();render();}});
  $('#dclear').addEventListener('click',()=>{$('#dfrom').value=$('#dto').value='';render();});
  $('#showDel').addEventListener('change',render);
  $('#addold').addEventListener('click',()=>$('#file2').click());
  $('#file2').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)mergeOld(f);});
  let qt;$('#q').addEventListener('input',()=>{clearTimeout(qt);qt=setTimeout(render,250);});

  /* ---- settings come from config.js (public values) ---- */
  const CFG=window.CHATPRINTER||{};
  const APPWRITE_ENDPOINT=CFG.endpoint||'https://cloud.appwrite.io/v1', APPWRITE_PROJECT_ID=CFG.projectId||'YOUR-PROJECT-ID', FUNCTION_ID=CFG.functionId||'YOUR-FUNCTION-ID';
  const SUPPORT_EMAIL=CFG.supportEmail||'support@yourdomain.com', PAY_NUMBER=CFG.payNumber||'', WA=CFG.whatsapp||'';
  const MB=1048576, GB=1024*MB;
  const PLANS={
    free:{name:'Free',price:0,maxBytes:200*MB,total:2,day:0,media:false,pts:['2 conversions in total','Text only: no photos, voice notes or videos','Zip files up to 200 MB','PDF, PNG and HTML export']},
    pro:{name:'Pro',price:450,maxBytes:GB,total:0,day:20,media:true,hot:1,pts:['Photos, voice notes and videos included','20 conversions per day, renewed the next day','Zip files up to 1 GB','Everything in Free']},
    ultra:{name:'Ultra Pro',price:750,maxBytes:0,total:0,day:0,media:true,pts:['Photos, voice notes and videos included','No file size limit','No daily limit','Everything in Pro']}
  };
  const PAYNUM=Object.assign({JazzCash:PAY_NUMBER,Easypaisa:PAY_NUMBER,SadaPay:PAY_NUMBER},CFG.payNumbers||{});
  const PRICE_TABLE=CFG.prices||{PKR:{pro:450,ultra:750},USD:{pro:3.99,ultra:6.99},EUR:{pro:3.99,ultra:6.99},GBP:{pro:3.49,ultra:5.99},SAR:{pro:14.99,ultra:24.99},AED:{pro:14.99,ultra:24.99},CNY:{pro:28,ultra:48},INR:{pro:299,ultra:499}};
  const CURNAMES={PKR:'Pakistani rupee',USD:'US dollar',EUR:'Euro',GBP:'British pound',SAR:'Saudi riyal',AED:'UAE dirham',CNY:'Chinese yuan',INR:'Indian rupee'};
  const fmtMoney=(c,n)=>{try{return new Intl.NumberFormat('en',{style:'currency',currency:c,minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2}).format(n);}catch(e){return c+' '+n;}};
  const lsGet=k=>{try{return localStorage.getItem(k);}catch(e){return null;}}, lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};
  const tzGuess=()=>{let z='';try{z=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}return z==='Asia/Karachi'?'PKR':z==='Asia/Riyadh'?'SAR':z==='Asia/Dubai'?'AED':z==='Asia/Shanghai'?'CNY':z==='Asia/Kolkata'||z==='Asia/Calcutta'?'INR':z==='Europe/London'?'GBP':/^Europe\//.test(z)?'EUR':'USD';};
  let cur=PRICE_TABLE[lsGet('cp_cur')]?lsGet('cp_cur'):tzGuess(), curNote='';
  const AW=window.Appwrite, awOk=!!AW&&!APPWRITE_PROJECT_ID.startsWith('YOUR-')&&!FUNCTION_ID.startsWith('YOUR-');
  const client=awOk?new AW.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID):null;
  const account=client&&new AW.Account(client), fns=client&&new AW.Functions(client);
  let user=null,st=null,cpPass=null,otpUser=null,cpErr='',cpMedia=false,needPw=false,loading=true,pendScroll=null,resetCtx=null,aTab='ov',uOff=0;
  const cpFmt=n=>n>=GB?(n/GB).toFixed(1)+' GB':Math.round(n/MB)+' MB';
  const amsg=t=>{$('#aus').textContent=t;}, say=(s,t)=>{$(s).textContent=t;};
  const initials=n=>((n||'?').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2)||'?').toUpperCase();
  const fmtDate=iso=>{try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){return '';}};
  const shortDate=iso=>{try{return new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short'});}catch(e){return '';}};
  const EYE_ON='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0112 20C5 20 1 12 1 12a18.5 18.5 0 015.1-5.9M9.9 4.2A10.7 10.7 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 11-4.2-4.2"/></svg>';
  const COMMON=['password','123456','12345678','qwerty','abc123','111111','iloveyou','admin','welcome','letmein','pakistan','whatsapp','chatprinter','1234567890','qwertyuiop','000000','123123','dragon','monkey','football'];
  function pwCheck(p,email){
    const low=p.toLowerCase(),local=(email||'').split('@')[0].toLowerCase();
    const kinds=[/[a-z]/,/[A-Z]/,/\d/,/[^A-Za-z0-9]/].filter(r=>r.test(p)).length;
    let s=(p.length>=8?1:0)+(p.length>=12?1:0)+(p.length>=16?1:0)+(kinds>=3?1:0)+(kinds===4?1:0);
    const bad=COMMON.some(c=>low.includes(c))||(local.length>=3&&low.includes(local))||/(.)\1{3,}/.test(p)||/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(p);
    if(bad)s=Math.min(s,1);
    const tips=[];
    if(p.length<12)tips.push('use 12 or more characters');
    if(!/[a-z]/.test(p)||!/[A-Z]/.test(p))tips.push('mix upper and lower case');
    if(!/\d/.test(p))tips.push('add a number');
    if(!/[^A-Za-z0-9]/.test(p))tips.push('add a symbol');
    if(bad)tips.push('avoid common words, your name or email, repeated or sequential characters');
    const label=p.length===0?'':s<=1?'Too weak':s===2?'Fair':s<=4?'Good':'Strong';
    const ok=p.length>=8&&s>=3&&!bad;
    return{score:s,label,ok,tips,msg:'Choose a stronger password: '+(tips.join(', ')||'make it longer')+'.'};
  }
  function genPw(){
    const sets=['abcdefghijkmnopqrstuvwxyz','ABCDEFGHJKLMNPQRSTUVWXYZ','23456789','!@#$%^&*-_+=?'],all=sets.join(''),r=new Uint32Array(40);
    crypto.getRandomValues(r);
    const out=sets.map((s,i)=>s[r[i]%s.length]);
    for(let i=4;i<18;i++)out.push(all[r[i]%all.length]);
    for(let i=out.length-1;i>0;i--){const k=r[20+i]%(i+1);[out[i],out[k]]=[out[k],out[i]];}
    return out.join('');
  }
  function enhancePw(){
    document.querySelectorAll('input[type=password]').forEach(inp=>{
      const w=document.createElement('div');w.className='pwrap';inp.parentNode.insertBefore(w,inp);w.appendChild(inp);
      const b=document.createElement('button');b.type='button';b.className='eye';b.setAttribute('aria-label','Show password');b.innerHTML=EYE_ON;
      b.addEventListener('click',()=>{const show=inp.type==='password';inp.type=show?'text':'password';b.innerHTML=show?EYE_OFF:EYE_ON;b.setAttribute('aria-label',show?'Hide password':'Show password');});
      w.appendChild(b);
      if(inp.dataset.strength===undefined)return;
      const m=document.createElement('div');m.className='pwmeter';m.appendChild(document.createElement('i'));
      const hint=document.createElement('div');hint.className='pwhint';hint.textContent='Use 12 or more characters with upper and lower case, a number and a symbol.';
      const g=document.createElement('button');g.type='button';g.className='alt sm gen';g.textContent='Suggest a strong password';
      w.after(m,hint,g);
      inp.addEventListener('input',()=>{
        const c=pwCheck(inp.value,user&&user.email);
        m.firstChild.style.width=(c.score/5*100)+'%';m.dataset.lv=String(c.label);
        hint.textContent=inp.value?(c.label+(c.ok?'. Looks good.':'. '+c.tips.join(', ')+'.')):'Use 12 or more characters with upper and lower case, a number and a symbol.';
      });
      g.addEventListener('click',()=>{
        const v=genPw(),peer=$('#'+inp.dataset.peer);inp.value=v;if(peer)peer.value=v;
        inp.type='text';if(peer)peer.type='text';inp.dispatchEvent(new Event('input'));
      });
    });
  }
  function setCur(c,save){
    if(!PRICE_TABLE[c])return;
    cur=c;if(save)lsSet('cp_cur',c);
    ['curpick','curpick2','pref_cur'].forEach(id=>{const s=document.getElementById(id);if(s)s.value=c;});
    ['curnote','curnote2'].forEach(id=>{const n=document.getElementById(id);if(n)n.textContent=curNote;});
    planCards($('#plans'),true);planCards($('#planprev'),false);
  }
  async function detectCur(){
    if(lsGet('cp_cur')||!account)return;
    try{
      const l=await new AW.Locale(client).get(),cc=l.countryCode;
      const c=cc==='PK'?'PKR':cc==='GB'?'GBP':l.eu?'EUR':cc==='SA'?'SAR':cc==='AE'?'AED':cc==='CN'?'CNY':cc==='IN'?'INR':'USD';
      curNote=l.country?'Detected location: '+l.country+'.':'';setCur(c,false);
    }catch(e){}
  }
  function paintAv(node,u){
    node.replaceChildren();
    const a=u&&u.prefs&&u.prefs.avatar;
    if(a&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(a)){const i=document.createElement('img');i.src=a;i.alt='';node.appendChild(i);}
    else node.textContent=u?initials(u.name||u.email):'?';
  }
  async function api(action,data){
    try{
      const ex=await fns.createExecution({functionId:FUNCTION_ID,body:JSON.stringify(Object.assign({action},data||{})),async:false,xpath:'/',method:'POST',headers:{'content-type':'application/json'}});
      return JSON.parse(ex.responseBody||'{}');
    }catch(e){return{ok:false,reason:'Could not reach the server.'};}
  }
  function go(view,scrollId){pendScroll=scrollId||null;if((location.hash||'#home')==='#'+view)route();else location.hash=view;}
  function receipt(x){
    const w=window.open('','_blank');if(!w)return;
    const d=w.document,amt=fmtMoney(x.currency||'PKR',(x.amountCents||0)/100);
    d.title='Chat Printer receipt';
    const st=d.createElement('style');st.textContent='body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;color:#111b21}h1{font-size:22px;color:#075e54;margin:0 0 4px}small{color:#667781}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:9px 0;border-bottom:1px solid #ddd}td:first-child{color:#667781;width:40%}';
    d.head.appendChild(st);
    const h=d.createElement('h1');h.textContent='Chat Printer';const s=d.createElement('small');s.textContent='Payment receipt';
    const t=d.createElement('table');
    [['Plan',(PLANS[x.plan]||{}).name+' (30 days)'],['Amount',amt],['Method',x.method||''],['Transaction ID',x.tid||''],['Date',fmtDate(x.created)],['Account',(user&&(user.email||user.name))||''],['Status',x.status]].forEach(([a,b])=>{const r=d.createElement('tr'),c1=d.createElement('td'),c2=d.createElement('td');c1.textContent=a;c2.textContent=b;r.append(c1,c2);t.appendChild(r);});
    d.body.append(h,s,t);w.focus();setTimeout(()=>w.print(),100);
  }
  async function loadPay(){
    const r=await api('my_payments');
    if(!r.ok||!r.rows.length)return;
    $('#mypay').replaceChildren(...r.rows.map(x=>{
      const d=el('div','arow'),m=el('div','grow');
      m.append(el('b',null,(PLANS[x.plan]||{}).name||x.plan),el('small',null,fmtMoney(x.currency||'PKR',(x.amountCents||0)/100)+' \u00b7 '+(x.method||'')+' \u00b7 TID '+(x.tid||'')+' \u00b7 '+shortDate(x.created)));
      d.append(m,el('span','chip '+x.status,x.status));
      if(x.status==='approved'){const b=el('button','alt sm','Receipt');b.addEventListener('click',()=>receipt(x));d.appendChild(b);}
      return d;
    }));
  }
  function cpBar(){
    const signed=!!user;let t,P=null;
    $('#navtxt').textContent=signed?(user.name||'Account').split(' ')[0]:'Sign in';
    paintAv($('#hav'),user);
    $('#navadmin').hidden=!(st&&st.is_admin);
    $('#authbox').hidden=signed;$('#dash').hidden=!signed;
    if(!account)t='Sign-in is not configured yet.';
    else if(!user)t='Sign in to use the converter.';
    else if(!st)t=cpErr||'Loading your plan...';
    else{
      P=PLANS[st.plan];let left='Unlimited conversions';
      if(P.total)left=Math.max(0,P.total-st.total_used)+' of '+P.total+' conversions left';
      else if(P.day)left=Math.max(0,P.day-st.day_used)+' of '+P.day+' left today';
      t=P.name+' plan \u00b7 '+left+' \u00b7 '+(P.media?'photos, voice notes and videos included':'text only')+' \u00b7 '+(P.maxBytes?'max '+cpFmt(P.maxBytes):'no size limit')+(st.plan==='free'?'':' \u00b7 valid until '+fmtDate(st.expires_at));
    }
    $('#plantext').textContent=t;
    if(!signed)return;
    paintAv($('#avbig'),user);paintAv($('#avprev'),user);
    $('#pname2').textContent=user.name||'Add your name';$('#pemail').textContent=user.email||'Signed in without an email';
    const b=$('#pbadge');b.textContent=P?P.name+' plan':'...';b.className='badge '+(st?st.plan:'');
    $('#pexp').textContent=st&&st.plan!=='free'?'Valid until '+fmtDate(st.expires_at):'';
    $('#finish').hidden=!needPw;
    $('#pwcard').hidden=!user.email;$('#pw_oldrow').hidden=!user.passwordUpdate;$('#pw_h').textContent=user.passwordUpdate?'Change password':'Set a password';
    if(document.activeElement!==$('#pf_name'))$('#pf_name').value=user.name||'';
    if(document.activeElement!==$('#pf_phone'))$('#pf_phone').value=(user.prefs&&user.prefs.phone)||'';
    $('#pf_email').value=user.email||'(none)';
    const u=$('#usage');u.replaceChildren();
    if(P){
      if(P.total||P.day){
        const used=P.total?st.total_used:st.day_used,lim=P.total||P.day,m=el('div','meter'),i=document.createElement('i');
        i.style.width=Math.min(100,used/lim*100)+'%';m.appendChild(i);
        u.append(el('div','sub',(P.total?'Conversions used: ':'Used today: ')+used+' of '+lim),m);
      }else u.appendChild(el('div','sub','Unlimited conversions'));
      [['Plan',P.name],['Media',P.media?'Included':'Not included (text only)'],['Largest file',P.maxBytes?cpFmt(P.maxBytes):'No limit'],['Valid until',st.plan==='free'?'Does not expire':fmtDate(st.expires_at)]].forEach(([a,c])=>{const r=el('div','fact');r.append(el('span',null,a),el('span',null,c));u.appendChild(r);});
    }
  }
  async function cpRefresh(){
    user=null;st=null;
    if(account){try{user=await account.get();}catch(e){user=null;}}
    cpBar();
    if(user){
      st=await api('status');
      if(!st.ok){cpErr=st.reason||'Could not load your plan.';st=null;}else cpErr='';
      cpBar();loadPay();loadSessions();
      if(user.prefs&&PRICE_TABLE[user.prefs.currency]&&user.prefs.currency!==cur)setCur(user.prefs.currency,false);
      if(st&&st.is_admin){atab(aTab);if(st.setup_needed)say('#adm','The database is not set up yet. Open the Database tab and press "Run database setup".');}
    }
    loading=false;route();
  }
  async function cpGate(f){
    if(!account){status('Sign-in is not configured yet.');return false;}
    if(!user){status('Please sign in first.');location.hash='account';return false;}
    if(needPw){status('Please finish your account first: set a password on the Account page.');location.hash='account';return false;}
    const r=await api('begin',{size:f.size});
    cpMedia=!!r.media;
    cpRefresh();
    if(!r.ok){status(r.reason||'Could not check your plan. Try again.');return false;}
    return true;
  }
  function showPane(n){
    ['paneIn','paneUp','paneForgot','paneReset'].forEach(x=>{$('#'+x).hidden=x!==n;});
    $('#tabin').classList.toggle('on',n!=='paneUp');$('#tabup').classList.toggle('on',n==='paneUp');amsg('');
  }
  $('#tabin').addEventListener('click',()=>showPane('paneIn'));
  $('#tabup').addEventListener('click',()=>showPane('paneUp'));
  $('#backin').addEventListener('click',()=>showPane('paneIn'));
  $('#goforgot').addEventListener('click',e=>{e.preventDefault();showPane('paneForgot');});
  $('#doin').addEventListener('click',async()=>{
    const e=$('#li_email').value.trim(),p=$('#li_pass').value;
    if(!account)return amsg('Sign-in is not configured yet.');
    if(!/^\S+@\S+\.\S+$/.test(e)||!p)return amsg('Enter your email and password.');
    try{await account.createEmailPasswordSession({email:e,password:p});amsg('');$('#li_pass').value='';needPw=false;await cpRefresh();location.hash='home';}
    catch(err){amsg(err&&err.code===401?'Wrong email or password. If you signed up with a code, use "Forgot password?" to set one.':'Could not sign in: '+((err&&err.message)||'network error'));}
  });
  $('#sendotp').addEventListener('click',async()=>{
    const v=$('#su_email').value.trim();
    if(!account)return amsg('Sign-in is not configured yet.');
    if(!/^\S+@\S+\.\S+$/.test(v))return amsg('Enter a valid email address.');
    try{
      const t=await account.createEmailToken({userId:AW.ID.unique(),email:v});
      otpUser=t.userId;$('#otpbox').hidden=false;amsg('Code sent. Check your email (and the spam folder).');
    }catch(e){amsg('Could not send the code: '+((e&&e.message)||'network error'));}
  });
  $('#verify').addEventListener('click',async()=>{
    const t=$('#acode').value.trim();
    if(!account||!otpUser||!t)return;
    try{
      await account.createSession({userId:otpUser,secret:t});
      amsg('');otpUser=null;$('#otpbox').hidden=true;$('#acode').value='';
      await cpRefresh();needPw=!!user&&!user.passwordUpdate;cpBar();location.hash='account';
    }catch(e){amsg('Invalid or expired code.');}
  });
  $('#dofp').addEventListener('click',async()=>{
    const e=$('#fp_email').value.trim();
    if(!account)return amsg('Sign-in is not configured yet.');
    if(!/^\S+@\S+\.\S+$/.test(e))return amsg('Enter a valid email address.');
    try{await account.createRecovery({email:e,url:location.origin+'/?mode=reset'});}catch(err){}
    amsg('If an account exists for this email, a reset link is on its way. Check your spam folder too.');
  });
  $('#dors').addEventListener('click',async()=>{
    const p=$('#rs_pw').value,p2=$('#rs_pw2').value;
    const pc=pwCheck(p,'');if(!pc.ok)return amsg(pc.msg);
    if(p!==p2)return amsg('The two passwords do not match.');
    if(!resetCtx)return amsg('This reset link is not valid. Request a new one.');
    try{await account.updateRecovery({userId:resetCtx.uid,secret:resetCtx.sec,password:p});resetCtx=null;$('#rs_pw').value=$('#rs_pw2').value='';showPane('paneIn');amsg('Password updated. Sign in with your new password.');}
    catch(e){amsg('This link has expired or is invalid. Request a new one.');}
  });
  const social=p=>()=>{if(!account)return amsg('Sign-in is not configured yet.');account.createOAuth2Token({provider:AW.OAuthProvider[p],success:location.origin+'/',failure:location.origin+'/?auth=failed'});};
  $('#gbtn').addEventListener('click',social('Google'));
  $('#fbtn').addEventListener('click',social('Facebook'));
  $('#hbtn').addEventListener('click',social('Github'));
  $('#tbtn').addEventListener('click',social('Tiktok'));
  $('#signout').addEventListener('click',async()=>{try{if(account)await account.deleteSession({sessionId:'current'});}catch(e){}needPw=false;await cpRefresh();location.hash='home';});
  $('#signoutall').addEventListener('click',async()=>{try{if(account)await account.deleteSessions();}catch(e){}needPw=false;await cpRefresh();location.hash='home';});
  $('#pf_save').addEventListener('click',async()=>{
    const n=$('#pf_name').value.trim(),ph=$('#pf_phone').value.trim().replace(/[\s-]/g,'');
    if(!user)return;
    if(!n)return say('#pf_s','Enter your name.');
    if(ph&&!/^\+?\d{10,15}$/.test(ph))return say('#pf_s','Phone must be 10 to 15 digits, for example +923001234567.');
    try{
      if(n!==user.name)await account.updateName({name:n});
      await account.updatePrefs({prefs:Object.assign({},user.prefs||{},{phone:ph})});
      say('#pf_s','Saved.');await cpRefresh();
    }catch(e){say('#pf_s','Could not save: '+((e&&e.message)||'error'));}
  });
  $('#pw_save').addEventListener('click',async()=>{
    const o=$('#pw_old').value,n=$('#pw_new').value,n2=$('#pw_new2').value;
    if(!user)return;
    const pc=pwCheck(n,user.email);if(!pc.ok)return say('#pw_s',pc.msg);
    if(n!==n2)return say('#pw_s','The two passwords do not match.');
    if(user.passwordUpdate&&!o)return say('#pw_s','Enter your current password.');
    try{
      await account.updatePassword(user.passwordUpdate?{password:n,oldPassword:o}:{password:n});
      needPw=false;$('#pw_old').value=$('#pw_new').value=$('#pw_new2').value='';say('#pw_s','Password saved.');await cpRefresh();
    }catch(e){say('#pw_s',e&&e.code===401?'The current password is wrong.':'Could not save: '+((e&&e.message)||'error'));}
  });
  function shrink(file){
    return new Promise((res,rej)=>{
      if(!/^image\//.test(file.type))return rej(new Error('Choose an image file.'));
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{const s=Math.min(img.width,img.height),c=document.createElement('canvas');c.width=c.height=160;c.getContext('2d').drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,160,160);URL.revokeObjectURL(url);res(c.toDataURL('image/jpeg',0.82));};
      img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('Could not read that image.'));};
      img.src=url;
    });
  }
  $('#pf_pick').addEventListener('click',()=>$('#pf_photo').click());
  $('#pf_photo').addEventListener('change',async e=>{
    const f=e.target.files[0];e.target.value='';
    if(!f||!user)return;
    try{const d=await shrink(f);await account.updatePrefs({prefs:Object.assign({},user.prefs||{},{avatar:d})});say('#pf_s','Photo updated.');await cpRefresh();}
    catch(err){say('#pf_s',(err&&err.message)||'Could not update the photo.');}
  });
  $('#pf_rm').addEventListener('click',async()=>{
    if(!user)return;const p=Object.assign({},user.prefs||{});delete p.avatar;
    try{await account.updatePrefs({prefs:p});say('#pf_s','Photo removed.');await cpRefresh();}catch(err){say('#pf_s','Could not remove the photo.');}
  });
  const csvCell=v=>{let s=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  function download(name,text,type){const b=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);}
  async function loadStats(){
    const [r,rv]=await Promise.all([api('admin_stats'),api('admin_revenue')]);
    if(!r.ok){say('#adm',r.reason||'');return;}
    const items=[['Users',r.users==null?'n/a':r.users],['Active paid plans',r.active],['Pending payments',r.pending],['Approved payments',r.approved]];
    $('#stats').replaceChildren(...items.map(([a,b])=>{const d=el('div','stat');d.append(el('b',null,String(b)),el('span',null,a));return d;}));
    const days=[];for(let i=29;i>=0;i--){const d=new Date(Date.now()-i*864e5).toISOString().slice(0,10);days.push([d,((rv&&rv.days)||{})[d]||0]);}
    const max=Math.max(1,...days.map(x=>x[1]));
    $('#chart').replaceChildren(...days.map(([d,n])=>{const c=el('div','bar'),i=document.createElement('i');i.style.height=Math.max(3,n/max*100)+'%';c.title=d+': '+n;c.appendChild(i);return c;}));
    const tot=(rv&&rv.totals)||{};
    $('#revnote').textContent='Revenue, last 30 days: '+(Object.keys(tot).map(k=>fmtMoney(k,tot[k]/100)).join(' \u00b7 ')||'none yet')+'. Bars show approved payments per day.';
    $('#statnote').textContent=r.users==null?'The user count needs the users.read scope on the function.':'';
  }
  async function loadPayments(){
    const r=await api('admin_payments',{status:$('#pfilter').value}),box=$('#pend');
    if(!r.ok){say('#adm',r.reason||'');return;}
    if(!r.rows.length){box.replaceChildren(el('div','sub','Nothing here.'));return;}
    box.replaceChildren(...r.rows.map(x=>{
      const row=el('div','arow'),main=el('div','grow');
      main.append(el('b',null,x.name),el('small',null,(PLANS[x.plan]||{}).name+' \u00b7 '+fmtMoney(x.currency,x.amountCents/100)+' \u00b7 '+x.method+' \u00b7 TID '+x.tid+' \u00b7 '+shortDate(x.created)));
      row.append(main,el('span','chip',x.source),el('span','chip '+x.status,x.status));
      if(x.status==='pending'){
        const a=el('button','sm','Approve'),b=el('button','alt sm','Reject');
        const act=d=>async()=>{const z=await api('admin_decide',{id:x.id,decision:d});say('#adm',z.ok?'Done.':(z.reason||'Failed.'));loadPayments();loadStats();};
        a.addEventListener('click',act('approve'));b.addEventListener('click',act('reject'));row.append(a,b);
      }
      return row;
    }));
  }
  async function loadUsers(){
    const r=await api('admin_users',{search:$('#usearch').value.trim(),offset:uOff}),box=$('#ulist');
    if(!r.ok){say('#adm',r.reason||'');box.replaceChildren();return;}
    $('#upage').textContent=r.total?(uOff+1)+'-'+(uOff+r.rows.length)+' of '+r.total:'No users';
    $('#uprev').disabled=uOff<=0;$('#unext').disabled=uOff+r.rows.length>=r.total;
    box.replaceChildren(...r.rows.map(x=>{
      const row=el('div','arow'),main=el('div','grow');
      main.append(el('b',null,x.name||'(no name)'),el('small',null,(x.email||'(no email)')+(x.phone?' \u00b7 '+x.phone:'')+(x.verified?'':' \u00b7 not verified')),el('small',null,'Joined '+shortDate(x.created)+' \u00b7 '+x.total_used+' free conversions used'));
      row.append(el('span','av',initials(x.name||x.email)),main,el('span','chip '+(x.plan==='free'?'':'approved'),x.plan==='free'?'Free':PLANS[x.plan].name+(x.expires_at?' until '+shortDate(x.expires_at):'')));
      [['Grant Pro','pro'],['Grant Ultra','ultra'],['End plan now','free']].forEach(([lab,pl])=>{
        const b=el('button','alt sm',lab);
        b.addEventListener('click',async()=>{
          const days=Math.max(1,Math.min(3650,Number($('#ugdays').value)||30));
          if(!confirm((pl==='free'?'End the plan of ':'Give '+PLANS[pl].name+' for '+days+' days to ')+(x.email||x.name||x.id)+'?'))return;
          const z=await api('admin_set_plan',{userId:x.id,plan:pl,days});say('#adm',z.ok?'Plan updated.':(z.reason||'Failed.'));loadUsers();
        });
        row.appendChild(b);
      });
      return row;
    }));
  }
  async function loadAuto(){
    const r=await api('admin_automation'),box=$('#autobox'),list=$('#smslist');
    if(!r.ok){say('#adm',r.reason||'');return;}
    box.replaceChildren(el('h3',null,'Automatic payments'));
    [['Pakistan wallets (payment SMS)',r.sms_enabled?'On':'Off: set SMS_SECRET'],['Card payments (checkout)',r.paddle_ready?'Ready ('+r.paddle_env+')':'Not set up'],['Card payment webhook',r.paddle_webhook?'Configured':'Not set up']].forEach(([a,b])=>{const d=el('div','fact');d.append(el('span',null,a),el('span',null,b));box.appendChild(d);});
    list.replaceChildren(...(r.sms.length?r.sms.map(x=>{const row=el('div','arow'),m=el('div','grow',x.text);m.appendChild(el('small',null,shortDate(x.created)));row.append(m,el('span','chip '+(x.matched?'approved':''),x.matched?'matched':'no match'));return row;}):[el('div','sub','No payment SMS received yet.')]));
  }
  function atab(t){
    aTab=t;
    document.querySelectorAll('[data-at]').forEach(b=>b.classList.toggle('on',b.dataset.at===t));
    ['ov','pay','usr','auto','db'].forEach(x=>{$('#at-'+x).hidden=x!==t;});
    ({ov:loadStats,pay:loadPayments,usr:loadUsers,auto:loadAuto,db:()=>{}})[t]();
  }
  document.querySelectorAll('[data-at]').forEach(b=>b.addEventListener('click',()=>{say('#adm','');atab(b.dataset.at);}));
  $('#prefresh').addEventListener('click',loadPayments);$('#pfilter').addEventListener('change',loadPayments);
  $('#pcsv').addEventListener('click',async()=>{
    const r=await api('admin_payments',{status:$('#pfilter').value,limit:500});
    if(!r.ok)return say('#adm',r.reason||'Failed.');
    const head=['date','name','plan','amount','currency','method','tid','status','source','user_id'];
    download('payments.csv',[head.join(',')].concat(r.rows.map(x=>[x.created,x.name,x.plan,(x.amountCents/100).toFixed(2),x.currency,x.method,x.tid,x.status,x.source,x.userId].map(csvCell).join(','))).join('\n'),'text/csv');
    say('#adm','Exported '+r.rows.length+' rows.');
  });
  $('#ugo').addEventListener('click',()=>{uOff=0;loadUsers();});
  $('#usearch').addEventListener('keydown',e=>{if(e.key==='Enter'){uOff=0;loadUsers();}});
  $('#uprev').addEventListener('click',()=>{uOff=Math.max(0,uOff-25);loadUsers();});
  $('#unext').addEventListener('click',()=>{uOff+=25;loadUsers();});
  $('#setup').addEventListener('click',async()=>{
    say('#adm','Working...');
    const r=await api('admin_setup');
    say('#adm',r.ok?(r.note+' '+r.log.filter(l=>!l.includes('already')).join(' | ')):(r.reason||'Failed.'));
  });
  async function loadSessions(){
    const box=$('#sessions');if(!account||!user)return;
    try{
      const r=await account.listSessions();
      box.replaceChildren(...r.sessions.map(s=>{
        const row=el('div','arow'),m=el('div','grow');
        m.append(el('b',null,(s.clientName||'Browser')+' on '+(s.osName||'a device')),el('small',null,(s.countryName||'Unknown location')+' \u00b7 '+shortDate(s.$createdAt)+(s.current?' \u00b7 this device':'')));
        row.appendChild(m);
        if(!s.current){const b=el('button','alt sm','Sign out');b.addEventListener('click',async()=>{try{await account.deleteSession({sessionId:s.$id});}catch(e){}loadSessions();});row.appendChild(b);}
        return row;
      }));
    }catch(e){box.replaceChildren(el('div','sub','Could not load your devices.'));}
  }
  $('#sess_refresh').addEventListener('click',loadSessions);
  $('#dl_data').addEventListener('click',async()=>{
    if(!user)return;const pr=await api('my_payments');
    download('chat-printer-my-data.json',JSON.stringify({exported:new Date().toISOString(),profile:{id:user.$id,name:user.name,email:user.email,phone:(user.prefs||{}).phone||'',registered:user.registration,hasPhoto:!!(user.prefs&&user.prefs.avatar)},plan:st,payments:pr.rows||[]},null,2),'application/json');
    say('#data_s','Downloaded.');
  });
  $('#deact').addEventListener('click',async()=>{
    if(!user)return;
    if($('#deact_in').value.trim()!=='DEACTIVATE')return say('#data_s','Type DEACTIVATE to confirm.');
    if(!confirm('Deactivate your account? You will be signed out and cannot sign in again unless support re-enables it.'))return;
    try{await account.updateStatus();}catch(e){return say('#data_s','Could not deactivate: '+((e&&e.message)||'error'));}
    try{await account.deleteSession({sessionId:'current'});}catch(e){}
    needPw=false;await cpRefresh();location.hash='home';
  });
  const onCur=e=>{setCur(e.target.value,true);if(user)account.updatePrefs({prefs:Object.assign({},user.prefs||{},{currency:cur})}).catch(()=>{});};
  Object.keys(CURNAMES).forEach(c=>['curpick','curpick2','pref_cur'].forEach(id=>{const s=document.getElementById(id),o=document.createElement('option');o.value=c;o.textContent=c+' \u00b7 '+CURNAMES[c];s.appendChild(o);}));
  ['curpick','curpick2','pref_cur'].forEach(id=>document.getElementById(id).addEventListener('change',onCur));
  enhancePw();
  async function boot(){
    const q=new URLSearchParams(location.search),uid=q.get('userId'),sec=q.get('secret');
    if(account&&uid&&sec){
      if(q.get('mode')==='reset'){resetCtx={uid,sec};location.hash='account';showPane('paneReset');}
      else{try{await account.createSession({userId:uid,secret:sec});}catch(e){}}
      history.replaceState(null,'',location.pathname+location.hash);
    }
    if(q.get('auth')==='failed'){location.hash='account';amsg('That sign-in did not work. If this email already has an account, sign in with your email and password instead.');history.replaceState(null,'',location.pathname+location.hash);}
    await cpRefresh();
  }
  boot();
  detectCur();
  let sel='';
  const priceOf=(id,c)=>((PRICE_TABLE[c||cur]||PRICE_TABLE.USD)[id]);
  function planCards(box,pay){
    box.replaceChildren(...Object.entries(PLANS).map(([id,p])=>{
      const c=el('div','plan'+(p.hot?' hot':'')),pr=el('div','price',id==='free'?fmtMoney(cur,0):fmtMoney(cur,priceOf(id)||0)),ul=el('ul');
      if(p.hot)c.appendChild(el('span','ribbon','Most popular'));
      pr.appendChild(el('small',null,id==='free'?' forever':' / month'));
      p.pts.forEach(t=>ul.appendChild(el('li',null,t)));
      const b=el('button',id==='free'?'alt':null,id==='free'?'Start free':'Choose '+p.name);
      b.addEventListener('click',()=>{
        if(id==='free'){go('home','tool');return;}
        if(!pay){go('billing');return;}
        sel=id;$('#paytitle').textContent=p.name+' \u2014 '+fmtMoney(cur,priceOf(id)||0)+' / month';
        $('#payamt').textContent='PKR '+PRICE_TABLE.PKR[id];$('#paynum').textContent=PAYNUM[$('#pmeth').value]||PAY_NUMBER;
        payTab(cur==='PKR'?'local':'card');$('#pay').hidden=false;$('#pay').scrollIntoView({behavior:'smooth'});
      });
      c.append(el('h3',null,p.name),pr,ul,b);return c;
    }));
  }
  function payTab(t){
    $('#paycard').hidden=t!=='card';$('#paylocal').hidden=t!=='local';
    $('#tabcard').classList.toggle('on',t==='card');$('#tablocal').classList.toggle('on',t==='local');
  }
  $('#tabcard').addEventListener('click',()=>payTab('card'));$('#tablocal').addEventListener('click',()=>payTab('local'));
  $('#pmeth').addEventListener('change',()=>{$('#paynum').textContent=PAYNUM[$('#pmeth').value]||PAY_NUMBER;});
  $('#paycardgo').addEventListener('click',async()=>{
    const s=$('#pcs');
    if(!sel){s.textContent='Choose a plan first.';return;}
    if(!user){s.textContent='Sign in first so the plan goes to your account.';location.hash='account';return;}
    s.textContent='Opening secure checkout...';
    const r=await api('create_checkout',{plan:sel});
    if(!r.ok){s.textContent=r.reason||'Could not start the payment.';return;}
    location.href=r.url;
  });
  planCards($('#plans'),true);planCards($('#planprev'),false);
  $('#copy').addEventListener('click',()=>{try{navigator.clipboard.writeText(PAYNUM[$('#pmeth').value]||PAY_NUMBER);$('#copy').textContent='Copied';}catch(e){}});
  $('#pwa').addEventListener('click',async()=>{
    const t=$('#ptid').value.trim(),n=$('#pname').value.trim(),ps=$('#ps');
    if(!sel||!t||!n){ps.textContent='Choose a plan, then enter your name and the Transaction ID.';return;}
    if(!user){ps.textContent='Sign in first so we can activate your account.';location.hash='account';return;}
    if(!/^[A-Za-z0-9-]{6,30}$/.test(t)){ps.textContent='Check the Transaction ID (6-30 letters or digits).';return;}
    const r=await api('submit_payment',{plan:sel,method:$('#pmeth').value,tid:t,name:n});
    if(!r.ok){ps.textContent=r.reason||'Could not save the payment. Try again.';return;}
    if(r.activated){ps.textContent='Payment confirmed. Your plan is active.';cpRefresh();loadPay();return;}
    const p=PLANS[sel],msg='Chat Printer payment\nPlan: '+p.name+' (PKR '+PRICE_TABLE.PKR[sel]+'/month)\nMethod: '+$('#pmeth').value+'\nTransaction ID: '+t+'\nName: '+n+'\nAccount: '+(user.email||user.$id);
    const a=el('a',null,'Send the proof on WhatsApp to speed up approval');a.href='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);a.target='_blank';a.rel='noopener noreferrer';
    ps.replaceChildren('Payment submitted. We could not match it automatically yet, so it will be checked by hand. ',a);loadPay();
  });
  $('#mail').textContent=SUPPORT_EMAIL;$('#mail').href='mailto:'+SUPPORT_EMAIL;
  $('#wasup').addEventListener('click',()=>window.open('https://wa.me/'+WA+'?text='+encodeURIComponent('Hi, I need help with Chat Printer.'),'_blank','noopener'));
  $('#send').addEventListener('click',()=>{
    const n=$('#cn').value.trim(),e=$('#ce').value.trim(),m=$('#cm').value.trim();
    if(!n||!m||!/^\S+@\S+\.\S+$/.test(e)){$('#cs').textContent='Enter your name, a valid email and a message.';return;}
    location.href='mailto:'+SUPPORT_EMAIL+'?subject='+encodeURIComponent('Chat Printer: '+n)+'&body='+encodeURIComponent(m+'\n\n\u2014 '+n+' ('+e+')');
    $('#cs').textContent='Opening your email app...';
  });
  const views=['home','contact','billing','account','admin'];
  let curView='';
  const rvio=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('show');rvio.unobserve(e.target);}}),{threshold:.12}):null;
  function reveal(){document.querySelectorAll('.rv:not(.show)').forEach(n=>{if(rvio)rvio.observe(n);else n.classList.add('show');});}
  function route(){
    let v=(location.hash||'#home').slice(1);if(!views.includes(v))v='home';
    if(v==='admin'&&!loading&&!(st&&st.is_admin))v='home';
    views.forEach(x=>{$('#'+x).hidden=x!==v;});
    document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('on',a.dataset.nav===v));
    $('#nav').classList.remove('open');$('#burger').setAttribute('aria-expanded','false');
    const changed=v!==curView;curView=v;
    if(pendScroll){const t=document.getElementById(pendScroll);pendScroll=null;if(t)setTimeout(()=>t.scrollIntoView({behavior:'smooth',block:'start'}),40);}
    else if(changed)window.scrollTo(0,0);
    reveal();
  }
  $('#burger').addEventListener('click',()=>{const o=$('#nav').classList.toggle('open');$('#burger').setAttribute('aria-expanded',String(o));});
  document.addEventListener('click',e=>{
    const a=e.target.closest&&e.target.closest('a[data-scroll]');
    if(a){pendScroll=a.dataset.scroll;if((location.hash||'#home')===a.getAttribute('href')){e.preventDefault();route();}}
  });
  $('#cta').addEventListener('click',()=>go('home','tool'));$('#cta2').addEventListener('click',()=>go('billing'));$('#cta3').addEventListener('click',()=>go('home','tool'));
  $('#goplans').addEventListener('click',()=>go('billing'));
  $('#fwa').addEventListener('click',()=>window.open('https://wa.me/'+WA+'?text='+encodeURIComponent('Hi, I need help with Chat Printer.'),'_blank','noopener'));
  window.addEventListener('hashchange',route);route();
  $('#html').addEventListener('click',async()=>{
    $('#html').disabled=true;status('Building HTML (collecting media)...');
    try{
      const node=buildChat(visible(),false,true);
      await Promise.all(node._ready);
      const css=(await (await fetch('/style.css')).text())+'body{padding:16px}.msgs{max-height:none !important}';
      const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+($('#title').value||'Chat').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</title><style>'+css+'</style></head><body><main class="stage">'+node.outerHTML+'</main></body></html>';
      const b=new Blob([html],{type:'text/html'});
      const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='chat.html';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),4000);
      status('Done: chat.html ('+(b.size/1048576).toFixed(1)+' MB). Open it in any browser.');
    }catch(e){status('Could not build HTML: '+e.message);}
    $('#html').disabled=false;
  });

  $('#png').addEventListener('click',async()=>{
    if(typeof html2canvas==='undefined'){status('The PNG library failed to load. Check your connection and reload the page.');return;}
    const list=visible();
    const per=Math.max(5,parseInt($('#per').value,10)||40);
    const parts=Math.ceil(list.length/per);
    const holder=el('div');holder.style.cssText='position:fixed;left:-10000px;top:0;width:480px';
    document.body.appendChild(holder);
    $('#png').disabled=true;
    try{
      for(let i=0;i<parts;i++){
        status('Creating image '+(i+1)+' / '+parts+'...');
        const node=buildChat(list.slice(i*per,(i+1)*per),true);
        holder.replaceChildren(node);await Promise.all(node._ready);
        const canvas=await html2canvas(node,{scale:2,backgroundColor:null,useCORS:true});
        await new Promise(res=>canvas.toBlob(b=>{
          const a=document.createElement('a');a.href=URL.createObjectURL(b);
          a.download='chat-'+String(i+1).padStart(2,'0')+'.png';a.click();
          setTimeout(()=>URL.revokeObjectURL(a.href),4000);res();
        },'image/png'));
        await new Promise(r=>setTimeout(r,350));
      }
      status('Done: '+parts+' image(s) downloaded.');
    }catch(e){status('Could not create PNG: '+e.message);}
    finally{holder.remove();$('#png').disabled=false;}
  });
})();
