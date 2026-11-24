import {createHmac} from 'node:crypto';
import {parseSms,verifyPaddle} from '../appwrite/functions/api/src/main.js';
import { makeHandler } from '../appwrite/functions/api/src/main.js';
import {mockDb} from './mockdb.mjs';
const {db,tables}=mockDb();
const USERS=['u1','u4','p2','u7','admin1'].map((id,i)=>({$id:id,email:id+'@x.com',name:'User '+id,prefs:id==='u4'?{phone:'+923001112222'}:{},emailVerification:true,registration:'2026-11-0'+(i+1)}));
const usersMock={async list({queries=[],search}={}){let r=USERS.filter(u=>!search||u.email.includes(search)||u.name.includes(search));const qs=queries.map(x=>JSON.parse(x));const lim=(qs.find(q=>q.method==='limit')||{values:[1e9]}).values[0];return {total:r.length,users:r.slice(0,lim)}}};
const call=async(uid,body)=>{let out;const res={json:o=>{out=o;return o}};
  await makeHandler(db,usersMock)({req:{headers:uid?{'x-appwrite-user-id':uid}:{},bodyJson:body},res,error:()=>{}});return out;};
process.env.ADMIN_USER_ID='admin1';
const log=[];const ok=(c,m)=>log.push((c?'PASS ':'FAIL ')+m);const MB=1048576;
// 0 before setup
ok((await call('u1',{action:'status'})).reason==='The database is not set up yet.','tables missing -> friendly "not set up" message');
let sn=await call('admin1',{action:'status'});ok(sn.ok&&sn.is_admin&&sn.setup_needed===true,'owner sees setup_needed before the first setup');
ok((await call('u1',{action:'admin_setup'})).ok===false,'non-admin cannot run setup');
const s1=await call('admin1',{action:'admin_setup'});ok(s1.ready===true&&s1.log.length>10,'admin setup creates everything ('+s1.log.filter(l=>l.includes('created')).length+' items)');
const s2=await call('admin1',{action:'admin_setup'});ok(s2.ready&&s2.log.every(l=>l.includes('already exists')),'setup is safe to run again');
ok((await call(null,{action:'status'})).reason==='Please sign in first.','no user -> sign in first');
let st=await call('u1',{action:'status'});ok(st.plan==='free'&&st.total_used===0&&st.is_admin===false,'new user starts on Free');
// free quota
ok((await call('u1',{action:'begin',size:100*MB})).ok&&(await call('u1',{action:'begin',size:100*MB})).ok,'free: 2 conversions allowed');
let r=await call('u1',{action:'begin',size:1*MB});ok(!r.ok&&/all 2 free/.test(r.reason),'free: 3rd refused');
ok((await call('u1',{action:'status'})).total_used===2,'refused attempt did not use up quota');
r=await call('u2',{action:'begin',size:300*MB});ok(!r.ok&&/too large/.test(r.reason)&&(await call('u2',{action:'status'})).total_used===0,'free: 300 MB refused without using quota');
// concurrency on free
const cf=await Promise.all(Array.from({length:10},()=>call('u3',{action:'begin',size:MB})));ok(cf.filter(x=>x.ok).length===2,'free: 10 simultaneous requests -> exactly 2 allowed');
// payments
r=await call('u4',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'bad tid!',name:'Ali'});ok(!r.ok,'bad TID rejected');
r=await call('u4',{action:'submit_payment',plan:'pro',method:'Bitcoin',tid:'TID123456',name:'Ali'});ok(!r.ok,'unknown payment method rejected');
r=await call('u4',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'tid123456',name:'Ali'});ok(r.ok,'valid payment submitted (TID upper-cased)');
r=await call('u5',{action:'submit_payment',plan:'ultra',method:'Easypaisa',tid:'TID123456',name:'Bob'});ok(!r.ok&&/already submitted/.test(r.reason),'same TID from another account refused');
for(let i=0;i<4;i++)await call('u6',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'SPAM00000'+i,name:'x'});
r=await call('u6',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'SPAM000009',name:'x'});ok(r.ok,'5th pending payment allowed');
r=await call('u6',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'SPAM000010',name:'x'});ok(!r.ok&&/Too many/.test(r.reason),'6th pending payment refused (anti-spam)');
ok((await call('u4',{action:'my_payments'})).rows[0].status==='pending','user sees own payments');
// admin gating + approval
ok((await call('u4',{action:'admin_pending'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_decide',id:'r1',decision:'approve'})).reason==='Not allowed.','normal user cannot use admin actions');
const pend=await call('admin1',{action:'admin_pending'});const mine=pend.rows.find(x=>x.tid==='TID123456');ok(!!mine&&mine.name==='Ali','admin sees pending payment');
r=await call('admin1',{action:'admin_decide',id:mine.id,decision:'approve'});ok(r.ok,'admin approves');
st=await call('u4',{action:'status'});const days=(new Date(st.expires_at)-Date.now())/864e5;ok(st.plan==='pro'&&days>29.9&&days<30.1,'user is now Pro for 30 days');
ok((await call('admin1',{action:'admin_decide',id:mine.id,decision:'approve'})).reason==='This payment was already handled.','cannot approve twice');
// pro limits
let n=0;for(let i=0;i<25;i++){if((await call('u4',{action:'begin',size:500*MB})).ok)n++;}ok(n===20,'pro: exactly 20 conversions in a day (got '+n+')');
r=await call('u4',{action:'begin',size:1});ok(/Daily limit of 20/.test(r.reason),'pro: 21st refused with message');
const realNow=Date.now;Date.now=()=>realNow()+26*3600e3;
ok((await call('u4',{action:'begin',size:500*MB})).ok,'pro: limit renews the next day');Date.now=realNow;
r=await call('u4',{action:'begin',size:1500*MB});ok(!r.ok&&/too large/.test(r.reason),'pro: 1.5 GB refused');
const cp=await Promise.all(Array.from({length:30},()=>call('p2',{action:'begin',size:MB})));
// make p2 pro first
await call('p2',{action:'submit_payment',plan:'pro',method:'Easypaisa',tid:'PROUSER001',name:'P'});
let pp=(await call('admin1',{action:'admin_pending'})).rows.find(x=>x.tid==='PROUSER001');await call('admin1',{action:'admin_decide',id:pp.id,decision:'approve'});
const c2=await Promise.all(Array.from({length:30},()=>call('p2',{action:'begin',size:MB})));ok(c2.filter(x=>x.ok).length===20,'pro: 30 simultaneous requests -> exactly 20 allowed');
// renewal and expiry, ultra
await call('p2',{action:'submit_payment',plan:'pro',method:'Easypaisa',tid:'PROUSER002',name:'P'});
pp=(await call('admin1',{action:'admin_pending'})).rows.find(x=>x.tid==='PROUSER002');await call('admin1',{action:'admin_decide',id:pp.id,decision:'approve'});
st=await call('p2',{action:'status'});ok((new Date(st.expires_at)-Date.now())/864e5>59.9,'paying again for the same plan extends from current expiry (~60 days)');
await call('u7',{action:'submit_payment',plan:'ultra',method:'JazzCash',tid:'ULTRA00001',name:'U'});pp=(await call('admin1',{action:'admin_pending'})).rows.find(x=>x.tid==='ULTRA00001');await call('admin1',{action:'admin_decide',id:pp.id,decision:'approve'});
let um=0;for(let i=0;i<60;i++)if((await call('u7',{action:'begin',size:5000*MB})).ok)um++;ok(um===60,'ultra: no size or daily limit');
tables.subscriptions.rows.get('u7').expiresAt=new Date(Date.now()-1000).toISOString();
ok((await call('u7',{action:'status'})).plan==='free','expired subscription falls back to Free');
await call('u8',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'REJECT0001',name:'R'});pp=(await call('admin1',{action:'admin_pending'})).rows.find(x=>x.tid==='REJECT0001');
await call('admin1',{action:'admin_decide',id:pp.id,decision:'reject'});ok((await call('u8',{action:'status'})).plan==='free'&&(await call('u8',{action:'my_payments'})).rows[0].status==='rejected','rejected payment keeps user on Free');
ok((await call('u1',{action:'nope'})).reason==='Unknown action.','unknown action handled');
// ---- new in v2: media flag, admin stats/users/payments/set plan
await call('admin1',{action:'admin_set_plan',userId:'m1',plan:'pro',days:5});ok((await call('m1',{action:'begin',size:MB})).media===true,'paid plan reports media=true');
const fr=await call('fresh1',{action:'begin',size:MB});ok(fr.ok&&fr.media===false,'free plan reports media=false (text only)');
ok((await call('u4',{action:'admin_stats'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_users'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_set_plan',userId:'u1',plan:'ultra'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_payments'})).reason==='Not allowed.','new admin actions refuse normal users');
const stt=await call('admin1',{action:'admin_stats'});ok(stt.ok&&stt.users===5&&stt.pending>=1&&stt.approved>=4&&stt.revenue>0&&stt.active>=2,'admin stats: '+JSON.stringify(stt));
const au=await call('admin1',{action:'admin_users',search:'u4'});ok(au.ok&&au.rows.length===1&&au.rows[0].phone==='+923001112222'&&au.rows[0].plan==='pro','admin users: search, phone from profile, plan joined');
const all=await call('admin1',{action:'admin_users'});ok(all.total===5&&all.rows.find(x=>x.id==='u7').plan==='free'&&all.rows.find(x=>x.id==='p2').plan==='pro','admin users list shows effective plans');
ok((await call('admin1',{action:'admin_set_plan',userId:'u1',plan:'ultra',days:10})).ok&&(await call('u1',{action:'status'})).plan==='ultra','admin can grant Ultra for 10 days');
const d10=(new Date((await call('u1',{action:'status'})).expires_at)-Date.now())/864e5;ok(d10>9.9&&d10<10.1,'grant length respected (10 days)');
ok((await call('admin1',{action:'admin_set_plan',userId:'u1',plan:'free'})).ok&&(await call('u1',{action:'status'})).plan==='free','admin can set a user back to Free');
ok((await call('admin1',{action:'admin_set_plan',userId:'u1',plan:'gold'})).ok===false,'invalid plan refused');
const ap=await call('admin1',{action:'admin_payments',status:'approved'});ok(ap.ok&&ap.rows.length>=4&&ap.rows.every(x=>x.status==='approved'),'admin payments filter: approved');
const allp=await call('admin1',{action:'admin_payments',status:'all'});ok(allp.rows.length>ap.rows.length,'admin payments filter: all');
const noScope={async list(){throw new Error('missing scope')}};let o2;await makeHandler(db,noScope)({req:{headers:{'x-appwrite-user-id':'admin1'},bodyJson:{action:'admin_users'}},res:{json:x=>{o2=x}},error:()=>{}});ok(o2.ok===false&&/users.read/.test(o2.reason),'missing users.read scope gives a clear message');

{
// ---- v3: SMS auto-verification, Paddle webhook, card checkout, revenue, automation
const hook=async(path,headers,body)=>{let out;await makeHandler(db,usersMock)({req:{headers,method:'POST',path,bodyText:typeof body==='string'?body:JSON.stringify(body)},res:{json:(o,s)=>{out={...o,_s:s||200}}},error:()=>{}});return out;};
process.env.SMS_SECRET='s3cret';const SH={'x-sms-secret':'s3cret'};
const pay=(uid,plan,tid,m='Easypaisa')=>call(uid,{action:'submit_payment',plan,method:m,tid,name:'N'});
ok(parseSms('You have received Rs. 450.00 from ALI. TID: 12345678901. Balance Rs 5,000').tid==='12345678901'&&parseSms('Received PKR 1,250 Trx ID 998877665').amount===125000,'SMS parser: labelled TID and amount');
ok(parseSms('Sent to 03001234567 amount Rs 450').tid==='','SMS parser: a phone number is not mistaken for a TID');
let h=await hook('/sms',{},{text:'x'});ok(h._s===401,'SMS hook: missing secret refused');
h=await hook('/sms',{'x-sms-secret':'nope'},{text:'x'});ok(h._s===401,'SMS hook: wrong secret refused');
const keep=process.env.SMS_SECRET;delete process.env.SMS_SECRET;h=await hook('/sms',SH,{text:'x'});ok(h._s===503,'SMS hook: off until a secret is set');process.env.SMS_SECRET=keep;
// order A: user submits first, SMS arrives after
r=await pay('sa1','pro','TIDAAA11111');ok(r.ok&&r.activated===false,'auto: payment waits for its SMS');
h=await hook('/sms',SH,{text:'Rs. 450 received from Ali. TID: TIDAAA11111. Balance Rs 9,000'});ok(h.ok&&h.matched===true,'auto: SMS arrives later and activates the plan');
ok((await call('sa1',{action:'status'})).plan==='pro','auto: user is Pro');
ok((await call('sa1',{action:'my_payments'})).rows[0].source==='sms'&&(await call('sa1',{action:'my_payments'})).rows[0].status==='approved','auto: payment marked approved by sms');
// order B: SMS first, user submits after
h=await hook('/sms',SH,{text:'You received Rs 750 TID 55566677788 from Sara'});ok(h.ok&&h.matched===false,'auto: SMS with no payment yet is stored');
r=await pay('sb1','ultra','55566677788');ok(r.ok&&r.activated===true&&(await call('sb1',{action:'status'})).plan==='ultra','auto: user submits after the SMS and is activated at once');
// underpay, unlabelled, phone-number trick, old sms
await hook('/sms',SH,{text:'Rs. 100 received. TID: UNDER1234567'});r=await pay('sc1','pro','UNDER1234567');ok(r.ok&&r.activated===false,'auto: underpayment is not activated');
await hook('/sms',SH,{text:'Rs. 450 received from 03001234567 ref none'});r=await pay('sd1','pro','03001234567');ok(r.ok&&r.activated===false,'auto: a phone number cannot be used as a TID');
tables.bank_sms.rows.set('old1',{$id:'old1',$createdAt:new Date(Date.now()-9*864e5).toISOString(),text:'Rs. 450 TID: OLDTID123456',matched:''});r=await pay('se1','pro','OLDTID123456');ok(r.ok&&r.activated===false,'auto: SMS older than 7 days is ignored');
await hook('/sms',SH,{text:'Rs. 1000 received TID: OVER12345678'});r=await pay('sf1','pro','OVER12345678');ok(r.activated===true,'auto: overpayment is accepted');
await hook('/sms',SH,{text:'Rs. 450 received TID: ONCE12345678'});r=await pay('sg1','pro','ONCE12345678');const r2=await pay('sg2','pro','ONCE12345678');ok(r.activated&&!r2.ok,'auto: one TID cannot activate two accounts');
h=await hook('/sms',SH,'not json');ok(h._s===400,'SMS hook: bad body refused');
const pending=(await call('admin1',{action:'admin_payments',status:'pending'})).rows;ok(pending.some(x=>x.tid==='UNDER1234567'),'unmatched payments stay pending for the admin');
// Paddle
process.env.PADDLE_WEBHOOK_SECRET='pdl_secret';
const signed=(obj,ts=Math.floor(Date.now()/1000),sec='pdl_secret')=>{const body=JSON.stringify(obj);return{body,headers:{'paddle-signature':`ts=${ts};h1=${createHmac('sha256',sec).update(ts+':'+body).digest('hex')}`}}};
const ev=(id,over={})=>({event_type:'transaction.completed',data:{id,currency_code:'USD',custom_data:{user_id:'pd1',plan:'pro'},details:{totals:{total:'399'}},...over}});
let sg=signed(ev('txn_01aaaaaaaaaaaaaaaaaaaaaaaa'));h=await hook('/paddle',sg.headers,sg.body);ok(h.ok&&!h.duplicate&&(await call('pd1',{action:'status'})).plan==='pro','Paddle: valid payment activates the plan');
const ex1=(await call('pd1',{action:'status'})).expires_at;h=await hook('/paddle',sg.headers,sg.body);ok(h.duplicate===true&&(await call('pd1',{action:'status'})).expires_at===ex1,'Paddle: repeated delivery does not extend twice');
const pr=(await call('pd1',{action:'my_payments'})).rows[0];ok(pr.source==='paddle'&&pr.currency==='USD'&&pr.amountCents===399&&pr.status==='approved','Paddle: payment recorded with currency and amount');
sg=signed(ev('txn_01bbbbbbbbbbbbbbbbbbbbbbbb'),Math.floor(Date.now()/1000),'wrong');h=await hook('/paddle',sg.headers,sg.body);ok(h._s===401,'Paddle: wrong signature refused');
sg=signed(ev('txn_01cccccccccccccccccccccccc'),Math.floor(Date.now()/1000)-3600);h=await hook('/paddle',sg.headers,sg.body);ok(h._s===401,'Paddle: old timestamp refused (replay)');
h=await hook('/paddle',{},'{}');ok(h._s===401,'Paddle: no signature refused');
sg=signed({event_type:'subscription.created',data:{}});h=await hook('/paddle',sg.headers,sg.body);ok(h.ignored===true,'Paddle: other events ignored');
sg=signed(ev('txn_01dddddddddddddddddddddddd',{custom_data:{}}));h=await hook('/paddle',sg.headers,sg.body);ok(h.ignored===true,'Paddle: payment without user data ignored');
const b1=JSON.stringify({a:1}),ts1=Math.floor(Date.now()/1000),good=createHmac('sha256','k').update(ts1+':'+b1).digest('hex');
ok(verifyPaddle(b1,`ts=${ts1};h1=deadbeef;h1=${good}`,'k')&&!verifyPaddle(b1+' ',`ts=${ts1};h1=${good}`,'k')&&!verifyPaddle(b1,`ts=${ts1};h1=${good}`,''),'Paddle: signature check handles rotated secrets and tampering');
// checkout creation
const realFetch=globalThis.fetch;let sent=null;
r=await call('ck1',{action:'create_checkout',plan:'pro'});ok(!r.ok&&/not set up/.test(r.reason),'checkout: clear message when card payments are not configured');
process.env.PADDLE_API_KEY='k';process.env.PADDLE_PRICE_PRO='pri_pro';process.env.PADDLE_PRICE_ULTRA='pri_ultra';
globalThis.fetch=async(u,o)=>{sent={u,o};return{ok:true,json:async()=>({data:{checkout:{url:'https://pay.example/c/1'}}})}};
r=await call('ck1',{action:'create_checkout',plan:'ultra'});const sb=JSON.parse(sent.o.body);ok(r.ok&&r.url==='https://pay.example/c/1'&&sb.items[0].price_id==='pri_ultra'&&sb.custom_data.user_id==='ck1'&&sb.custom_data.plan==='ultra'&&/sandbox-api/.test(sent.u)&&sent.o.headers.Authorization==='Bearer k','checkout: creates a Paddle transaction carrying user id and plan');
ok(!(await call('ck1',{action:'create_checkout',plan:'gold'})).ok,'checkout: unknown plan refused');
globalThis.fetch=async()=>{throw new Error('net')};r=await call('ck1',{action:'create_checkout',plan:'pro'});ok(!r.ok&&/Could not start/.test(r.reason),'checkout: network failure handled');
globalThis.fetch=realFetch;
// legacy database without the new columns
for(const c of ['currency','source','amountCents'])delete tables.payments.cols[c];
r=await pay('lg1','pro','LEGACY123456');ok(r.ok,'old database without new columns still accepts payments');
for(const c of ['currency','source','amountCents'])tables.payments.cols[c]=1;
// revenue and automation
const rv=await call('admin1',{action:'admin_revenue'});ok(rv.ok&&Object.values(rv.days).reduce((a,b)=>a+b,0)>=5&&rv.totals.PKR>0&&rv.totals.USD===399,'admin revenue: per-day counts and per-currency totals');
const au=await call('admin1',{action:'admin_automation'});ok(au.ok&&au.sms_enabled&&au.paddle_ready&&au.paddle_webhook&&au.sms.length>0&&au.sms.every(x=>x.text.length<=90),'admin automation status and recent SMS (shortened)');
ok((await call('u4',{action:'admin_revenue'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_automation'})).reason==='Not allowed.','revenue and automation are admin only');
}
console.log(log.join('\n'));console.log(log.filter(l=>l.startsWith('FAIL')).length?'\nSOME FAILED':'\nALL PASSED ('+log.length+')');
