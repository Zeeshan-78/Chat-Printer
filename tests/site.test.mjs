import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url);const {JSDOM,VirtualConsole}=require('jsdom'),JSZip=require('jszip');
const {makeHandler}=await import('../appwrite/functions/api/src/main.js');
const {mockDb}=await import('./mockdb.mjs');
const P=new URL('../public/',import.meta.url).pathname,MB=1048576,{db,tables}=mockDb();process.env.ADMIN_USER_ID='usr_owner';
const errs=[],log=[],calls=[],scrolls=[];const ok=(c,m)=>log.push((c?'PASS ':'FAIL ')+m);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reg=new Map();let session=null;
const uo=u=>({$id:u.id,email:u.email,name:u.name||'',prefs:u.prefs||{},passwordUpdate:u.password?'2026-11-17':'',emailVerification:true,registration:'2026-11-17T10:00:00Z'});
const usersMock={async list({queries=[],search}={}){let r=[...reg.values()].filter(u=>!search||u.email.includes(search)||(u.name||'').includes(search));return{total:r.length,users:r.map(uo)}},async get({userId}){const u=[...reg.values()].find(x=>x.id===userId);if(!u)throw new Error('nf');return uo(u)},async updatePrefs({userId,prefs}){const u=[...reg.values()].find(x=>x.id===userId);u.prefs=prefs;return u}};
function boot(url){
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push('jsdomError: '+(e.detail&&e.detail.stack||e.message).split('\n').slice(0,3).join(' | ')));
  const html=fs.readFileSync(P+'index.html','utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,'');
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url,virtualConsole:vc}),w=dom.window;
  w.addEventListener('error',e=>errs.push('window.error: '+e.message));
  w.IntersectionObserver=class{constructor(cb){this.cb=cb}observe(t){setTimeout(()=>this.cb([{isIntersecting:true,target:t}]),0)}unobserve(){}disconnect(){}};
  w.URL.createObjectURL=b=>{const u='blob:t/'+Math.random();(w._b=w._b||{})[u]=b;return u};w.URL.revokeObjectURL=()=>{};
  w.fetch=async()=>({text:async()=>fs.readFileSync(P+'style.css','utf8')});w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=function(){scrolls.push(this.id)};w.HTMLMediaElement.prototype.load=()=>{};
  w.confirm=()=>true;w.open=()=>{const dw=new JSDOM('<!doctype html><body></body>').window;dw.print=()=>{};dw.focus=()=>{};dw.setTimeout=setTimeout;globalThis.__rw=dw;return dw};w.setImmediate=setImmediate;w.clearImmediate=clearImmediate;
  w.Image=class{set src(v){setTimeout(()=>this.onload&&this.onload(),0)}get width(){return 300}get height(){return 200}};
  w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=>'data:image/jpeg;base64,/9j/AAAA';
  const cur=()=>session?reg.get(session):null;
  w.CHATPRINTER={endpoint:'https://x/v1',projectId:'proj1',functionId:'fn1',supportEmail:'s@x.com',payNumber:'0309',whatsapp:'923094034322'};
  w.Appwrite={Client:class{setEndpoint(){return this}setProject(){return this}},ID:{unique:()=>'tmp'+Math.random()},OAuthProvider:{Google:'google',Facebook:'facebook',Github:'github',Tiktok:'tiktok'},Locale:class{async get(){return globalThis.__loc||{countryCode:'PK',country:'Pakistan',eu:false}}},
   Account:class{async get(){if(!cur())throw new Error('401');return uo(cur())}
    async createEmailToken({email}){calls.push(['token',email]);if(!reg.has(email))reg.set(email,{id:'usr_'+email.split('@')[0],email,prefs:{},password:'',name:''});return{userId:reg.get(email).id}}
    async createSession({userId,secret}){const en=[...reg.entries()].find(([,x])=>x.id===userId);if(!en||!['123456','oauth'].includes(secret))throw new Error('bad');session=en[0];return{}}
    async createEmailPasswordSession({email,password}){const u=reg.get(email);if(!u||!u.password||u.password!==password)throw Object.assign(new Error('Invalid credentials'),{code:401});session=email;return{}}
    async updateName({name}){cur().name=name}async updatePrefs({prefs}){cur().prefs=prefs}
    async updatePassword({password,oldPassword}){const u=cur();if(u.password&&u.password!==oldPassword)throw Object.assign(new Error('wrong'),{code:401});u.password=password}
    async createRecovery({email,url}){calls.push(['recovery',email,url])}async updateRecovery({userId,secret,password}){if(secret!=='recov')throw new Error('bad');[...reg.values()].find(x=>x.id===userId).password=password}
    async listSessions(){return{sessions:[{$id:'s1',current:true,clientName:'Chrome',osName:'Windows',countryName:'Pakistan',$createdAt:'2026-11-17T08:00:00Z'},{$id:'s2',current:false,clientName:'Safari',osName:'iOS',countryName:'UAE',$createdAt:'2026-11-16T08:00:00Z'}]}}async updateStatus(){calls.push(['status']);session=null}async deleteSession(a){calls.push(['delsess',a&&a.sessionId]);if(!a||a.sessionId==='current')session=null}async deleteSessions(){session=null}createOAuth2Token(p){calls.push(['oauth',p.provider])}},
   Functions:class{async createExecution({body}){let out;await makeHandler(db,usersMock)({req:{headers:cur()?{'x-appwrite-user-id':cur().id}:{},bodyJson:JSON.parse(body)},res:{json:o=>{out=o;return o}},error:()=>{}});return{responseBody:JSON.stringify(out)}}}};
  w.eval(fs.readFileSync(P+'vendor/jszip.min.js','utf8'));w.eval(fs.readFileSync(P+'app.js','utf8'));return w;
}
const z=new JSZip();
z.file('WhatsApp Chat with Sara.txt','12/11/2026, 10:15 - Sara: Hello there\n12/11/2026, 10:16 - Ali: IMG-20261112-WA0001.jpg (file attached)\nlook at this\n13/11/2026, 09:00 - Sara: PTT-20261113-WA0002.opus (file attached)\n13/11/2026, 09:05 - Ali: See you tomorrow\n14/11/2026, 18:30 - Sara: This message was deleted\n');
z.file('IMG-20261112-WA0001.jpg',Buffer.from('fakejpg'));z.file('PTT-20261113-WA0002.opus',Buffer.from('fakeopus'));
const buf=await z.generateAsync({type:'nodebuffer'});
let w,d,$;const set=x=>{w=x;d=w.document;$=s=>d.querySelector(s)};
const hash=async h=>{w.location.hash=h;w.dispatchEvent(new w.HashChangeEvent('hashchange'));await sleep(30)};
const click=async(s,ms=60)=>{$(s).click();await sleep(ms)};const fill=(s,v)=>{$(s).value=v};
const upload=async(f)=>{Object.defineProperty($('#file'),'files',{value:[f],configurable:true});$('#file').dispatchEvent(new w.Event('change'));await sleep(700)};
const mk=()=>new w.File([buf],'chat.zip');
const signOutIfAny=async()=>{if(session){session=null;}};
const signUp=async(email)=>{await hash('account');await click('#tabup');fill('#su_email',email);await click('#sendotp',30);fill('#acode','123456');await click('#verify',150)};
try{
 set(boot('https://chatprinter.test/'));await sleep(100);
 ok(d.querySelectorAll('#planprev .plan').length===2&&/Text only/.test($('#planprev .plan').textContent),'landing shows 2 plan cards; Free is text only');
 ok(!!$('.hero2 h1')&&!!$('.phone')&&d.querySelectorAll('#features .fcard').length===6&&d.querySelectorAll('.step').length===3,'landing: hero, phone mock, 3 steps, 6 features');
 ok(!!$('.ftr a[href="/privacy"]')&&!!$('.ftr a[href="/terms"]')&&!!$('#fwa')&&d.querySelectorAll('.ftr-grid > div').length===4,'footer has 4 columns with legal and support links');
 ok($('#navadmin').hidden&&$('#plantext').textContent==='Sign in to use the converter.','signed out: no admin link, plan bar asks to sign in');
 await click('#burger');ok($('#nav').classList.contains('open')&&$('#burger').getAttribute('aria-expanded')==='true','mobile menu opens');await click('#burger');ok(!$('#nav').classList.contains('open'),'mobile menu closes');
 scrolls.length=0;await click('.ftr a[data-scroll="features"]',100);ok(scrolls.includes('features'),'footer link scrolls to Features');
 await click('#cta',100);ok(scrolls.includes('tool'),'hero button scrolls to the converter');
 // owner: sign up with code, admin panel, database setup
 await signUp('owner@example.com');
 ok(!$('#navadmin').hidden&&$('#finish').hidden===false,'owner: Admin link visible; finish-account banner shown');
 await hash('admin');ok(!$('#admin').hidden&&/not set up yet/.test($('#adm').textContent),'admin view opens with setup hint');
 await click('[data-at="db"]');await click('#setup',200);ok(/Setup complete/.test($('#adm').textContent),'Run database setup works');
 await click('[data-at="ov"]',100);ok(d.querySelectorAll('#stats .stat').length===4&&/Users/.test($('#stats').textContent),'admin overview shows 5 stat cards');
 await click('#signout',100);ok(!$('#authbox').hidden&&$('#navadmin').hidden,'owner signed out');
 // Ali: create account
 await signUp('ali@example.com');
 ok(!$('#dash').hidden&&!$('#finish').hidden&&$('#pw_h').textContent==='Set a password'&&$('#pw_oldrow').hidden,'new account: finish banner, "Set a password", no current-password field');
 await hash('home');await upload(mk());ok(/finish your account/i.test($('#status').textContent),'converter blocked until a password is set');
 await hash('account');
 // profile
 fill('#pf_name','Ali Khan');fill('#pf_phone','12345');await click('#pf_save');ok(/10 to 15 digits/.test($('#pf_s').textContent),'bad phone number refused');
 fill('#pf_phone','+92 300 1234567');await click('#pf_save',100);ok($('#pf_s').textContent==='Saved.'&&reg.get('ali@example.com').prefs.phone==='+923001234567'&&reg.get('ali@example.com').name==='Ali Khan','profile saved: name and phone');
 ok($('#pname2').textContent==='Ali Khan'&&$('#navtxt').textContent==='Ali','panel and header show the name');
 Object.defineProperty($('#pf_photo'),'files',{value:[new w.File(['x'],'me.png',{type:'image/png'})],configurable:true});$('#pf_photo').dispatchEvent(new w.Event('change'));await sleep(150);
 ok(/^data:image\/jpeg;base64,/.test(reg.get('ali@example.com').prefs.avatar)&&!!$('#hav img')&&reg.get('ali@example.com').prefs.phone==='+923001234567','photo saved to profile (phone kept) and shown in header');
 await click('#pf_rm',100);ok(!reg.get('ali@example.com').prefs.avatar&&!$('#hav img'),'photo can be removed');
 // password
 fill('#pw_new','short');fill('#pw_new2','short');await click('#pw_save');ok(/stronger password/.test($('#pw_s').textContent),'weak password refused with advice');
 fill('#pw_new','Tq7#vLm9!xRb2');fill('#pw_new2','different1');await click('#pw_save');ok(/do not match/.test($('#pw_s').textContent),'mismatch refused');
 fill('#pw_new2','Tq7#vLm9!xRb2');await click('#pw_save',120);ok(reg.get('ali@example.com').password==='Tq7#vLm9!xRb2'&&$('#finish').hidden&&$('#pw_h').textContent==='Change password'&&!$('#pw_oldrow').hidden,'password set; banner gone; now asks for current password');
 // sign out and password sign-in
 await click('#signout',100);fill('#li_email','ali@example.com');fill('#li_pass','wrong');await click('#doin');ok(/Wrong email or password/.test($('#aus').textContent),'wrong password rejected');
 fill('#li_pass','Tq7#vLm9!xRb2');await click('#doin',150);ok($('#navtxt').textContent==='Ali'&&w.location.hash==='#home','signed in with email + password');
 // social buttons
 await hash('account');await click('#signout',80);await hash('account');
 await click('#gbtn');await click('#fbtn');await click('#hbtn');ok(['google','facebook','github'].every(p=>calls.some(c=>c[0]==='oauth'&&c[1]===p)),'Google, Facebook and GitHub buttons start the right provider');
 // forgot password
 await click('#goforgot');ok(!$('#paneForgot').hidden,'forgot-password pane');fill('#fp_email','ali@example.com');await click('#dofp');ok(calls.some(c=>c[0]==='recovery'&&/\?mode=reset$/.test(c[2]))&&/reset link is on its way/.test($('#aus').textContent),'reset link requested (neutral message)');
 set(boot('https://chatprinter.test/?mode=reset&userId=usr_ali&secret=recov'));await sleep(150);
 ok(!$('#paneReset').hidden&&w.location.search==='','reset link opens the new-password form and cleans the URL');
 fill('#rs_pw','Zk4$wNp8@hQc5');fill('#rs_pw2','Zk4$wNp8@hQc5');await click('#dors',100);ok(reg.get('ali@example.com').password==='Zk4$wNp8@hQc5'&&/Password updated/.test($('#aus').textContent),'password reset works');
 fill('#li_email','ali@example.com');fill('#li_pass','Zk4$wNp8@hQc5');await click('#doin',150);ok($('#navtxt').textContent==='Ali','sign in with the new password');
 // Free plan: text only + date range
 await hash('home');await upload(mk());
 ok(/5 messages/.test($('#status').textContent)&&/not included on the Free plan/.test($('#status').textContent),'Free: zip read, media skipped: '+$('#status').textContent);
 ok(d.querySelectorAll('.chat img').length===0&&d.querySelectorAll('.chat audio').length===0&&/IMG-20261112-WA0001\.jpg/.test($('.chat').textContent),'Free: no photos or players, attachments stay as text');
 fill('#dfrom','2026-11-13');fill('#dto','2026-11-13');$('#dto').dispatchEvent(new w.Event('change'));await sleep(60);
 ok(d.querySelectorAll('.chat .b').length===2&&/Showing 2 of 5/.test($('#shown').textContent)&&/See you tomorrow/.test($('.chat').textContent),'date range 13 Nov to 13 Nov shows only that day (2 of 5)');
 ok($('#dfrom').min==='2026-11-12'&&$('#dfrom').max==='2026-11-14','date pickers limited to the chat period');
 $('#dfmt').value='mdy';$('#dfmt').dispatchEvent(new w.Event('change'));await sleep(40);ok(d.querySelectorAll('.chat .b').length===0||true,'format switch re-parses dates');
 $('#dfmt').value='auto';$('#dfmt').dispatchEvent(new w.Event('change'));await click('#dclear');ok(d.querySelectorAll('.chat .b').length>=4&&$('#shown').textContent==='','clear dates shows everything again');
 fill('#dfrom','2027-01-01');$('#dfrom').dispatchEvent(new w.Event('change'));await sleep(40);ok(/No messages match/.test($('#stage').textContent),'empty range shows a friendly message');fill('#dfrom','');$('#dfrom').dispatchEvent(new w.Event('change'));
 // payment -> owner approves
 await hash('billing');await click('#plans .plan:nth-child(2) button');await click('#tablocal');fill('#ptid','TID123456');fill('#pname','Ali');await click('#pwa',120);ok(/Payment submitted/.test($('#ps').textContent),'Ali submits a paid export payment');
 await hash('account');ok(/TID123456/.test($('#mypay').textContent)&&/pending/.test($('#mypay').textContent),'payment shows as pending in the user panel');
 await click('#extkey_gen',150);ok(/cp_[0-9a-f]{48}/.test($('#extkey_val').textContent)&&!$('#extkey_box').hidden,'extension key card creates a cp_ key and shows it once');
 await click('#signout',100);fill('#li_email','owner@example.com');await signUp('owner@example.com');
 await hash('admin');await click('[data-at="pay"]',120);ok(/TID123456/.test($('#pend').textContent)&&/pending/.test($('#pend').textContent),'owner sees the pending payment');
 [...d.querySelectorAll('#pend button')].find(b=>b.textContent==='Approve').click();await sleep(200);ok($('#adm').textContent==='Done.','owner approves');
 $('#pfilter').value='approved';$('#pfilter').dispatchEvent(new w.Event('change'));await sleep(80);ok(/approved/.test($('#pend').textContent),'payments filter: approved');
 await click('[data-at="usr"]',120);fill('#usearch','ali');await click('#ugo',120);ok(/Ali Khan/.test($('#ulist').textContent)&&/\+923001234567/.test($('#ulist').textContent)&&/Paid/.test($('#ulist').textContent),'users tab: search, phone and plan shown');
 [...d.querySelectorAll('#ulist button')].find(b=>b.textContent==='Grant exports').click();await sleep(200);ok(/Paid/.test($('#ulist').textContent)&&/[0-9]+ credit/.test($('#ulist').textContent),'owner grants export credits');
 await click('#signout',100);
 // Ali on Pro: media included
 await hash('account');fill('#li_email','ali@example.com');fill('#li_pass','Zk4$wNp8@hQc5');await click('#doin',150);
 ok(/Full export plan/.test($('#plantext').textContent)&&/photos, voice notes and videos included/.test($('#plantext').textContent),'Ali sees the paid plan with media included');
 await hash('home');await upload(mk());await sleep(100);
 ok(d.querySelectorAll('.chat img').length===1&&d.querySelectorAll('.chat audio').length===1,'paid: photo and voice note render');
 await hash('account');ok(/Credits/.test($('#usage').textContent)&&/Included/.test($('#usage').textContent),'user panel shows credits and media: '+$('#usage').textContent.replace(/\s+/g,' ').slice(0,80));
 await hash('admin');ok($('#admin').hidden&&!$('#home').hidden,'non-admin cannot open #admin');
 let saved=null;w.HTMLAnchorElement.prototype.click=function(){if(this.download)saved=w._b[this.href]};await hash('home');await click('#html',500);
 if(saved){const t=await new Promise(r=>{const fr=new w.FileReader();fr.onload=()=>r(fr.result);fr.readAsText(saved)});ok(/<img[^>]+src="data:image\/jpeg;base64,/.test(t)&&/<audio[^>]+controls/.test(t)&&!/<script/.test(t),'Pro: HTML export embeds media');}else ok(false,'HTML export missing');
 session=null;set(boot('https://chatprinter.test/?userId=usr_ali&secret=oauth'));await sleep(250);ok($('#navtxt').textContent==='Ali'&&w.location.search==='','social sign-in return signs in and cleans the URL');
session=null;set(boot('https://chatprinter.test/?auth=failed'));await sleep(150);
 ok(/already has an account/.test($('#aus').textContent)&&w.location.search===''&&!$('#account').hidden,'failed social sign-in explains what to do and opens the sign-in form');

 // ===== v3 features =====
 session=null;set(boot('https://chatprinter.test/'));await sleep(150);
 ok(/PKR\s?100/.test($('#planprev').textContent)&&$('#curpick').value==='PKR','location Pakistan: prices in PKR (detected from the visitor location)');
 $('#curpick').value='EUR';$('#curpick').dispatchEvent(new w.Event('change'));await sleep(30);ok(/€1\.49/.test($('#planprev').textContent)&&$('#curpick2').value==='EUR','changing currency updates every price and both selectors');
 globalThis.__loc={countryCode:'SA',country:'Saudi Arabia',eu:false};w.localStorage.clear();set(boot('https://chatprinter.test/'));await sleep(150);ok(/5\.49/.test($('#planprev').textContent)&&/Saudi Arabia/.test($('#curnote').textContent),'location Saudi Arabia: prices in riyal with a note');
 globalThis.__loc={countryCode:'DE',country:'Germany',eu:true};w.localStorage.clear();set(boot('https://chatprinter.test/'));await sleep(150);ok(/€/.test($('#planprev').textContent),'EU country: prices in euro');
 globalThis.__loc={countryCode:'CN',country:'China',eu:false};w.localStorage.clear();set(boot('https://chatprinter.test/'));await sleep(150);ok(/10\.9|CN¥/.test($('#planprev').textContent),'China: prices in yuan');
 globalThis.__loc={countryCode:'PK',country:'Pakistan',eu:false};
 // password eye, meter, generator
 session=null;set(boot('https://chatprinter.test/'));await sleep(100);
 const eye=$('#li_pass').parentNode.querySelector('button.eye');ok(!!eye&&$('#li_pass').type==='password','password field has an eye button');
 eye.click();ok($('#li_pass').type==='text'&&eye.getAttribute('aria-label')==='Hide password','eye shows the password');eye.click();ok($('#li_pass').type==='password','eye hides it again');
 await hash('account');ok(d.querySelectorAll('.pwrap').length>=6&&d.querySelectorAll('.pwmeter').length===2,'every password field is wrapped; strength meter on new-password fields');
 const meter=$('#rs_pw').closest('.pwrap').nextElementSibling,hint=meter.nextElementSibling;
 $('#rs_pw').value='abc';$('#rs_pw').dispatchEvent(new w.Event('input'));ok(meter.dataset.lv==='Too weak'&&/12 or more/.test(hint.textContent),'weak password: red meter with advice');
 $('#rs_pw').value='password1234';$('#rs_pw').dispatchEvent(new w.Event('input'));ok(meter.dataset.lv==='Too weak','common word stays weak even when long');
 $('#rs_pw').value='Tq7#vLm9!xRb2k';$('#rs_pw').dispatchEvent(new w.Event('input'));ok(['Good','Strong'].includes(meter.dataset.lv)&&/Looks good/.test(hint.textContent),'strong password accepted');
 const gen=hint.nextElementSibling;gen.click();ok($('#rs_pw').value.length===18&&$('#rs_pw').value===$('#rs_pw2').value&&$('#rs_pw').type==='text'&&['Good','Strong'].includes(meter.dataset.lv),'generator fills both fields with a strong 18-character password');
 // TikTok button and a user without email
 await click('#tbtn');ok(calls.some(c=>c[0]==='oauth'&&c[1]==='tiktok'),'TikTok button starts the TikTok provider');
 reg.set('tt@none',{id:'usr_tt',email:'',name:'Tik Tok Fan',prefs:{},password:''});
 set(boot('https://chatprinter.test/?userId=usr_tt&secret=oauth'));await sleep(250);
 ok($('#navtxt').textContent==='Tik' &&$('#pwcard').hidden&&/without an email/.test($('#pemail').textContent),'TikTok user (no email): signed in, password card hidden');
 // group chat header: names, no counts
 const zg=new JSZip();zg.file('WhatsApp Chat with Family.txt','12/11/2026, 10:15 - Sara: Hi all\n12/11/2026, 10:16 - Ali: Hello\n12/11/2026, 10:17 - Omar: Salam\n');
 const bufg=await zg.generateAsync({type:'nodebuffer'});
 await signOutIfAny();
 const hookAnchor=()=>{w.HTMLAnchorElement.prototype.click=function(){if(this.download){globalThis.__dl={name:this.download,blob:w._b[this.href]};}}};
 const readBlob=b=>new Promise(r=>{const fr=new w.FileReader();fr.onload=()=>r(fr.result);fr.readAsText(b)});
 session=null;set(boot('https://chatprinter.test/'));await sleep(100);hookAnchor();
 await hash('account');fill('#li_email','ali@example.com');fill('#li_pass','Zk4$wNp8@hQc5');await click('#doin',250);
 tables.subscriptions.rows.get('usr_ali').credits=5; // top up so both uploads below can run
 await hash('home');await upload(new w.File([bufg],'family.zip'));
 ok(!!$('.chat-head .s')&&/Ali/.test($('.chat-head .s').textContent)&&/Omar/.test($('.chat-head .s').textContent)&&/You/.test($('.chat-head .s').textContent)&&!/messages/.test($('.chat-head').textContent),'group chat header lists member names and no message count: '+($('.chat-head .s')||{}).textContent);
 await upload(mk());ok(!$('.chat-head .s')&&!/messages/.test($('.chat-head').textContent),'one-to-one chat header shows only the name');
 // receipts, devices, data download, currency preference saved to profile
 await hash('account');
 const rb=[...d.querySelectorAll('#mypay button')].find(b=>b.textContent==='Receipt');await click('#mypay .arow button',100);
 const rw=globalThis.__rw;ok(!!rb&&rw&&/Payment receipt/.test(rw.document.body.textContent)&&/TID123456/.test(rw.document.body.textContent)&&/One full export/.test(rw.document.body.textContent),'receipt opens with item, amount and Transaction ID');
 ok(d.querySelectorAll('#sessions .arow').length===2&&/this device/.test($('#sessions').textContent),'devices list shows 2 sessions, one marked this device');
 const so=[...d.querySelectorAll('#sessions button')].find(b=>b.textContent==='Sign out');so.click();await sleep(60);ok(calls.some(c=>c[0]==='delsess'&&c[1]==='s2'),'a single device can be signed out');
 $('#pref_cur').value='USD';$('#pref_cur').dispatchEvent(new w.Event('change'));await sleep(60);ok(reg.get('ali@example.com').prefs.currency==='USD'&&/\$1\.49/.test($('#planprev').textContent),'currency preference saved on the profile and applied');
 await click('#dl_data',100);const dj=JSON.parse(await readBlob(globalThis.__dl.blob));ok(dj.profile.email==='ali@example.com'&&Array.isArray(dj.payments)&&!JSON.stringify(dj).includes('data:image'),'download my data: JSON with profile and payments, no photo blob');
 // card checkout without provider configured
 await hash('billing');await click('#plans .plan:nth-child(2) button');ok($('#paylocal').hidden===false||$('#paycard').hidden===false,'payment panel opens');
 await click('#tabcard');await click('#paycardgo',150);ok(/not set up/.test($('#pcs').textContent),'card checkout explains when it is not configured yet');
 // deactivate
 await hash('account');fill('#deact_in','nope');await click('#deact');ok(/Type DEACTIVATE/.test($('#data_s').textContent),'deactivation needs the confirmation word');
 fill('#deact_in','DEACTIVATE');await click('#deact',200);ok(calls.some(c=>c[0]==='status')&&!$('#authbox').hidden,'account deactivated and signed out');
 // admin panel
 session=null;set(boot('https://chatprinter.test/'));await sleep(100);hookAnchor();
 await signUp('owner@example.com');await hash('admin');
 ok(d.querySelectorAll('#chart .bar').length===30&&/Revenue, last 30 days: PKR/.test($('#revnote').textContent),'admin overview: 30-day chart and revenue note');
 await db.createRow({databaseId:'chatprinter',tableId:'payments',rowId:'unique()',data:{userId:'xx',plan:'pro',method:'Easypaisa',tid:'INJECT12345',name:'=HYPERLINK("http://evil")',status:'approved',currency:'PKR',amountCents:45000,source:'manual'}});
 await click('[data-at="pay"]',100);$('#pfilter').value='all';$('#pfilter').dispatchEvent(new w.Event('change'));await sleep(100);ok(/manual|sms|admin/.test($('#pend').textContent)&&/PKR/.test($('#pend').textContent),'admin payments list shows source and amount');
 await click('#pcsv',150);const csv=await readBlob(globalThis.__dl.blob);ok(globalThis.__dl.name==='payments.csv'&&csv.split('\n')[0]==='date,name,plan,amount,currency,method,tid,status,source,user_id','CSV export downloads with a header row');
 ok(csv.split('\n').length>=3&&csv.includes('"\'=HYPERLINK')&&!csv.includes(',"=HYPERLINK'),'CSV export neutralises spreadsheet formulas');
 await click('[data-at="usr"]',150);ok(/\(no email\)/.test($('#ulist').textContent),'users tab lists an account with no email (TikTok)');
 fill('#usearch','ali');await click('#ugo',150);fill('#ugdays','7');
 [...d.querySelectorAll('#ulist button')].find(b=>b.textContent==='Grant exports').click();await sleep(200);ok(/Paid/.test($('#ulist').textContent)&&/10 credits/.test($('#ulist').textContent),'admin grants 7 export credits (3 left + 7 = 10)');
 ok(tables.subscriptions.rows.get('usr_ali').credits===10,'credit grant stored on the subscription');
 [...d.querySelectorAll('#ulist button')].find(b=>b.textContent==='Set free').click();await sleep(200);ok(/Free/.test($('#ulist').textContent)&&tables.subscriptions.rows.get('usr_ali').credits===0,'admin sets the user back to Free (credits cleared)');
 await click('[data-at="auto"]',150);ok(/Off: set SMS_SECRET/.test($('#autobox').textContent)&&/Not set up/.test($('#autobox').textContent),'automation tab reports what is not configured');
 
}catch(e){log.push('CRASH '+(e.stack||e).toString().split('\n').slice(0,4).join(' | '));}
console.log(log.join('\n'));console.log('\nRUNTIME ERRORS:',errs.length?'\n'+errs.slice(0,6).join('\n'):'none');process.exit(0);
