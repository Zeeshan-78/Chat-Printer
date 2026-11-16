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
      fs.forEach(e=>{if(e!==tx)zipMap.set(e.name.split('/').pop().toLowerCase(),e);});
      load(await tx.async('string'),tx.name.split('/').pop());
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

  function visible(){
    const showSys=$('#showSys').checked, hideMedia=$('#hideMedia').checked;
    return messages.filter(m=>{
      if(m.system && !showSys) return false;
      if(!$('#showDel').checked&&isDel(m))return false;
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
    ht.appendChild(el('div','s',list.length+' messages'));
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
    io.disconnect();chatInfo();stage.replaceChildren(buildChat(visible(),false));
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
    autoTitle();
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
  $('#showDel').addEventListener('change',render);
  $('#addold').addEventListener('click',()=>$('#file2').click());
  $('#file2').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)mergeOld(f);});
  let qt;$('#q').addEventListener('input',()=>{clearTimeout(qt);qt=setTimeout(render,250);});
  $('#cta').addEventListener('click',()=>$('#tool').scrollIntoView({behavior:'smooth'}));

  /* ---- config: fill these in (see README.md) ---- */
  const APPWRITE_ENDPOINT='https://sgp.cloud.appwrite.io/v1', APPWRITE_PROJECT_ID='6af9e75500246cec8feb', FUNCTION_ID='6afa94030022a59e3ef1';
  const SUPPORT_EMAIL='zeeshanplus7822@gmail.com', PAY_NUMBER='03094034322', WA='923094034322';
  const MB=1048576, GB=1024*MB;
  const PLANS={
    free:{name:'Free',price:0,maxBytes:200*MB,total:2,day:0,pts:['Zip files up to 200 MB','2 conversions in total','PDF, PNG and HTML export']},
    pro:{name:'Pro',price:450,maxBytes:GB,total:0,day:20,hot:1,pts:['Zip files up to 1 GB','20 conversions per day, renewed the next day','Everything in Free']},
    ultra:{name:'Ultra Pro',price:750,maxBytes:0,total:0,day:0,pts:['No file size limit','No daily limit','Everything in Pro']}
  };
  const AW=window.Appwrite, awOk=!!AW&&!APPWRITE_PROJECT_ID.startsWith('YOUR-')&&!FUNCTION_ID.startsWith('YOUR-');
  const client=awOk?new AW.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID):null;
  const account=client&&new AW.Account(client), fns=client&&new AW.Functions(client);
  let user=null,st=null,cpPass=null,otpUser=null,cpErr='';
  const cpFmt=n=>n>=GB?(n/GB).toFixed(1)+' GB':Math.round(n/MB)+' MB';
  const amsg=t=>{$('#aus').textContent=t;};
  async function api(action,data){
    try{
      const ex=await fns.createExecution({functionId:FUNCTION_ID,body:JSON.stringify(Object.assign({action},data||{})),async:false,xpath:'/',method:'POST',headers:{'content-type':'application/json'}});
      return JSON.parse(ex.responseBody||'{}');
    }catch(e){return{ok:false,reason:'Could not reach the server.'};}
  }
  async function loadPay(){
    const r=await api('my_payments');
    if(!r.ok||!r.rows.length)return;
    $('#mypay').replaceChildren(...r.rows.map(x=>el('div','status',x.plan+' \u00b7 '+x.tid+' \u00b7 '+x.status)));
  }
  async function loadAdmin(){
    const r=await api('admin_pending'),box=$('#pend');
    if(!r.ok){$('#adm').textContent=r.reason||'';return;}
    if(!r.rows.length){box.replaceChildren(el('div','status','No pending payments.'));return;}
    box.replaceChildren(...r.rows.map(x=>{
      const row=el('div','status',x.plan+' \u00b7 '+x.method+' \u00b7 TID '+x.tid+' \u00b7 '+x.name+' '),a=el('button','sm','Approve'),b=el('button','alt sm','Reject');
      const act=d=>async()=>{const z=await api('admin_decide',{id:x.id,decision:d});$('#adm').textContent=z.ok?'Done.':(z.reason||'Failed.');loadAdmin();};
      a.addEventListener('click',act('approve'));b.addEventListener('click',act('reject'));row.append(a,b);return row;
    }));
  }
  async function cpRefresh(){
    user=null;st=null;
    if(account){try{user=await account.get();}catch(e){user=null;}}
    cpBar();
    if(user){
      st=await api('status');
      if(!st.ok){cpErr=st.reason||'Could not load your plan.';st=null;}else cpErr='';
      cpBar();loadPay();if(st&&st.is_admin){loadAdmin();if(st.setup_needed)$('#adm').textContent='The database is not set up yet. Press "Run database setup".';}
    }
  }
  function cpBar(){
    $('#navacct').textContent=user?'Account':'Sign in';
    $('#signin').hidden=!!user;$('#acct').hidden=!user;$('#admin').hidden=!(st&&st.is_admin);
    let t;
    if(!account)t='Sign-in is not configured yet.';
    else if(!user)t='Sign in to use the converter.';
    else if(!st)t=cpErr||'Loading your plan...';
    else{
      const P=PLANS[st.plan];let left='Unlimited conversions';
      if(P.total)left=Math.max(0,P.total-st.total_used)+' of '+P.total+' conversions left';
      else if(P.day)left=Math.max(0,P.day-st.day_used)+' of '+P.day+' left today';
      t=P.name+' plan \u00b7 '+left+' \u00b7 '+(P.maxBytes?'max '+cpFmt(P.maxBytes):'no size limit')+(st.plan==='free'?'':' \u00b7 valid until '+new Date(st.expires_at).toLocaleDateString());
    }
    $('#plantext').textContent=t;
    $('#acctinfo').textContent=user?(user.email||'')+' \u2014 '+t+' \u2014 User ID: '+user.$id:'';
  }
  async function cpGate(f){
    if(!account){status('Sign-in is not configured yet.');return false;}
    if(!user){status('Please sign in first.');location.hash='account';return false;}
    const r=await api('begin',{size:f.size});
    cpRefresh();
    if(!r.ok){status(r.reason||'Could not check your plan. Try again.');return false;}
    return true;
  }
  $('#gbtn').addEventListener('click',()=>{
    if(!account)return amsg('Sign-in is not configured yet.');
    account.createOAuth2Token({provider:AW.OAuthProvider.Google,success:location.origin+'/',failure:location.origin+'/'});
  });
  $('#sendotp').addEventListener('click',async()=>{
    const v=$('#aid').value.trim();
    if(!account)return amsg('Sign-in is not configured yet.');
    if(!/^\S+@\S+\.\S+$/.test(v))return amsg('Enter a valid email address.');
    try{
      const t=await account.createEmailToken({userId:AW.ID.unique(),email:v});
      otpUser=t.userId;$('#otpbox').hidden=false;amsg('Code sent. Check your email (and the spam folder).');
    }catch(e){amsg('Could not send the code: '+(e&&e.message?e.message:'network error'));}
  });
  $('#verify').addEventListener('click',async()=>{
    const t=$('#acode').value.trim();
    if(!account||!otpUser||!t)return;
    try{
      await account.createSession({userId:otpUser,secret:t});
      amsg('');otpUser=null;$('#otpbox').hidden=true;await cpRefresh();location.hash='home';
    }catch(e){amsg('Invalid or expired code.');}
  });
  $('#signout').addEventListener('click',async()=>{try{if(account)await account.deleteSession({sessionId:'current'});}catch(e){}cpRefresh();});
  $('#setup').addEventListener('click',async()=>{
    $('#adm').textContent='Working...';
    const r=await api('admin_setup');
    $('#adm').textContent=r.ok?(r.note+' '+r.log.filter(l=>!l.includes('already')).join(' | ')):(r.reason||'Failed.');
  });
  $('#refresh').addEventListener('click',loadAdmin);
  async function oauthReturn(){
    const q=new URLSearchParams(location.search),u=q.get('userId'),s=q.get('secret');
    if(account&&u&&s){try{await account.createSession({userId:u,secret:s});}catch(e){}history.replaceState(null,'',location.pathname+location.hash);}
  }
  oauthReturn().then(cpRefresh);
  let sel='';
  $('#plans').replaceChildren(...Object.entries(PLANS).map(([id,p])=>{
    const c=el('div','plan'+(p.hot?' hot':'')),pr=el('div','price','PKR '+p.price),ul=el('ul');
    pr.appendChild(el('small',null,id==='free'?' forever':' / month'));
    p.pts.forEach(t=>ul.appendChild(el('li',null,t)));
    const b=el('button',id==='free'?'alt':null,id==='free'?'Start free':'Choose '+p.name);
    b.addEventListener('click',()=>{
      if(id==='free'){location.hash='home';return;}
      sel=id;$('#paytitle').textContent=p.name+' \u2014 PKR '+p.price+' / month';$('#payamt').textContent='PKR '+p.price;$('#paynum').textContent=PAY_NUMBER;
      $('#pay').hidden=false;$('#pay').scrollIntoView({behavior:'smooth'});
    });
    c.append(el('h3',null,p.name),pr,ul,b);return c;
  }));
  $('#copy').addEventListener('click',()=>{try{navigator.clipboard.writeText(PAY_NUMBER);$('#copy').textContent='Copied';}catch(e){}});
  $('#pwa').addEventListener('click',async()=>{
    const t=$('#ptid').value.trim(),n=$('#pname').value.trim(),ps=$('#ps');
    if(!sel||!t||!n){ps.textContent='Choose a plan, then enter your name and the Transaction ID.';return;}
    if(!user){ps.textContent='Sign in first so we can activate your account.';location.hash='account';return;}
    if(!/^[A-Za-z0-9-]{6,30}$/.test(t)){ps.textContent='Check the Transaction ID (6-30 letters or digits).';return;}
    const r=await api('submit_payment',{plan:sel,method:$('#pmeth').value,tid:t,name:n});
    if(!r.ok){ps.textContent=r.reason||'Could not save the payment. Try again.';return;}
    const p=PLANS[sel],msg='Chat Printer payment\nPlan: '+p.name+' (PKR '+p.price+'/month)\nMethod: '+$('#pmeth').value+'\nTransaction ID: '+t+'\nName: '+n+'\nAccount: '+(user.email||user.$id);
    const a=el('a',null,'Send the proof on WhatsApp to speed up approval');a.href='https://wa.me/'+WA+'?text='+encodeURIComponent(msg);a.target='_blank';a.rel='noopener noreferrer';
    ps.replaceChildren('Payment submitted. It activates on your account after verification. ',a);loadPay();
  });
  $('#mail').textContent=SUPPORT_EMAIL;$('#mail').href='mailto:'+SUPPORT_EMAIL;
  $('#wasup').addEventListener('click',()=>window.open('https://wa.me/'+WA+'?text='+encodeURIComponent('Hi, I need help with Chat Printer.'),'_blank','noopener'));
  $('#send').addEventListener('click',()=>{
    const n=$('#cn').value.trim(),e=$('#ce').value.trim(),m=$('#cm').value.trim();
    if(!n||!m||!/^\S+@\S+\.\S+$/.test(e)){$('#cs').textContent='Enter your name, a valid email and a message.';return;}
    location.href='mailto:'+SUPPORT_EMAIL+'?subject='+encodeURIComponent('Chat Printer: '+n)+'&body='+encodeURIComponent(m+'\n\n\u2014 '+n+' ('+e+')');
    $('#cs').textContent='Opening your email app...';
  });
  const views=['home','contact','billing','account'];
  function route(){
    const h=(location.hash||'#home').slice(1),v=views.includes(h)?h:'home';
    views.forEach(x=>{$('#'+x).hidden=x!==v;});
    document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('on',a.dataset.nav===v));
    window.scrollTo(0,0);
  }
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
      status('Ho gaya: '+parts+' image(s) download hui.');
    }catch(e){status('Could not create PNG: '+e.message);}
    finally{holder.remove();$('#png').disabled=false;}
  });
})();
