/* GODIA PRIME CONNECT — email/SMS OTP route module.
   Integrate into the EXISTING Worker; do not replace its main worker or database. */
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json; charset=utf-8', ...headers}});
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,'0');
const randomToken = () => { const b=crypto.getRandomValues(new Uint8Array(32)); return [...b].map(x=>x.toString(16).padStart(2,'0')).join(''); };
const cookieToken = request => {
  const auth=request.headers.get('Authorization')||'';
  if(auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie=request.headers.get('Cookie')||'';
  const match=cookie.match(/(?:^|;\s*)gpc_session=([^;]+)/);
  try{return match?decodeURIComponent(match[1]):''}catch{return ''}
};
export const gpcSessionCookie = (token, remember=true) => `gpc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax${remember?'; Max-Age=604800':''}`;
export const gpcClearSessionCookie = () => 'gpc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
export { cookieToken };

async function sendEmail(env, to, code) {
  if(!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) throw new Error('Email OTP service is not configured. Set RESEND_API_KEY and OTP_FROM_EMAIL.');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[to],subject:'Your GODIA PRIME CONNECT sign-in code',text:`Your GODIA PRIME CONNECT verification code is ${code}. It expires in 10 minutes. Do not share it with anyone.`})});
  if(!r.ok) throw new Error(`Email provider returned HTTP ${r.status}`);
}
async function sendSms(env, to, code) {
  if(!env.AT_API_KEY || !env.AT_USERNAME) throw new Error('SMS OTP service is not configured. Set AT_API_KEY and AT_USERNAME.');
  const form=new URLSearchParams({username:env.AT_USERNAME,to,message:`GODIA PRIME CONNECT code: ${code}. Expires in 10 minutes. Do not share it.`});
  if(env.AT_SENDER_ID) form.set('from',env.AT_SENDER_ID);
  const r=await fetch(env.AT_API_URL||'https://api.africastalking.com/version1/messaging',{method:'POST',headers:{apiKey:env.AT_API_KEY,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:form});
  const data=await r.json().catch(()=>({}));
  if(!r.ok || (data.SMSMessageData?.Recipients||[]).some(x=>x.statusCode && x.statusCode!==101)) throw new Error(`SMS provider returned HTTP ${r.status}`);
}
function normalizePhone(value){let p=String(value||'').replace(/[\s()\-]/g,'');if(p.startsWith('0')&&p.length===10)p='+254'+p.slice(1);else if(p.startsWith('254'))p='+'+p;return p;}
async function findUser(db, channel, destination){
  if(channel==='email') return await db.prepare("SELECT id, display_name, email, phone, role, status FROM gpc_users WHERE lower(email)=lower(?) LIMIT 1").bind(destination).first();
  const p=normalizePhone(destination); const local=p.startsWith('+254')?'0'+p.slice(4):p;
  return await db.prepare("SELECT id, display_name, email, phone, role, status FROM gpc_users WHERE phone IN (?, ?, ?) LIMIT 1").bind(p, p.replace(/^\+/,''), local).first();
}
async function requestOtp(request, env){
  const body=await request.json().catch(()=>({})); const channel=body.channel==='sms'?'sms':'email';
  const destination=String(body.destination||body.email||body.phone||'').trim();
  if(!destination) return json({ok:false,message:'Enter your registered email address or phone number.'},400);
  if(channel==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return json({ok:false,message:'Enter a valid email address.'},400);
  if(channel==='sms' && !/^\+?[0-9]{9,15}$/.test(normalizePhone(destination))) return json({ok:false,message:'Enter a valid phone number, for example 0712345678.'},400);
  const user=await findUser(env.DB,channel,destination);
  // Do not disclose whether an account exists.
  if(!user || user.status!=='active') return json({ok:true,message:'If an active account matches those details, a verification code will be sent.'});
  const now=Date.now();
  const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM gpc_otp_challenges WHERE user_id=? AND created_at > ?").bind(user.id,new Date(now-15*60*1000).toISOString()).first();
  if(Number(recent?.n||0)>=3) return json({ok:false,message:'Too many codes requested. Wait 15 minutes and try again.'},429);
  const code=randomCode(), challengeId=crypto.randomUUID(), salt=randomToken().slice(0,24);
  await env.DB.prepare("INSERT INTO gpc_otp_challenges (id,user_id,channel,destination,code_salt,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,?,?,?,?,0,?)")
    .bind(challengeId,user.id,channel,destination,salt,await sha256(`${salt}:${code}`),new Date(now+10*60*1000).toISOString(),new Date(now).toISOString()).run();
  try { if(channel==='email') await sendEmail(env,destination,code); else await sendSms(env,normalizePhone(destination),code); }
  catch(e){ await env.DB.prepare('DELETE FROM gpc_otp_challenges WHERE id=?').bind(challengeId).run(); console.error('GPC OTP delivery failed',e?.message||e); return json({ok:false,message:'The verification service is not ready or delivery failed. Please try password/PIN sign-in or contact the administrator.'},503); }
  return json({ok:true,challengeId,message:`Verification code sent if the account is active. It expires in 10 minutes.`});
}
async function verifyOtp(request,env){
  const body=await request.json().catch(()=>({})); const id=String(body.challengeId||''); const code=String(body.code||'').trim();
  if(!id || !/^\d{6}$/.test(code)) return json({ok:false,message:'Enter the six-digit verification code.'},400);
  const challenge=await env.DB.prepare('SELECT * FROM gpc_otp_challenges WHERE id=? LIMIT 1').bind(id).first();
  if(!challenge || challenge.consumed_at || Date.parse(challenge.expires_at)<=Date.now()) return json({ok:false,message:'This code has expired or is no longer valid. Request a new code.'},400);
  if(Number(challenge.attempts)>=5) return json({ok:false,message:'Too many incorrect attempts. Request a new code.'},429);
  const good=(await sha256(`${challenge.code_salt}:${code}`))===challenge.code_hash;
  if(!good){await env.DB.prepare('UPDATE gpc_otp_challenges SET attempts=attempts+1 WHERE id=?').bind(id).run();return json({ok:false,message:'That code is incorrect. Check it and try again.'},400)}
  const user=await env.DB.prepare('SELECT id,display_name,email,phone,role,status FROM gpc_users WHERE id=? LIMIT 1').bind(challenge.user_id).first();
  if(!user||user.status!=='active') return json({ok:false,message:'This account is not active.'},403);
  await env.DB.prepare('UPDATE gpc_otp_challenges SET consumed_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
  const token=randomToken(), tokenHash=await sha256(token), now=new Date(), expiry=new Date(now.getTime()+7*24*60*60*1000);
  await env.DB.prepare('INSERT INTO gpc_sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.id,tokenHash,expiry.toISOString(),now.toISOString(),now.toISOString()).run();
  return json({ok:true,success:true,user,expiresAt:expiry.toISOString(),message:'Signed in successfully.'},200,{'Set-Cookie':gpcSessionCookie(token,true),'Cache-Control':'no-store'});
}
export async function handleGpcOtpAuth(request,env){
  const url=new URL(request.url);
  if(request.method!=='POST') return json({ok:false,message:'Method not allowed.'},405);
  if(url.pathname==='/api/auth/otp/request') return requestOtp(request,env);
  if(url.pathname==='/api/auth/otp/verify') return verifyOtp(request,env);
  return null;
}
