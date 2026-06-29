import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const INSTALLER = "installer.exe";

function landingHtml(hasInstaller: boolean): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مركز التحكم بالتعدين</title>
<style>body{font-family:Segoe UI,Tahoma,sans-serif;background:#0f1115;color:#e8eaed;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1b1d22;border:1px solid #2c2f36;border-radius:16px;padding:32px;max-width:460px;text-align:center}
h1{font-size:20px}a.btn{display:inline-block;margin-top:16px;background:#1d4ed8;color:#fff;
text-decoration:none;padding:12px 22px;border-radius:10px;font-size:16px}
.muted{color:#9aa0a8;font-size:13px;line-height:1.7;margin-top:14px}</style></head>
<body><div class="card"><h1>مركز التحكم بالتعدين</h1>
${
  hasInstaller
    ? `<p>حمّل البرنامج وثبّته على هذا الجهاز:</p><a class="btn" href="/download">⬇ تحميل البرنامج (ويندوز)</a>`
    : `<p class="muted">المثبّت لم يُرفع للسيرفر بعد.</p>`
}
<p class="muted">بعد التثبيت: افتح البرنامج، عنوان الخادم = هذا العنوان مع المنفذ، وسجّل دخول بحسابك.</p>
</div></body></html>`;
}

/** Serve the app installer + a landing page over the existing server. */
export function handleDownload(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
): boolean {
  if (req.method !== "GET") return false;
  const file = join(dataDir, INSTALLER);

  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(landingHtml(existsSync(file)));
    return true;
  }

  if (req.url === "/download") {
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("المثبّت لم يُرفع بعد");
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="MiningControlCenter-Setup.exe"',
      "content-length": String(statSync(file).size),
    });
    createReadStream(file).pipe(res);
    return true;
  }

  return false;
}
