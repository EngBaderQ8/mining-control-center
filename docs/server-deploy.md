# دليل نشر الخادم على VPS (v2)

هذا الدليل يشرح كيف تشغّل خادم «مركز التحكم بالتعدين» على VPS، مع شهادة TLS ذاتية (بدون دومين).
الخادم خفيف (Node) ويخزّن بياناته في ملف SQLite محلي على الـ VPS.

---

## 1) جهّز الـ VPS
1. استأجر VPS صغيراً (1 vCPU / 1GB كافٍ) بنظام Ubuntu.
2. ادخل عبر SSH.
3. ثبّت Node.js 20+:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```

## 2) انسخ المشروع وثبّت الاعتماديات
```bash
git clone <عنوان-مستودعك> mining
cd mining
npm install
```

## 3) اختَر منفذاً ومفتاحاً سرياً
- المنفذ الافتراضي `8443`. افتحه في جدار الـ VPS:
  ```bash
  sudo ufw allow 8443/tcp
  ```
- ولّد مفتاحاً سرياً قوياً للـ JWT (لا تستخدم الافتراضي):
  ```bash
  export JWT_SECRET="$(openssl rand -hex 32)"
  ```

## 4) شغّل الخادم
تشغيل مباشر للتجربة:
```bash
PORT=8443 JWT_SECRET="$JWT_SECRET" npm run server:start
```
يطبع: `[server] listening on https://0.0.0.0:8443`. عند أول تشغيل يولّد شهادة ذاتية في `server/data/`.

## 5) شغّله دائماً (pm2)
```bash
sudo npm i -g pm2
PORT=8443 JWT_SECRET="$JWT_SECRET" pm2 start "npm run server:start" --name mining-server
pm2 save
pm2 startup   # نفّذ السطر الذي يطبعه ليبقى يعمل بعد إعادة التشغيل
```

## 6) بصمة الشهادة (للتثبيت في التطبيق)
بما أن الشهادة ذاتية (بلا دومين)، التطبيق سيثبّت **بصمتها** للتأكد أنه يتصل بخادمك أنت.
اطبع البصمة من الـ VPS:
```bash
openssl x509 -in server/data/cert.pem -noout -fingerprint -sha256
```
انسخ الناتج (مثل `SHA256 Fingerprint=AB:CD:...`) — ستُدخله في إعداد التطبيق عند الاتصال بالخادم
(عنوان الخادم = `IP-الـ VPS:8443`).

> ملاحظة: لو غيّرت/أعدت توليد الشهادة (حذف `server/data/cert.pem`)، تتغيّر البصمة وتحتاج تحديثها في الأجهزة.

## 7) النسخ الاحتياطي
بياناتك كلها في `server/data/app.db` — خذ نسخة احتياطية دورية له:
```bash
cp server/data/app.db ~/backup-app-$(date +%F).db
```

---

## استكشاف الأخطاء
- **التطبيق لا يتصل:** تأكد أن المنفذ مفتوح في جدار الـ VPS ومزوّد السحابة (Security Group).
- **خطأ شهادة:** تأكد أن البصمة المُدخلة في التطبيق تطابق ناتج الأمر في الخطوة 6.
- **نسيت المفتاح السري:** تغييره يُبطل جلسات الدخول الحالية (يحتاج المستخدمون تسجيل دخول جديد) — لا يحذف الحسابات.
