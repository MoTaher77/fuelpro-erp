# VPS — تشغيل FuelPro على سيرفر حقيقي
آخر تحقق: 2026-11-24 (0.27.0). الملفات: `deploy/vps/`. القرار: ADR-26.
المطلوب: سيرفر **Ubuntu 22.04 / 24.04 أو Debian 12**، ذاكرة 1 GB على الأقل (2 GB أفضل)، قرص 20 GB، ودخول SSH بمستخدم له `sudo`.
يكفي سيرفر صغير (1–2 vCPU): البرنامج عملية Node واحدة وقاعدة SQLite واحدة.

## ما يجهزه سكربت التثبيت
| | |
|---|---|
| Node.js 22 | النسخة الرسمية من nodejs.org بعد التحقق من بصمتها SHA-256 |
| المستخدم `fuelpro` | البرنامج يعمل به، ولا يكتب إلا في `/var/lib/fuelpro` (قيود systemd) |
| الكود | `/opt/fuelpro` من GitHub بمفتاح نشر للقراءة فقط |
| البيانات | `/var/lib/fuelpro/fuelpro.db`، النسخ اليومية في `backups/` (يحتفظ بآخر 30)، والملفات الواردة في `incoming/` |
| الإعدادات والأسرار | `/etc/fuelpro/fuelpro.env` (صلاحية 640): `APP_SECRET` عشوائي، `REGISTRATION=first` |
| HTTPS | Caddy بشهادة Let's Encrypt تلقائية، والبرنامج يستمع على `127.0.0.1:3000` فقط |
| الجدار الناري | SSH و80 و443 فقط |
| تحديثات الأمان | `unattended-upgrades` |

## 0) الطريق الأسرع: أمران تلصقهما في طرفية السيرفر (من الهاتف أيضاً)
ادخل إلى السيرفر بمستخدم root، إما من «Console» في لوحة شركة الاستضافة، أو من تطبيق SSH على الهاتف مثل Termius.
**الأمر 1** — يجهّز git ويصنع مفتاح قراءة ويطبعه:
```
apt-get update -y && apt-get install -y git openssh-client && mkdir -p /root/.ssh && ([ -f /root/.ssh/fuelpro_deploy ] || ssh-keygen -q -t ed25519 -N "" -f /root/.ssh/fuelpro_deploy -C fuelpro-vps) && cat /root/.ssh/fuelpro_deploy.pub
```
انسخ السطر الذي يبدأ بـ`ssh-ed25519`، ثم في GitHub: المستودع ← Settings ← Deploy keys ← Add deploy key. الصق المفتاح **دون** تفعيل «Allow write access».
**الأمر 2** — يجلب الكود ويثبّت كل شيء:
```
export GIT_SSH_COMMAND="ssh -i /root/.ssh/fuelpro_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" && rm -rf /root/fuelpro-src && git clone -q git@github.com:MoTaher77/fuelpro-erp.git /root/fuelpro-src && cd /root/fuelpro-src && ([ -f deploy/vps/install.sh ] || git checkout -q claude/wonderful-pascal-jfuqxu) && bash deploy/vps/install.sh --branch "$(git rev-parse --abbrev-ref HEAD)"
```
بعده يكون البرنامج على `https://<IP-بشرطات>.sslip.io`، مثلاً `https://212-90-120-15.sslip.io`. أضف `--domain fuel.example.com` آخر الأمر إن كان لديك نطاق.
بعد التثبيت غيّر كلمة مرور root بالأمر `passwd`، خصوصاً إن كانت قد كُتبت في أي محادثة أو رسالة.

## 1) التثبيت (مرة واحدة)
1. **اسم النطاق (مستحسن):** أنشئ سجل DNS من نوع `A` يشير إلى IP السيرفر، مثلاً `fuel.example.com`. بدونه يستخدم السكربت `<ip>.sslip.io` (يعمل بـHTTPS، لكنه ليس اسماً تجارياً).
2. انسخ السكربت إلى السيرفر. المستودع خاص، فانسخه من اللابتوب:
   ```
   scp deploy\vps\install.sh ubuntu@<IP>:
   ```
3. على السيرفر:
   ```
   sudo bash install.sh --domain fuel.example.com --email you@example.com
   ```
   سيطبع السكربت **مفتاح نشر**. أضفه في GitHub: المستودع ← Settings ← Deploy keys ← Add deploy key، **دون** تفعيل «Allow write access»، ثم اضغط Enter.
4. افتح `https://fuel.example.com`.

## 2) البيانات: اختر واحداً
**أ) سيرفر جديد فارغ:** افتح العنوان وأنشئ المنشأة. يُسمح بأول منشأة فقط ثم يُغلق التسجيل (`REGISTRATION=first`). بعدها يضيف المالك المستخدمين من «المستخدمون».

**ب) نقل بيانات محطة التميز من اللابتوب:** هذا قرارك أنت كل مرة (CLAUDE.md §5).
1. على اللابتوب (PowerShell داخل `C:\Users\Moham\FuelPro`):
   ```
   powershell -ExecutionPolicy Bypass -File deploy\vps\laptop-send-data.ps1 -Server ubuntu@<IP>
   ```
   يصنع نسخة احتياطية جديدة ويرسلها مع `data\app-secret.txt` عبر SSH. لا يغيّر ولا يحذف شيئاً على اللابتوب.
2. على السيرفر (الأمر يطبعه السكربت السابق):
   ```
   sudo fuelpro-restore /var/lib/fuelpro/incoming/<file>.db --app-secret-file /var/lib/fuelpro/incoming/app-secret.txt
   ```
   يفحص الملف أولاً: سلامة SQLite، وتوازن القيود، والمخزون، وأرصدة العملاء والموردين. ثم يطلب كتابة `yes`، ويحتفظ بقاعدة السيرفر السابقة، ثم يشغّل ويفحص مرة أخرى.
3. **مهم:** من لحظة النقل يُدخل الجميع البيانات على السيرفر فقط، حتى من اللابتوب عبر المتصفح، وإلا صار عندك دفتران مختلفان. لا يوجد تزامن بين اللابتوب والسيرفر.

## 2ج) اسم نطاق خاص بدل sslip.io
1. اشترِ نطاقاً (مثل `fuelpro-ye.com`) من مسجّل نطاقات: Cloudflare أو Namecheap أو Porkbun، أو من لوحة Contabo نفسها.
2. في إعدادات DNS للنطاق أضف سجلاً: النوع `A` · الاسم `@` · القيمة IP السيرفر. وأضف `www` بنفس الطريقة إن أردته. في Cloudflare اختر «DNS only» (سحابة رمادية).
3. على السيرفر:
   ```
   sudo bash /opt/fuelpro/deploy/vps/domain.sh fuelpro-ye.com
   ```
   ابتداءً من التحديث التالي يصبح الأمر `sudo fuelpro-domain fuelpro-ye.com`.
   - يتأكد أولاً أن النطاق يشير إلى السيرفر. إن لم يكن كذلك لا يغيّر شيئاً، ويشرح ما ينقص.
   - ثم يصدر الشهادة ويغيّر العنوان.
   - العنوان القديم يبقى يعمل ويحوّل إلى الجديد.
   - بعد النقل يسجّل المستخدمون الدخول مرة واحدة على العنوان الجديد.

## 2د) مستخدم تجريبي بلا بيانات
منشأة منفصلة فارغة لها مالكها الخاص، ولا ترى شيئاً من بيانات المحطة. يعمل حتى مع إغلاق التسجيل:
```
sudo -u fuelpro node /opt/fuelpro/scripts/new-org.js --db /var/lib/fuelpro/fuelpro.db --email demo@example.com
```
يطبع البريد وكلمة مرور عشوائية مرة واحدة. خيارات أخرى: `--org` و`--name` و`--station` و`--currency` و`--tz`.

## 3) التحديث
بعد دمج أي تعديل في `main`:
```
sudo fuelpro-update
```
يعمل بالترتيب: نسخة احتياطية `pre-update` ← جلب الكود ← تشغيل كل الاختبارات على الكود الجديد ← إعادة التشغيل ← فحص الصحة ← فحص الدفاتر. إذا فشلت الاختبارات أو فحص الصحة يرجع تلقائياً إلى الكود السابق.

## 4) النسخ الاحتياطي
- **على السيرفر:** نسخة كل يوم تلقائياً + نسخة قبل كل تحديث، في `/var/lib/fuelpro/backups/`.
- **خارج السيرفر (ضروري):** على اللابتوب، شغّل يومياً (يمكن جدولته في Task Scheduler):
  ```
  powershell -ExecutionPolicy Bypass -File deploy\vps\laptop-pull-backups.ps1 -Server ubuntu@<IP>
  ```
  ينسخ أحدث نسخة إلى `%USERPROFILE%\FuelPro-VPS-backups`.
- احتفظ بقيمة `APP_SECRET` (في `/etc/fuelpro/fuelpro.env`) مع النسخ في مكان آمن: بدونها لا يمكن قراءة أسرار الدخول الثنائي.

## 5) أوامر مفيدة
| | |
|---|---|
| السجل المباشر | `journalctl -u fuelpro -f` |
| إعادة التشغيل | `sudo systemctl restart fuelpro` |
| الإعدادات (البريد SMTP، التسجيل) | `sudo nano /etc/fuelpro/fuelpro.env` ثم إعادة التشغيل |
| فحص الدفاتر | `sudo -u fuelpro node /opt/fuelpro/scripts/check-books.js /var/lib/fuelpro/fuelpro.db` |
| فحص شامل من اللابتوب | `node scripts/smoke-online.js https://fuel.example.com <email> <password>` |
| رابط استعادة كلمة المرور بدون SMTP | يظهر في `journalctl -u fuelpro` |

## الأمان
- البرنامج غير مكشوف مباشرة: Caddy فقط على 80 و443، والبرنامج على `127.0.0.1`.
- Caddy يحذف رأس `CF-Connecting-IP` القادم من الزائر، ويضع عنوانه الحقيقي في `X-Forwarded-For`، فلا يمكن تزوير العنوان للتحايل على قفل تسجيل الدخول.
- ملفات الكود للقراءة فقط بالنسبة للخدمة، ومفتاح GitHub للقراءة فقط.
- **مستحسن:** الدخول إلى SSH بمفتاح بدل كلمة المرور (`PasswordAuthentication no`)، وتفعيل الدخول الثنائي (2FA) لحساب المالك داخل FuelPro.

## ما تم التحقق منه هنا (2026-11-24)
- **تجربة تشغيل للسكربتات في حاوية Ubuntu 24.04** مع بدائل لـ`systemctl` و`ufw` و`caddy` و`apt`:
  - التثبيت: المستخدم والمجلدات والصلاحيات، ونسخ الكود، وملف الإعدادات، وملف Caddy، وتشغيل الخدمة وفحص الصحة.
  - النقل: الفحص قبل الاستبدال، والاحتفاظ بالقاعدة السابقة، وتعيين `APP_SECRET` ثم حذف ملفه، وإغلاق التسجيل بعد النقل.
  - التحديث: اختبارات ثم إعادة تشغيل، والرجوع عند الفشل.
- **فحص شامل** (`smoke-online.js`، 14/14) بنفس إعدادات السيرفر.
- **لم يُجرَّب هنا:** systemd الحقيقي، وإصدار شهادة Let's Encrypt (يحتاج نطاقاً حقيقياً)، والجدار الناري الحقيقي. هذه تتحقق عند أول تشغيل على سيرفرك.
