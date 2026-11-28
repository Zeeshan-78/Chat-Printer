import {createHmac} from 'node:crypto';
import {parseSms,verifyPaddle} from '../appwrite/functions/api/src/main.js';
import { makeHandler } from '../appwrite/functions/api/src/main.js';
import {mockDb} from './mockdb.mjs';
const {db,tables}=mockDb();
const USERS=['u1','u4','p2','u7','admin1'].map((id,i)=>({$id:id,email:id+'@x.com',name:'User '+id,prefs:id==='u4'?{phone:'+923001112222'}:{},emailVerification:true,registration:'2026-11-0'+(i+1)}));
const usersMock={
  async list({queries=[],search}={}){let r=USERS.filter(u=>!search||u.email.includes(search)||u.name.includes(search));const qs=queries.map(x=>JSON.parse(x));const lim=(qs.find(q=>q.method==='limit')||{values:[1e9]}).values[0];return {total:r.length,users:r.slice(0,lim)}},
  async get({userId}){const u=USERS.find(x=>x.$id===userId);if(!u)throw new Error('user not found');return u},
  async updatePrefs({userId,prefs}){const u=USERS.find(x=>x.$id===userId);u.prefs=prefs;return u},
};
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
let st=await call('u1',{action:'status'});ok(st.plan==='free'&&st.credits===0&&st.exports===0&&st.free_used===false&&st.is_admin===false,'new user starts on Free with no credits');
// free quota: exactly 1 export, text only, first 100 messages
let r=await call('u1',{action:'begin',size:100*MB});ok(r.ok&&r.media===false&&r.trunc===100,'free: 1st export ok, text only, trunc=100');
r=await call('u1',{action:'begin',size:1*MB});ok(!r.ok&&/free export is already used/.test(r.reason),'free: 2nd export refused');
st=await call('u1',{action:'status'});ok(st.exports===1&&st.free_used===true,'free: export counted, free_used set; refused attempt consumed nothing');
r=await call('u2',{action:'begin',size:300*MB});ok(!r.ok&&/too large/.test(r.reason)&&(await call('u2',{action:'status'})).exports===0,'free: 300 MB refused without using the export');
ok((await call('u2',{action:'begin',size:-5})).ok===false,'negative size refused');
// concurrency on the single free export
const cf=await Promise.all(Array.from({length:10},()=>call('u3',{action:'begin',size:MB})));ok(cf.filter(x=>x.ok).length===1,'free: 10 simultaneous requests -> exactly 1 allowed');
// payments: only the paid plan exists now
r=await call('u4',{action:'submit_payment',plan:'pro',method:'JazzCash',tid:'TID123456',name:'Ali'});ok(!r.ok,'old plan names refused');
r=await call('u4',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'bad tid!',name:'Ali'});ok(!r.ok,'bad TID rejected');
r=await call('u4',{action:'submit_payment',plan:'paid',method:'Bitcoin',tid:'TID123456',name:'Ali'});ok(!r.ok,'unknown payment method rejected');
r=await call('u4',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'tid123456',name:'Ali'});ok(r.ok,'valid payment submitted (TID upper-cased)');
r=await call('u5',{action:'submit_payment',plan:'paid',method:'Easypaisa',tid:'TID123456',name:'Bob'});ok(!r.ok&&/already submitted/.test(r.reason),'same TID from another account refused');
for(let i=0;i<4;i++)await call('u6',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'SPAM00000'+i,name:'x'});
r=await call('u6',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'SPAM000009',name:'x'});ok(r.ok,'5th pending payment allowed');
r=await call('u6',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'SPAM000010',name:'x'});ok(!r.ok&&/Too many/.test(r.reason),'6th pending payment refused (anti-spam)');
ok((await call('u4',{action:'my_payments'})).rows[0].status==='pending','user sees own payments');
ok((await call('u4',{action:'my_payments'})).rows[0].amountCents===10000,'payment amount is PKR 100');
// admin approval adds one export credit
ok((await call('u4',{action:'admin_pending'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_decide',id:'r1',decision:'approve'})).reason==='Not allowed.','normal user cannot use admin actions');
const pend=await call('admin1',{action:'admin_pending'});const mine=pend.rows.find(x=>x.tid==='TID123456');ok(!!mine&&mine.name==='Ali','admin sees pending payment');
r=await call('admin1',{action:'admin_decide',id:mine.id,decision:'approve'});ok(r.ok,'admin approves');
st=await call('u4',{action:'status'});ok(st.plan==='paid'&&st.credits===1,'approved payment = 1 export credit');
// paid export: full chat, media, 1 GB; each export consumes one credit
r=await call('u4',{action:'begin',size:1024*MB});ok(r.ok&&r.media===true&&r.trunc===0,'paid: full export with media, no truncation, 1 GB allowed');
st=await call('u4',{action:'status'});ok(st.credits===0&&st.exports===1,'credit consumed by the export');
r=await call('u4',{action:'begin',size:MB});ok(!r.ok&&/no paid exports left/.test(r.reason),'paid: export refused when out of credits');
r=await call('u4',{action:'begin',size:1500*MB});ok(!r.ok&&/too large/.test(r.reason),'paid: 1.5 GB refused');
// credit concurrency: 2 credits, 5 simultaneous -> exactly 2
await call('admin1',{action:'admin_credits',userId:'p2',add:2});
const cc=await Promise.all(Array.from({length:5},()=>call('p2',{action:'begin',size:MB})));ok(cc.filter(x=>x.ok).length===2&&cc.filter(x=>x.ok).every(x=>x.media),'credits: 5 simultaneous requests -> exactly 2 exports');
ok((await call('p2',{action:'status'})).credits===0,'credits: balance is exactly 0 after use');
// admin credit grants and removal
r=await call('admin1',{action:'admin_credits',userId:'p2',add:5});ok(r.ok&&(await call('p2',{action:'status'})).credits===5,'admin can grant 5 credits');
r=await call('admin1',{action:'admin_credits',userId:'p2',add:-9});ok(!r.ok&&/Not enough credits/.test(r.reason),'admin cannot remove more credits than exist');
r=await call('admin1',{action:'admin_credits',userId:'p2',add:-3});ok(r.ok&&(await call('p2',{action:'status'})).credits===2,'admin can remove credits');
ok((await call('admin1',{action:'admin_credits',userId:'p2',add:0})).ok===false&&(await call('admin1',{action:'admin_credits',userId:'p2',add:500})).ok===false,'credit grant: 0 and >100 refused');
// admin set plan
ok((await call('admin1',{action:'admin_set_plan',userId:'p2',plan:'free'})).ok&&(await call('p2',{action:'status'})).plan==='free','admin can set a user back to Free (credits cleared)');
ok((await call('admin1',{action:'admin_set_plan',userId:'p2',plan:'gold'})).ok===false,'invalid plan refused');
await call('admin1',{action:'admin_set_plan',userId:'p2',plan:'paid'});
// legacy pro/ultra rows still behave as paid until expiry
tables.subscriptions.rows.set('lg9',{$id:'lg9',userId:'lg9',plan:'pro',expiresAt:new Date(Date.now()+864e5).toISOString(),freeUsed:0,credits:0,exports:0});
ok((await call('lg9',{action:'status'})).plan==='paid','legacy unexpired pro row counts as paid');
ok((await call('lg9',{action:'begin',size:500*MB})).ok,'legacy pro: full export without spending credits');
tables.subscriptions.rows.get('lg9').expiresAt=new Date(Date.now()-1000).toISOString();
ok((await call('lg9',{action:'status'})).plan==='free','expired subscription falls back to Free');
// rejected payment adds nothing
await call('u8',{action:'submit_payment',plan:'paid',method:'JazzCash',tid:'REJECT0001',name:'R'});const rp=(await call('admin1',{action:'admin_pending'})).rows.find(x=>x.tid==='REJECT0001');
await call('admin1',{action:'admin_decide',id:rp.id,decision:'reject'});ok((await call('u8',{action:'status'})).plan==='free'&&(await call('u8',{action:'my_payments'})).rows[0].status==='rejected','rejected payment keeps user on Free');
ok((await call('u1',{action:'nope'})).reason==='Unknown action.','unknown action handled');
// rate limiting: 31 rapid calls, the last refused (30/min per user+action)
let refused=0,lastOk=true;for(let i=0;i<31;i++){const x=await call('rl1',{action:'status'});if(!x.ok)refused++;}
ok(refused===1,'rate limit: 31st call in a minute refused');
// body cap
{let out;await makeHandler(db,usersMock)({req:{headers:{'x-appwrite-user-id':'u1'},bodyText:'x'.repeat(20001),bodyJson:{action:'status'}},res:{json:o=>{out=o}},error:()=>{}});ok(out.reason==='Request too large.','body cap: oversized request refused');}
// ---- extension keys
await call('admin1',{action:'admin_credits',userId:'u4',add:1}); // top up for the extension tests
r=await call('u4',{action:'ext_key'});ok(r.ok&&/^cp_[0-9a-f]{48}$/.test(r.key),'extension key created (cp_ + 48 hex), shown once');
const key1=r.key;
let ea=await call(null,{action:'ext_auth',key:key1});ok(ea.ok&&ea.plan==='paid'&&ea.media===true,'ext_auth works without a session and reports the plan');
ok((await call(null,{action:'ext_auth',key:'cp_'+'0'.repeat(48)})).ok===false,'ext_auth: wrong key refused');
ok((await call(null,{action:'ext_auth',key:'nonsense'})).ok===false,'ext_auth: malformed key refused');
ea=await call(null,{action:'ext_auth',key:key1,consume:1});ok(ea.ok&&ea.media===true,'ext_auth consume: spends one credit for a full export');
ok((await call('u4',{action:'status'})).credits===0,'ext_auth consume actually consumed the credit');
ea=await call(null,{action:'ext_auth',key:key1,consume:1});ok(!ea.ok&&/no paid exports left|free export/.test(ea.reason||''),'ext_auth consume: refused when no quota remains');
r=await call('u4',{action:'ext_key'});ok(r.ok&&r.key!==key1,'rotating creates a new key');
ok((await call(null,{action:'ext_auth',key:key1})).ok===false,'old key stops working after rotation');
ok((await call(null,{action:'ext_auth',key:r.key})).ok,'new key works');
// free user via extension: text only + truncation
const fk=await call('u7',{action:'ext_key'});
ea=await call(null,{action:'ext_auth',key:fk.key});ok(ea.ok&&ea.media===false&&ea.trunc===100,'free plan via extension: text only, first 100 messages');
ea=await call(null,{action:'ext_auth',key:fk.key,consume:1});ok(ea.ok&&ea.media===false,'free extension export consumes the single free export');
ok((await call('u7',{action:'status'})).free_used===true,'free extension export marked as used');
// ---- admin stats/users/payments
ok((await call('u4',{action:'admin_stats'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_users'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_credits',userId:'u1',add:1})).reason==='Not allowed.'&&(await call('u4',{action:'admin_payments'})).reason==='Not allowed.','admin actions refuse normal users');
await call('admin1',{action:'admin_credits',userId:'u1',add:1});
const stt=await call('admin1',{action:'admin_stats'});ok(stt.ok&&stt.users===5&&stt.pending>=1&&stt.approved>=1&&stt.revenue>=100&&stt.active>=1,'admin stats: '+JSON.stringify(stt));
const au=await call('admin1',{action:'admin_users',search:'u4'});ok(au.ok&&au.rows.length===1&&au.rows[0].phone==='+923001112222'&&au.rows[0].plan==='paid','admin users: search, phone from profile, plan joined');
const all=await call('admin1',{action:'admin_users'});ok(all.total===5&&all.rows.find(x=>x.id==='admin1').plan==='free'&&typeof all.rows.find(x=>x.id==='u4').exports==='number','admin users list shows effective plans and export counts');
const ap=await call('admin1',{action:'admin_payments',status:'approved'});ok(ap.ok&&ap.rows.length>=1&&ap.rows.every(x=>x.status==='approved'),'admin payments filter: approved');
const allp=await call('admin1',{action:'admin_payments',status:'all'});ok(allp.rows.length>ap.rows.length,'admin payments filter: all');
const noScope={async list(){throw new Error('missing scope')}};let o2;await makeHandler(db,noScope)({req:{headers:{'x-appwrite-user-id':'admin1'},bodyJson:{action:'admin_users'}},res:{json:x=>{o2=x}},error:()=>{}});ok(o2.ok===false&&/users.read/.test(o2.reason),'missing users.read scope gives a clear message');

{
// ---- SMS auto-verification, Paddle webhook, card checkout, revenue, automation
const hook=async(path,headers,body)=>{let out;await makeHandler(db,usersMock)({req:{headers,method:'POST',path,bodyText:typeof body==='string'?body:JSON.stringify(body)},res:{json:(o,s)=>{out={...o,_s:s||200}}},error:()=>{}});return out;};
process.env.SMS_SECRET='s3cret';const SH={'x-sms-secret':'s3cret'};
const pay=(uid,tid,m='Easypaisa')=>call(uid,{action:'submit_payment',plan:'paid',method:m,tid,name:'N'});
ok(parseSms('You have received Rs. 100.00 from ALI. TID: 12345678901. Balance Rs 5,000').tid==='12345678901'&&parseSms('Received PKR 1,250 Trx ID 998877665').amount===125000,'SMS parser: labelled TID and amount');
ok(parseSms('Sent to 03001234567 amount Rs 100').tid==='','SMS parser: a phone number is not mistaken for a TID');
let h=await hook('/sms',{},{text:'x'});ok(h._s===401,'SMS hook: missing secret refused');
h=await hook('/sms',{'x-sms-secret':'nope'},{text:'x'});ok(h._s===401,'SMS hook: wrong secret refused');
const keep=process.env.SMS_SECRET;delete process.env.SMS_SECRET;h=await hook('/sms',SH,{text:'x'});ok(h._s===503,'SMS hook: off until a secret is set');process.env.SMS_SECRET=keep;
// order A: user submits first, SMS arrives after
r=await pay('sa1','TIDAAA11111');ok(r.ok&&r.activated===false,'auto: payment waits for its SMS');
h=await hook('/sms',SH,{text:'Rs. 100 received from Ali. TID: TIDAAA11111. Balance Rs 9,000'});ok(h.ok&&h.matched===true,'auto: SMS arrives later and adds the export credit');
ok((await call('sa1',{action:'status'})).credits===1,'auto: user has 1 credit');
ok((await call('sa1',{action:'my_payments'})).rows[0].source==='sms'&&(await call('sa1',{action:'my_payments'})).rows[0].status==='approved','auto: payment marked approved by sms');
// order B: SMS first, user submits after
h=await hook('/sms',SH,{text:'You received Rs 100 TID 55566677788 from Sara'});ok(h.ok&&h.matched===false,'auto: SMS with no payment yet is stored');
r=await pay('sb1','55566677788');ok(r.ok&&r.activated===true&&(await call('sb1',{action:'status'})).credits===1,'auto: user submits after the SMS and is activated at once');
// underpay, unlabelled, phone-number trick, old sms
await hook('/sms',SH,{text:'Rs. 50 received. TID: UNDER1234567'});r=await pay('sc1','UNDER1234567');ok(r.ok&&r.activated===false,'auto: underpayment is not activated');
await hook('/sms',SH,{text:'Rs. 100 received from 03001234567 ref none'});r=await pay('sd1','03001234567');ok(r.ok&&r.activated===false,'auto: a phone number cannot be used as a TID');
tables.bank_sms.rows.set('old1',{$id:'old1',$createdAt:new Date(Date.now()-9*864e5).toISOString(),text:'Rs. 100 TID: OLDTID123456',matched:''});r=await pay('se1','OLDTID123456');ok(r.ok&&r.activated===false,'auto: SMS older than 7 days is ignored');
await hook('/sms',SH,{text:'Rs. 450 received TID: OVER12345678'});r=await pay('sf1','OVER12345678');ok(r.activated===true,'auto: overpayment is accepted');
await hook('/sms',SH,{text:'Rs. 100 received TID: ONCE12345678'});r=await pay('sg1','ONCE12345678');const r2=await pay('sg2','ONCE12345678');ok(r.activated&&!r2.ok,'auto: one TID cannot activate two accounts');
h=await hook('/sms',SH,'not json');ok(h._s===400,'SMS hook: bad body refused');
const pending=(await call('admin1',{action:'admin_payments',status:'pending'})).rows;ok(pending.some(x=>x.tid==='UNDER1234567'),'unmatched payments stay pending for the admin');
// Paddle
process.env.PADDLE_WEBHOOK_SECRET='pdl_secret';
const signed=(obj,ts=Math.floor(Date.now()/1000),sec='pdl_secret')=>{const body=JSON.stringify(obj);return{body,headers:{'paddle-signature':`ts=${ts};h1=${createHmac('sha256',sec).update(ts+':'+body).digest('hex')}`}}};
const ev=(id,over={})=>({event_type:'transaction.completed',data:{id,currency_code:'USD',custom_data:{user_id:'pd1',plan:'paid'},details:{totals:{total:'149'}},...over}});
let sg=signed(ev('txn_01aaaaaaaaaaaaaaaaaaaaaaaa'));h=await hook('/paddle',sg.headers,sg.body);ok(h.ok&&!h.duplicate&&(await call('pd1',{action:'status'})).credits===1,'Paddle: valid payment adds one export credit');
h=await hook('/paddle',sg.headers,sg.body);ok(h.duplicate===true&&(await call('pd1',{action:'status'})).credits===1,'Paddle: repeated delivery does not add a second credit');
const pr=(await call('pd1',{action:'my_payments'})).rows[0];ok(pr.source==='paddle'&&pr.currency==='USD'&&pr.amountCents===149&&pr.status==='approved','Paddle: payment recorded with currency and amount');
sg=signed(ev('txn_01bbbbbbbbbbbbbbbbbbbbbbbb'),Math.floor(Date.now()/1000),'wrong');h=await hook('/paddle',sg.headers,sg.body);ok(h._s===401,'Paddle: wrong signature refused');
sg=signed(ev('txn_01cccccccccccccccccccccccc'),Math.floor(Date.now()/1000)-3600);h=await hook('/paddle',sg.headers,sg.body);ok(h._s===401,'Paddle: old timestamp refused (replay)');
h=await hook('/paddle',{},'{}');ok(h._s===401,'Paddle: no signature refused');
sg=signed({event_type:'subscription.created',data:{}});h=await hook('/paddle',sg.headers,sg.body);ok(h.ignored===true,'Paddle: other events ignored');
sg=signed(ev('txn_01dddddddddddddddddddddddd',{custom_data:{}}));h=await hook('/paddle',sg.headers,sg.body);ok(h.ignored===true,'Paddle: payment without user data ignored');
sg=signed(ev('txn_01eeeeeeeeeeeeeeeeeeeeeeee',{custom_data:{user_id:'pd9',plan:'pro'}}));h=await hook('/paddle',sg.headers,sg.body);ok(h.ignored===true,'Paddle: old plan names ignored');
const b1=JSON.stringify({a:1}),ts1=Math.floor(Date.now()/1000),good=createHmac('sha256','k').update(ts1+':'+b1).digest('hex');
ok(verifyPaddle(b1,`ts=${ts1};h1=deadbeef;h1=${good}`,'k')&&!verifyPaddle(b1+' ',`ts=${ts1};h1=${good}`,'k')&&!verifyPaddle(b1,`ts=${ts1};h1=${good}`,''),'Paddle: signature check handles rotated secrets and tampering');
// checkout creation
const realFetch=globalThis.fetch;let sent=null;
r=await call('ck1',{action:'create_checkout',plan:'paid'});ok(!r.ok&&/not set up/.test(r.reason),'checkout: clear message when card payments are not configured');
process.env.PADDLE_API_KEY='k';process.env.PADDLE_PRICE_PAID='pri_paid';
globalThis.fetch=async(u,o)=>{sent={u,o};return{ok:true,json:async()=>({data:{checkout:{url:'https://pay.example/c/1'}}})}};
r=await call('ck1',{action:'create_checkout',plan:'paid'});const sb=JSON.parse(sent.o.body);ok(r.ok&&r.url==='https://pay.example/c/1'&&sb.items[0].price_id==='pri_paid'&&sb.custom_data.user_id==='ck1'&&sb.custom_data.plan==='paid'&&/sandbox-api/.test(sent.u)&&sent.o.headers.Authorization==='Bearer k','checkout: creates a Paddle transaction carrying user id and plan');
ok(!(await call('ck1',{action:'create_checkout',plan:'pro'})).ok,'checkout: old plan names refused');
globalThis.fetch=async()=>{throw new Error('net')};r=await call('ck1',{action:'create_checkout',plan:'paid'});ok(!r.ok&&/Could not start/.test(r.reason),'checkout: network failure handled');
globalThis.fetch=realFetch;
// legacy database without the new columns
for(const c of ['currency','source','amountCents'])delete tables.payments.cols[c];
r=await pay('lg1','LEGACY123456');ok(r.ok,'old database without new columns still accepts payments');
for(const c of ['currency','source','amountCents'])tables.payments.cols[c]=1;
// revenue and automation
const rv=await call('admin1',{action:'admin_revenue'});ok(rv.ok&&Object.values(rv.days).reduce((a,b)=>a+b,0)>=5&&rv.totals.PKR>0&&rv.totals.USD===149,'admin revenue: per-day counts and per-currency totals');
const au=await call('admin1',{action:'admin_automation'});ok(au.ok&&au.sms_enabled&&au.paddle_ready&&au.paddle_webhook&&au.sms.length>0&&au.sms.every(x=>x.text.length<=90),'admin automation status and recent SMS (shortened)');
ok((await call('u4',{action:'admin_revenue'})).reason==='Not allowed.'&&(await call('u4',{action:'admin_automation'})).reason==='Not allowed.','revenue and automation are admin only');
}
console.log(log.join('\n'));console.log(log.filter(l=>l.startsWith('FAIL')).length?'\nSOME FAILED':'\nALL PASSED ('+log.length+')');
