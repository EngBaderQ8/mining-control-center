import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerRepo } from "../db/repo";
import { verifyToken } from "../auth/jwt";

export interface AdminDeps {
  repo: ServerRepo;
  jwtSecret: string;
  adminEmails: Set<string>; // lowercased
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** Append-only audit line for state-changing admin actions (pm2 captures stdout). */
function audit(req: IncomingMessage, actor: string, action: string, target: string): void {
  const ip = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  console.log(`[admin-audit] actor=${actor} action=${action} target=${target} ip=${ip} at=${new Date().toISOString()}`);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (v: Record<string, unknown>): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        finish({});
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.on("end", () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>);
      } catch {
        finish({});
      }
    });
    req.on("error", () => finish({}));
    req.on("close", () => finish({}));
  });
}

/** Returns the admin's userId if the request bears a valid admin token, else null. */
function adminUserId(req: IncomingMessage, deps: AdminDeps): string | null {
  const raw = req.headers["authorization"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const m = /^Bearer\s+(.+)$/.exec(header ?? "");
  if (!m) return null;
  const uid = verifyToken(m[1]!, deps.jwtSecret);
  if (!uid) return null;
  const u = deps.repo.findUserById(uid);
  if (!u) return null;
  // Suspension is immediate revocation — a suspended admin's still-valid token
  // must NOT grant access (tokens live 30 days).
  if (u.suspended) return null;
  return deps.adminEmails.has(u.email.toLowerCase()) ? uid : null;
}

/** Owner admin dashboard: serves the page and the cross-account API. */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminDeps,
): Promise<boolean> {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (!path.startsWith("/admin")) return false;

  if ((path === "/admin" || path === "/admin/") && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    });
    res.end(ADMIN_HTML);
    return true;
  }

  if (path.startsWith("/admin/api/")) {
    const uid = adminUserId(req, deps);
    if (!uid) {
      send(res, 403, { error: "forbidden" });
      return true;
    }
    const repo = deps.repo;
    if (path === "/admin/api/overview" && req.method === "GET") {
      send(res, 200, repo.adminOverview());
      return true;
    }
    if (path === "/admin/api/accounts" && req.method === "GET") {
      send(res, 200, { accounts: repo.accountSummaries() });
      return true;
    }
    if (path === "/admin/api/agents" && req.method === "GET") {
      send(res, 200, { agents: repo.listAllAgents() });
      return true;
    }
    if (path === "/admin/api/account" && req.method === "GET") {
      const q = new URL(req.url ?? "", "http://local");
      const tid = q.searchParams.get("userId") ?? "";
      send(res, 200, {
        sites: repo.listSites(tid),
        devices: repo.listDevices(tid),
        statuses: repo.listStatuses(tid),
      });
      return true;
    }
    if (path === "/admin/api/suspend" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b["userId"] === "string") {
        repo.setSuspended(b["userId"], !!b["suspended"]);
        audit(req, uid, b["suspended"] ? "suspend" : "unsuspend", b["userId"]);
      }
      send(res, 200, { ok: true });
      return true;
    }
    if (path === "/admin/api/delete" && req.method === "POST") {
      const b = await readBody(req);
      // Never let an admin delete their own account from the panel.
      if (typeof b["userId"] === "string" && b["userId"] !== uid) {
        repo.deleteUser(b["userId"]);
        audit(req, uid, "delete", b["userId"]);
      }
      send(res, 200, { ok: true });
      return true;
    }
    send(res, 404, { error: "not found" });
    return true;
  }
  return false;
}

// Self-contained dashboard page (no build step). Data loads via fetch with the
// admin's Bearer token; all customer-provided text is escaped before render.
const ADMIN_HTML = `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة تحكم المالك — مركز التحكم بالتعدين</title>
<style>
:root{--bg:#0a0c11;--card:#151922;--card2:#1b202b;--bd:#262c38;--tx:#e9ecf2;--mut:#8b93a3;--acc:#5b7cfa;--grn:#2dd4a7;--red:#f87171;--amb:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:'Segoe UI',Tahoma,sans-serif;font-size:14px}
.wrap{max-width:1100px;margin:0 auto;padding:18px}
.hd{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--bd);margin-bottom:16px}
.logo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(150deg,#5b7cfa,#3b5bdb);font-size:18px}
.btn{background:var(--card2);border:1px solid var(--bd);color:var(--tx);border-radius:9px;padding:8px 13px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--acc)}.btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.btn.danger{color:var(--red)}.btn.sm{padding:5px 9px;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px 16px}
.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
h2{font-size:15px;margin:18px 0 8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
th,td{padding:9px 11px;text-align:right;font-size:13px;border-bottom:1px solid var(--bd)}
th{background:var(--card2);color:var(--mut);font-weight:600}tr:last-child td{border-bottom:0}
.pill{font-size:11px;padding:2px 8px;border-radius:999px}.on{background:rgba(45,212,167,.15);color:var(--grn)}.off{background:rgba(248,113,113,.15);color:var(--red)}
.in{background:#0d1016;border:1px solid var(--bd);color:var(--tx);border-radius:9px;padding:10px 12px;width:100%;margin:6px 0}
.center{max-width:360px;margin:8vh auto;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:22px}
.err{color:var(--red);font-size:13px;margin:6px 0}.muted{color:var(--mut)}.grn{color:var(--grn)}
.hide{display:none}.row{display:flex;gap:6px;flex-wrap:wrap}
</style></head><body>
<div id="login" class="center">
  <div class="hd" style="border:0;padding:0;margin-bottom:14px"><div class="logo">⛏️</div><b>لوحة تحكم المالك</b></div>
  <input id="em" class="in" placeholder="البريد (حساب المدير)" autocomplete="username">
  <input id="pw" class="in" type="password" placeholder="كلمة المرور" autocomplete="current-password">
  <div id="le" class="err"></div>
  <button class="btn primary" style="width:100%" onclick="doLogin()">دخول</button>
</div>
<div id="dash" class="wrap hide">
  <div class="hd">
    <div class="logo">⛏️</div>
    <div><div style="font-weight:700">لوحة تحكم المالك</div><div class="l muted" style="font-size:12px">إشراف على كل العملاء</div></div>
    <span style="margin-inline-start:auto"></span>
    <button class="btn sm" onclick="loadAll()">🔄 تحديث</button>
    <button class="btn sm" onclick="logout()">خروج</button>
  </div>
  <div id="cards" class="cards"></div>
  <h2>الحسابات</h2>
  <div id="accounts"></div>
  <div id="detail"></div>
  <h2>صحة الوكلاء (لابتوبات المواقع)</h2>
  <div id="agents"></div>
</div>
<script>
var TOKEN = localStorage.getItem('mcc_admin_token') || '';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function th(n){return (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});}
function ago(t){if(!t)return '—';var s=Math.floor((Date.now()-t)/1000);if(s<60)return 'الآن';if(s<3600)return Math.floor(s/60)+' د';if(s<86400)return Math.floor(s/3600)+' س';return Math.floor(s/86400)+' ي';}
function api(path,opts){opts=opts||{};opts.headers=Object.assign({'authorization':'Bearer '+TOKEN,'content-type':'application/json'},opts.headers||{});return fetch(path,opts);}
function doLogin(){
  var em=document.getElementById('em').value.trim(),pw=document.getElementById('pw').value;
  document.getElementById('le').textContent='';
  fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,password:pw})})
   .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
   .then(function(x){ if(!x.ok){document.getElementById('le').textContent=x.j.error||'فشل الدخول';return;}
     TOKEN=x.j.token; localStorage.setItem('mcc_admin_token',TOKEN); start(); })
   .catch(function(){document.getElementById('le').textContent='تعذّر الاتصال بالخادم';});
}
function logout(){TOKEN='';localStorage.removeItem('mcc_admin_token');location.reload();}
function start(){
  api('/admin/api/overview').then(function(r){
    if(r.status===403){document.getElementById('le').textContent='هذا الحساب ليس مديراً.';TOKEN='';localStorage.removeItem('mcc_admin_token');return;}
    document.getElementById('login').classList.add('hide');
    document.getElementById('dash').classList.remove('hide');
    loadAll();
  }).catch(function(){document.getElementById('le').textContent='تعذّر الاتصال بالخادم';});
}
function loadAll(){ ov(); accts(); agents(); }
function ov(){ api('/admin/api/overview').then(function(r){return r.json();}).then(function(o){
  document.getElementById('cards').innerHTML=
   card(th(o.hashrate)+' TH/s','الهاش الكلي','var(--acc)')+
   card(th(o.users),'الحسابات')+card(th(o.devices),'الأجهزة')+
   card(th(o.online),'أونلاين','var(--grn)')+card(th(o.offline),'أوفلاين','var(--red)')+
   card(th(o.sites),'المواقع');
}); }
function card(n,l,c){return '<div class="card"><div class="n" style="color:'+(c||'var(--tx)')+'">'+n+'</div><div class="l">'+l+'</div></div>';}
var ACCT={};
function accts(){ api('/admin/api/accounts').then(function(r){return r.json();}).then(function(d){
  ACCT={}; (d.accounts||[]).forEach(function(a){ACCT[a.id]=a;});
  var rows=(d.accounts||[]).map(function(a){
    var st=a.suspended?'<span class="pill off">موقوف</span>':'<span class="pill on">نشط</span>';
    return '<tr><td>'+esc(a.email)+'</td><td>'+a.sites+'</td><td>'+a.devices+'</td>'+
      '<td class="grn">'+a.online+'</td><td>'+th(a.hashrate)+' TH</td><td class="muted">'+ago(a.lastSeen)+'</td><td>'+st+'</td>'+
      '<td><div class="row">'+
        '<button class="btn sm" onclick="detail(\\''+a.id+'\\')">تفصيل</button>'+
        '<button class="btn sm" onclick="susp(\\''+a.id+'\\','+(a.suspended?0:1)+')">'+(a.suspended?'تفعيل':'إيقاف')+'</button>'+
        '<button class="btn sm danger" onclick="del(\\''+a.id+'\\')">حذف</button>'+
      '</div></td></tr>';
  }).join('');
  document.getElementById('accounts').innerHTML='<table><thead><tr><th>البريد</th><th>المواقع</th><th>الأجهزة</th><th>أونلاين</th><th>الهاش</th><th>آخر ظهور</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" class="muted">لا حسابات بعد</td></tr>')+'</tbody></table>';
}); }
function agents(){ api('/admin/api/agents').then(function(r){return r.json();}).then(function(d){
  var rows=(d.agents||[]).map(function(a){
    var fresh=a.lastSeenAt&&(Date.now()-a.lastSeenAt)<120000;
    return '<tr><td>'+esc(a.name)+'</td><td class="muted">'+esc(a.id)+'</td><td>'+(fresh?'<span class="pill on">متصل</span>':'<span class="pill off">منقطع</span>')+'</td><td class="muted">'+ago(a.lastSeenAt)+'</td></tr>';
  }).join('');
  document.getElementById('agents').innerHTML='<table><thead><tr><th>اسم الوكيل</th><th>المعرّف</th><th>الحالة</th><th>آخر ظهور</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4" class="muted">لا وكلاء</td></tr>')+'</tbody></table>';
}); }
function detail(id){ var email=(ACCT[id]||{}).email||''; api('/admin/api/account?userId='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
  var byId={}; (d.statuses||[]).forEach(function(s){byId[s.deviceId]=s;});
  var rows=(d.devices||[]).map(function(dv){var s=byId[dv.id]||{};
    return '<tr><td>'+esc(dv.name)+'</td><td class="muted">'+esc(dv.host)+'</td><td>'+esc(dv.firmware)+'</td><td>'+((s.state==='online')?'<span class="pill on">أونلاين</span>':'<span class="pill off">'+esc(s.state||'—')+'</span>')+'</td><td>'+(s.hashrateTHs?th(s.hashrateTHs)+' TH':'—')+'</td><td>'+(s.maxTempC?Math.round(s.maxTempC)+'°':'—')+'</td></tr>';
  }).join('');
  document.getElementById('detail').innerHTML='<h2>تفصيل: '+esc(email)+' ('+(d.sites||[]).length+' موقع · '+(d.devices||[]).length+' جهاز) <button class="btn sm" onclick="document.getElementById(\\'detail\\').innerHTML=\\'\\'">إغلاق ✕</button></h2><table><thead><tr><th>الجهاز</th><th>العنوان</th><th>الفرمور</th><th>الحالة</th><th>الهاش</th><th>الحرارة</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="muted">لا أجهزة</td></tr>')+'</tbody></table>';
  document.getElementById('detail').scrollIntoView({behavior:'smooth'});
}); }
function susp(id,s){ api('/admin/api/suspend',{method:'POST',body:JSON.stringify({userId:id,suspended:!!s})}).then(function(){accts();}); }
function del(id){ var email=(ACCT[id]||{}).email||''; if(!confirm('حذف الحساب «'+email+'» وكل بياناته نهائياً؟'))return; api('/admin/api/delete',{method:'POST',body:JSON.stringify({userId:id})}).then(function(){accts();}); }
if(TOKEN) start();
setInterval(function(){ if(TOKEN && !document.getElementById('dash').classList.contains('hide')){ ov(); accts(); agents(); } }, 30000);
</script></body></html>`;
