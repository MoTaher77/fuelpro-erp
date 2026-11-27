'use strict';
/* FuelPro web client. Plain JS, no build step.
 * Server stores money as integer minor units and volume as integer millilitres.
 * This file only converts for display / input, using exact decimal parsing (no floats for money). */
/* Number and date formatters are costly to create (tens of microseconds each, more on a phone) and used to be created for
   every amount on screen: a 12,000-line ledger made 36,000 of them. One formatter per locale + options, created once and reused.
   Same constructor, same arguments, so the text shown is exactly the same (and a bad locale still throws, for the callers' try/catch). */
window.FPFMT = (function () {
  var cache = new Map();
  function get(C, tag) { return function (locale, opts) { var k = tag + String(locale) + '|' + (opts ? JSON.stringify(opts) : ''); var f = cache.get(k); if (!f) { f = new C(locale, opts); cache.set(k, f); } return f; }; }
  return { nf: get(Intl.NumberFormat, 'n:'), dt: get(Intl.DateTimeFormat, 'd:') };
})();
(function () {
  /* ---------- translations: [ar, en, fr] ---------- */
  const D = {
    signIn: ['تسجيل الدخول', 'Sign in', 'Se connecter'], register: ['إنشاء حساب جديد', 'Create account', 'Créer un compte'], email: ['البريد الإلكتروني', 'Email', 'E-mail'],
    password: ['كلمة المرور (10 أحرف فأكثر)', 'Password (10+ characters)', 'Mot de passe (10 caractères min.)'], orgName: ['اسم الشركة', 'Company name', 'Nom de la société'], yourName: ['اسمك', 'Your name', 'Votre nom'],
    stationName: ['اسم المحطة', 'Station name', 'Nom de la station'], currency: ['العملة', 'Currency', 'Devise'], timezone: ['المنطقة الزمنية', 'Time zone', 'Fuseau horaire'],
    haveAcct: ['لدي حساب', 'I have an account', "J'ai un compte"], noAcct: ['حساب جديد', 'New account', 'Nouveau compte'], signOut: ['خروج', 'Sign out', 'Déconnexion'],
    dash: ['الرئيسية', 'Dashboard', 'Accueil'], sales: ['المبيعات', 'Sales', 'Ventes'], stock: ['الخزانات والتوريد', 'Tanks & deliveries', 'Cuves et livraisons'], exp: ['المصروفات', 'Expenses', 'Dépenses'],
    cust: ['العملاء والآجل', 'Customers & credit', 'Clients et crédit'], rep: ['التقارير', 'Reports', 'Rapports'], setup: ['الإعداد', 'Setup', 'Réglages'], audit: ['سجل التدقيق', 'Audit log', "Journal d'audit"],
    salesToday: ['مبيعات اليوم', 'Sales today', 'Ventes du jour'], volToday: ['الكمية المباعة اليوم', 'Volume sold today', "Volume vendu aujourd'hui"], volSold: ['الكمية المباعة', 'Volume sold', 'Volume vendu'], expToday: ['مصروفات اليوم', 'Expenses today', 'Dépenses du jour'],
    recv: ['ديون العملاء (آجل)', 'Customer credit owed', 'Crédit clients dû'], tanks: ['الخزانات', 'Tanks', 'Cuves'], last7: ['آخر 7 أيام (بالآلاف)', 'Last 7 days (thousands)', '7 derniers jours (milliers)'],
    low: ['مخزون منخفض', 'Low stock', 'Stock bas'], daysLeft: ['يكفي نحو {n} يوم', 'About {n} days left', 'Environ {n} jours restants'], of: ['من', 'of', 'sur'],
    'fe.fix': ['لم يُحفظ: صحّح الخانة المعلّمة بالأحمر ثم احفظ مرة أخرى.', 'Not saved: correct the field marked in red, then save again.', 'Non enregistré : corrigez le champ en rouge, puis enregistrez.'], 'fe.num': ['أدخل رقماً صحيحاً، مثل 1500 أو 12.5', 'Enter a valid number, e.g. 1500 or 12.5', 'Saisissez un nombre valide, ex. 1500 ou 12,5'], 'fe.req': ['هذه الخانة مطلوبة', 'This field is required', 'Ce champ est obligatoire'],
    'bn.shift': ['الوردية', 'Shift', 'Poste'], 'bn.dash': ['الرئيسية', 'Home', 'Accueil'], 'bn.sales': ['المبيعات', 'Sales', 'Ventes'], newSale: ['تسجيل عملية بيع', 'Record a sale', 'Enregistrer une vente'], pump: ['المضخة', 'Pump', 'Pompe'], prevMeter: ['القراءة السابقة ({u})', 'Previous reading ({u})', 'Index précédent ({u})'],
    closeMeter: ['القراءة الحالية ({u})', 'Current reading ({u})', 'Index actuel ({u})'], qtyOr: ['أو الكمية ({u})', 'Or quantity ({u})', 'Ou quantité ({u})'],
    payType: ['طريقة الدفع', 'Payment', 'Paiement'], cash: ['نقدي', 'Cash', 'Comptant'], credit: ['آجل', 'Credit', 'Crédit'], customer: ['العميل', 'Customer', 'Client'],
    save: ['حفظ', 'Save', 'Enregistrer'], saved: ['تم الحفظ', 'Saved', 'Enregistré'], add: ['إضافة', 'Add', 'Ajouter'], day: ['اليوم', 'Day', 'Jour'], date: ['التاريخ', 'Date', 'Date'], time: ['الوقت', 'Time', 'Heure'],
    fuel: ['الوقود', 'Fuel', 'Carburant'], qty: ['الكمية', 'Quantity', 'Quantité'], price: ['السعر/{u}', 'Price/{u}', 'Prix/{u}'], total: ['الإجمالي', 'Total', 'Total'], vat: ['الضريبة', 'VAT', 'TVA'],
    void: ['إلغاء', 'Void', 'Annuler'], voided: ['ملغاة', 'Voided', 'Annulée'], reason: ['السبب (3 أحرف على الأقل)', 'Reason (at least 3 characters)', 'Motif (3 caractères min.)'], confirm: ['تأكيد', 'Confirm', 'Confirmer'], cancel: ['تراجع', 'Cancel', 'Annuler'],
    close: ['إغلاق', 'Close', 'Fermer'], delivery: ['استلام وقود (توريد)', 'Receive fuel (delivery)', 'Réception de carburant'], tank: ['الخزان', 'Tank', 'Cuve'], costU: ['التكلفة/{u} (قبل الضريبة)', 'Cost/{u} (excl. VAT)', 'Coût/{u} (HT)'],
    supplier: ['المورد', 'Supplier', 'Fournisseur'], dip: ['جرد بالقياس اليدوي', 'Manual stock count', 'Inventaire par jaugeage'], measured: ['الكمية المقاسة ({u})', 'Measured quantity ({u})', 'Quantité mesurée ({u})'],
    note: ['ملاحظة', 'Note', 'Note'], noteReq: ['ملاحظة (3 أحرف على الأقل)', 'Note (at least 3 characters)', 'Note (3 caractères min.)'], recentDel: ['آخر عمليات التوريد', 'Latest deliveries', 'Dernières livraisons'],
    name: ['الاسم', 'Name', 'Nom'], phone: ['الهاتف', 'Phone', 'Téléphone'], balance: ['الرصيد', 'Balance', 'Solde'], amount: ['المبلغ', 'Amount', 'Montant'], addCust: ['إضافة عميل', 'Add customer', 'Ajouter un client'],
    pay: ['تسجيل دفعة', 'Record payment', 'Enregistrer un paiement'], stmt: ['كشف الحساب', 'Statement', 'Relevé'], debit: ['عليه', 'Charged', 'Débit'], creditCol: ['له (دفعة)', 'Paid', 'Crédit'], desc: ['البيان', 'Description', 'Libellé'],
    saleRow: ['بيع آجل — {f} {q}', 'Credit sale — {f} {q}', 'Vente à crédit — {f} {q}'], payRow: ['دفعة', 'Payment', 'Paiement'], totalDue: ['إجمالي المستحق', 'Total due', 'Total dû'],
    from: ['من', 'From', 'Du'], to: ['إلى', 'To', 'Au'], run: ['عرض', 'Run', 'Afficher'], net: ['الصافي', 'Net', 'HT'], margin: ['هامش الربح التقديري', 'Estimated gross margin', 'Marge brute estimée'],
    expenses: ['المصروفات', 'Expenses', 'Dépenses'], profit: ['صافي الربح التقديري', 'Estimated net profit', 'Résultat net estimé'], vatH: ['ضريبة القيمة المضافة', 'Value added tax', 'TVA'],
    vatOut: ['ضريبة المبيعات (محصّلة)', 'Output VAT (collected)', 'TVA collectée'], vatIn: ['ضريبة المشتريات والمصروفات', 'Input VAT (purchases & expenses)', 'TVA déductible'], vatDue: ['المستحق للسداد', 'VAT payable', 'TVA à payer'],
    byFuel: ['حسب نوع الوقود', 'By fuel', 'Par carburant'], byDay: ['حسب اليوم', 'By day', 'Par jour'], exportH: ['تصدير (CSV)', 'Export (CSV)', 'Exporter (CSV)'], csvSales: ['المبيعات', 'Sales', 'Ventes'], csvExp: ['المصروفات', 'Expenses', 'Dépenses'],
    fuels: ['أنواع الوقود والأسعار', 'Fuels & prices', 'Carburants et prix'], capacity: ['السعة ({u})', 'Capacity ({u})', 'Capacité ({u})'], level: ['الرصيد ({u})', 'Stock ({u})', 'Stock ({u})'], meter: ['قراءة العداد ({u})', 'Meter reading ({u})', 'Index ({u})'],
    sellPrice: ['سعر البيع/{u}', 'Selling price/{u}', 'Prix de vente/{u}'], pumps: ['المضخات', 'Pumps', 'Pompes'], station: ['إعدادات المحطة', 'Station settings', 'Réglages de la station'],
    vatRate: ['نسبة الضريبة %', 'VAT rate %', 'Taux de TVA %'], vatIncl: ['أسعار الوقود شاملة الضريبة', 'Fuel prices include VAT', 'Prix TTC (taxe incluse)'], allowNeg: ['السماح بالبيع بأكثر من رصيد الخزان', 'Allow selling beyond tank stock', 'Autoriser la vente au-delà du stock'],
    fixMeter: ['تصحيح قراءة عداد (للاستبدال أو العطل)', 'Correct a meter reading (replacement/fault)', 'Corriger un index (remplacement/panne)'],
    users: ['المستخدمون', 'Users', 'Utilisateurs'], role: ['الدور', 'Role', 'Rôle'], manager: ['مدير', 'Manager', 'Gérant'], cashier: ['كاشير', 'Cashier', 'Caissier'], owner: ['مالك', 'Owner', 'Propriétaire'], disable: ['تعطيل', 'Disable', 'Désactiver'], enable: ['تفعيل', 'Enable', 'Activer'],
    category: ['البند', 'Category', 'Catégorie'], vatPart: ['منها ضريبة (اختياري)', 'Of which VAT (optional)', 'Dont TVA (facultatif)'], month: ['الشهر', 'Month', 'Mois'],
    'cat.salaries': ['رواتب العمال', 'Staff salaries', 'Salaires'], 'cat.power': ['كهرباء ووقود المولد', 'Electricity & generator fuel', 'Électricité et groupe électrogène'], 'cat.maint': ['صيانة', 'Maintenance', 'Maintenance'],
    'cat.transport': ['نقل', 'Transport', 'Transport'], 'cat.rent': ['إيجار', 'Rent', 'Loyer'], 'cat.fees': ['رسوم وضرائب', 'Fees & taxes', 'Frais et taxes'], 'cat.other': ['أخرى', 'Other', 'Autre'],
    prefs: ['التفضيلات', 'Preferences', 'Préférences'], lang: ['اللغة', 'Language', 'Langue'], unit: ['وحدة الحجم', 'Volume unit', 'Unité de volume'], cal: ['التقويم (للعرض)', 'Calendar (display)', 'Calendrier (affichage)'], nums: ['الأرقام', 'Numerals', 'Chiffres'],
    greg: ['ميلادي', 'Gregorian', 'Grégorien'], hijri: ['هجري (أم القرى)', 'Hijri (Umm al-Qura)', 'Hégirien (Oumm al-Qura)'], latn: ['غربية (0-9)', 'Western (0-9)', 'Occidentaux (0-9)'], arab: ['هندية (٠-٩)', 'Arabic-Indic (٠-٩)', 'Arabo-indiens (٠-٩)'],
    uL: ['لتر', 'L', 'L'], uGalUS: ['جالون أمريكي', 'US gal', 'gal US'], uGalUK: ['جالون بريطاني', 'UK gal', 'gal UK'], nL: ['لتر', 'Litre', 'Litre'], nGalUS: ['جالون أمريكي', 'US gallon', 'Gallon US'], nGalUK: ['جالون بريطاني', 'Imperial gallon', 'Gallon impérial'],
    forgot: ['نسيت كلمة المرور؟', 'Forgot password?', 'Mot de passe oublié ?'], forgotT: ['استعادة كلمة المرور', 'Reset your password', 'Réinitialiser le mot de passe'],
    forgotHelp: ['أدخل بريدك وسنرسل لك رابطاً لاختيار كلمة مرور جديدة. الرابط صالح 30 دقيقة.', 'Enter your email and we will send a link to choose a new password. The link is valid for 30 minutes.', 'Saisissez votre e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe. Il est valable 30 minutes.'],
    sendLink: ['أرسل الرابط', 'Send link', 'Envoyer le lien'], backToLogin: ['العودة لتسجيل الدخول', 'Back to sign in', 'Retour à la connexion'],
    linkSent: ['إذا كان البريد مسجلاً لدينا فستصلك رسالة خلال دقائق. تحقق من مجلد الرسائل غير المرغوبة أيضاً.', 'If this email is registered, a message will arrive within minutes. Check your spam folder too.', "Si cette adresse est enregistrée, un message arrivera d'ici quelques minutes. Vérifiez aussi les indésirables."],
    newPwT: ['اختر كلمة مرور جديدة', 'Choose a new password', 'Choisissez un nouveau mot de passe'], confirmPw: ['تأكيد كلمة المرور', 'Confirm password', 'Confirmer le mot de passe'], pwMismatch: ['كلمتا المرور غير متطابقتين', 'The passwords do not match', 'Les mots de passe ne correspondent pas'],
    pwResetDone: ['تم تغيير كلمة المرور. سجّل الدخول بها الآن.', 'Password changed. Sign in with it now.', 'Mot de passe modifié. Connectez-vous maintenant.'],
    code2fa: ['رمز التحقق', 'Verification code', 'Code de vérification'], code2faHelp: ['افتح تطبيق المصادقة وأدخل الرمز المكوّن من 6 أرقام، أو أحد رموز الاسترداد.', 'Open your authenticator app and enter the 6-digit code, or one of your recovery codes.', "Ouvrez votre application d'authentification et saisissez le code à 6 chiffres, ou un code de récupération."],
    tfa: ['التحقق بخطوتين', 'Two-step verification', 'Validation en deux étapes'], tfaOn: ['مفعّل', 'On', 'Activée'], tfaOff: ['غير مفعّل', 'Off', 'Désactivée'],
    tfaWhy: ['يحمي حسابك حتى لو سُرقت كلمة المرور: يُطلب رمز من هاتفك عند كل تسجيل دخول.', 'Protects your account even if your password is stolen: a code from your phone is required at each sign-in.', 'Protège votre compte même si le mot de passe est volé : un code de votre téléphone est demandé à chaque connexion.'],
    tfaStart: ['تفعيل التحقق بخطوتين', 'Turn on two-step verification', 'Activer la validation en deux étapes'], tfaStop: ['إيقاف التحقق بخطوتين', 'Turn off', 'Désactiver'],
    tfaScan: ['امسح الرمز بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو غيرهما)، أو أدخل المفتاح يدوياً، ثم اكتب الرمز الظاهر في التطبيق.', 'Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, …) or type the key by hand, then enter the code the app shows.', "Scannez le code avec une application d'authentification (Google Authenticator, Microsoft Authenticator…) ou saisissez la clé à la main, puis entrez le code affiché."],
    tfaKey: ['المفتاح اليدوي', 'Manual key', 'Clé manuelle'], tfaConfirm: ['تأكيد وتفعيل', 'Confirm and turn on', 'Confirmer et activer'],
    tfaCodesT: ['رموز الاسترداد', 'Recovery codes', 'Codes de récupération'],
    tfaCodesHelp: ['احفظ هذه الرموز في مكان آمن خارج هاتفك. كل رمز يُستخدم مرة واحدة إذا فقدت الهاتف. لن تظهر مرة أخرى.', 'Keep these codes somewhere safe, away from your phone. Each one works once if you lose the phone. They will not be shown again.', "Conservez ces codes en lieu sûr, hors de votre téléphone. Chacun fonctionne une fois si vous perdez le téléphone. Ils ne seront plus affichés."],
    tfaLeft: ['رموز استرداد متبقية: {n}', 'Recovery codes left: {n}', 'Codes de récupération restants : {n}'], tfaNewCodes: ['رموز استرداد جديدة', 'New recovery codes', 'Nouveaux codes'],
    tfaNeed: ['أدخل كلمة المرور ورمز التحقق للمتابعة', 'Enter your password and a verification code to continue', 'Saisissez votre mot de passe et un code pour continuer'],
    copy: ['نسخ', 'Copy', 'Copier'], copied: ['تم النسخ', 'Copied', 'Copié'], done: ['تم', 'Done', 'Terminé'], reset2fa: ['إلغاء التحقق بخطوتين', 'Reset 2-step', 'Réinitialiser 2 étapes'],
    'err.TOTP_REQUIRED': ['أدخل رمز التحقق من تطبيق المصادقة', 'Enter the code from your authenticator app', "Saisissez le code de votre application d'authentification"],
    'err.BAD_TOTP': ['رمز التحقق غير صحيح أو مستخدم من قبل', 'The verification code is wrong or already used', 'Code incorrect ou déjà utilisé'],
    'err.RESET_INVALID': ['رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.', 'This reset link is invalid or has expired. Request a new one.', 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.'],
    'au.user.2fa.on': ['تفعيل التحقق بخطوتين', '2-step verification on', 'Validation 2 étapes activée'], 'au.user.2fa.off': ['إيقاف التحقق بخطوتين', '2-step verification off', 'Validation 2 étapes désactivée'],
    'au.user.2fa.codes': ['رموز استرداد جديدة', 'New recovery codes', 'Nouveaux codes de récupération'], 'au.user.2fa.recovery_used': ['دخول برمز استرداد', 'Signed in with a recovery code', 'Connexion par code de récupération'],
    'au.user.reset.request': ['طلب استعادة كلمة المرور', 'Password reset requested', 'Réinitialisation demandée'], 'au.user.reset.done': ['استعادة كلمة المرور', 'Password reset', 'Mot de passe réinitialisé'],
    'au.user.2fa.support_reset': ['إلغاء التحقق بخطوتين (دعم فني)', '2-step reset by support', 'Validation 2 étapes réinitialisée (support)'],
    account: ['حسابي', 'My account', 'Mon compte'], curPw: ['كلمة المرور الحالية', 'Current password', 'Mot de passe actuel'], newPw: ['كلمة المرور الجديدة', 'New password', 'Nouveau mot de passe'], changePw: ['تغيير كلمة المرور', 'Change password', 'Changer le mot de passe'],
    noCostWarn: ['تنبيه: {n} عملية بيع بلا تكلفة شراء مسجلة، لذا هامش الربح غير موثوق. سجّل تكلفة الوقود في الإعداد أو سجّل توريداً.', 'Warning: {n} sales have no purchase cost recorded, so the margin is not reliable. Set the fuel cost in Setup or record a delivery.', "Attention : {n} ventes sans coût d'achat; la marge n'est pas fiable. Renseignez le coût dans Réglages ou enregistrez une livraison."],
    noData: ['لا توجد بيانات', 'No data', 'Aucune donnée'], addFirst: ['أضف الخزانات والمضخات من تبويب الإعداد', 'Add tanks and pumps in Setup', 'Ajoutez cuves et pompes dans Réglages'], none: ['لا يوجد', 'None', 'Aucun'],
    'err.METER_MISMATCH': ['تغيّرت قراءة العداد. حُدّثت الصفحة، أعد المحاولة.', 'The meter changed. The page was refreshed; try again.', "L'index a changé. La page a été actualisée; réessayez."],
    'err.INSUFFICIENT_STOCK': ['الكمية أكبر من رصيد الخزان. سجّل التوريد أو الجرد أولاً.', 'Quantity exceeds tank stock. Record the delivery or a stock count first.', "La quantité dépasse le stock. Enregistrez d'abord la livraison ou un inventaire."],
    'err.METER_NOT_INCREASING': ['القراءة الحالية يجب أن تكون أكبر من السابقة', 'The current reading must be greater than the previous one', "L'index actuel doit être supérieur au précédent"],
    'err.PRICE_NOT_SET': ['حدّد سعر الوقود أولاً من الإعداد', 'Set the fuel price in Setup first', "Définissez d'abord le prix du carburant"],
    'err.OVERPAYMENT': ['الدفعة أكبر من رصيد العميل', 'The payment is larger than the balance', 'Le paiement dépasse le solde'], 'err.EXCEEDS_CAPACITY': ['الكمية تتجاوز سعة الخزان', 'The delivery exceeds the tank capacity', 'La livraison dépasse la capacité'],
    'err.BAD_CREDENTIALS': ['البريد أو كلمة المرور غير صحيحة', 'Email or password is incorrect', 'E-mail ou mot de passe incorrect'], 'err.TOO_MANY_ATTEMPTS': ['محاولات كثيرة. حاول لاحقاً.', 'Too many attempts. Try again later.', 'Trop de tentatives. Réessayez plus tard.'],
    'err.BAD_NUMBER': ['رقم غير صالح (تحقق من الخانات العشرية)', 'Invalid number (check the decimals)', 'Nombre invalide (vérifiez les décimales)'], 'err.STOCK_ALREADY_SOLD': ['بيع جزء من هذه الكمية. استخدم الجرد للتصحيح.', 'Part of this delivery was sold. Use a stock count to correct.', 'Une partie a déjà été vendue. Utilisez un inventaire.'],
    'err.WEAK_PASSWORD': ['كلمة المرور ضعيفة (10 أحرف على الأقل)', 'Password too weak (10+ characters)', 'Mot de passe trop faible (10 caractères min.)'], 'err.EMAIL_TAKEN': ['هذا البريد مسجّل مسبقاً', 'This email is already registered', 'Cet e-mail est déjà enregistré'],
    'err.FUTURE_DATE': ['التاريخ لا يمكن أن يكون في المستقبل', 'The date cannot be in the future', 'La date ne peut pas être dans le futur'], 'err.NETWORK': ['تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.', 'Cannot reach the server. Check the connection and try again.', 'Serveur injoignable. Vérifiez la connexion.'], 'err.NETWORK_SAVE': ['انقطع الاتصال أثناء الحفظ. تحقق من القائمة أن العملية لم تُحفظ قبل أن تعيدها.', 'The connection dropped while saving. Check the list that it was not saved before trying again.', 'Connexion perdue pendant l’enregistrement : vérifiez avant de recommencer.'],
    'err.FORBIDDEN': ['ليست لديك صلاحية لهذا الإجراء', 'You do not have permission', "Vous n'avez pas la permission"], 'err.REGISTRATION_CLOSED': ['إنشاء حساب جديد مغلق على هذا الخادم. اطلب من مالك المنشأة إضافتك مستخدماً.', 'New accounts cannot be created on this server. Ask the owner to add you as a user.', 'La création de compte est fermée sur ce serveur.'],
    'err.UNAUTHENTICATED': ['انتهت الجلسة. سجّل الدخول من جديد.', 'Session expired. Please sign in again.', 'Session expirée. Reconnectez-vous.'],
    'au.sale.create': ['تسجيل بيع', 'Sale recorded', 'Vente enregistrée'], 'au.sales.void': ['إلغاء بيع', 'Sale voided', 'Vente annulée'], 'au.delivery.create': ['توريد', 'Delivery received', 'Livraison reçue'], 'au.deliveries.void': ['إلغاء توريد', 'Delivery voided', 'Livraison annulée'],
    'au.employee.create': ['إضافة موظف', 'Employee added', 'Employé ajouté'], 'au.employee.update': ['تعديل موظف', 'Employee updated', 'Employé modifié'], 'au.employee.advance': ['سلفة موظف', 'Employee advance', 'Avance au salarié'],
    'au.employee.salary_pay': ['صرف راتب', 'Salary paid', 'Salaire payé'], 'au.employee_moves.void': ['إلغاء سلفة أو صرف راتب', 'Advance or salary payment voided', 'Avance ou paiement annulé'], 'au.payroll.post': ['ترحيل مسير الرواتب', 'Payroll posted', 'Paie comptabilisée'], 'au.payroll_runs.void': ['إلغاء مسير رواتب', 'Payroll voided', 'Paie annulée'], 'au.payroll.carry': ['نقل حسابات الموظفين القديمة', 'Old employee accounts carried over', 'Reprise des comptes'], 'au.payroll.carry_undo': ['تراجع عن نقل حسابات الموظفين', 'Carry-over undone', 'Reprise annulée'],
    'au.voucher.receipt': ['سند قبض', 'Receipt voucher', 'Bon de recette'], 'au.voucher.payment': ['سند صرف', 'Payment voucher', 'Bon de dépense'], 'au.voucher.void': ['إلغاء سند', 'Voucher voided', 'Bon annulé'],
    'au.cash_moves.void': ['إلغاء حركة صندوق', 'Cash movement voided', 'Mouvement de caisse annulé'], 'au.supplier_payments.void': ['إلغاء سداد مورد', 'Supplier payment voided', 'Paiement fournisseur annulé'], 'au.supplier.update': ['تعديل مورد', 'Supplier updated', 'Fournisseur modifié'],
    'au.account.create': ['إضافة حساب', 'Account added', 'Compte ajouté'], 'au.account.update': ['تعديل حساب', 'Account updated', 'Compte modifié'], 'au.journal.delete': ['حذف مسودة قيد', 'Draft journal deleted', 'Brouillon supprimé'],
    'au.bankrec.create': ['بدء مطابقة بنكية', 'Bank reconciliation started', 'Rapprochement commencé'], 'au.bankrec.finalize': ['اعتماد مطابقة بنكية', 'Bank reconciliation finalised', 'Rapprochement validé'], 'au.bankrec.reopen': ['إعادة فتح مطابقة بنكية', 'Bank reconciliation reopened', 'Rapprochement rouvert'], 'au.bankrec.delete': ['حذف مسودة مطابقة', 'Draft reconciliation deleted', 'Brouillon de rapprochement supprimé'],
    'au.brand.update': ['تعديل الترويسة', 'Letterhead updated', 'En-tête modifié'], 'au.currency.save': ['حفظ عملة', 'Currency saved', 'Devise enregistrée'], 'au.currency.rate': ['سعر صرف', 'Exchange rate set', 'Taux de change saisi'], 'au.fx.revalue': ['إعادة تقييم العملات', 'FX revaluation', 'Réévaluation des devises'],
    'au.asset.depreciate': ['ترحيل الإهلاك', 'Depreciation posted', 'Amortissement comptabilisé'], 'au.year.close': ['إقفال السنة', 'Year closed', 'Exercice clôturé'], 'au.year.reopen': ['إعادة فتح السنة', 'Year reopened', 'Exercice rouvert'],
    'au.expense.create': ['مصروف', 'Expense recorded', 'Dépense enregistrée'], 'au.expenses.void': ['إلغاء مصروف', 'Expense voided', 'Dépense annulée'], 'au.payment.create': ['دفعة', 'Payment recorded', 'Paiement enregistré'], 'au.payments.void': ['إلغاء دفعة', 'Payment voided', 'Paiement annulé'],
    'au.tank.adjust': ['جرد خزان', 'Stock count', 'Inventaire'], 'au.pump.meter': ['تصحيح عداد', 'Meter corrected', 'Index corrigé'], 'au.fuel.price': ['تغيير سعر', 'Price changed', 'Prix modifié'], 'au.station.update': ['تعديل إعدادات المحطة', 'Station settings changed', 'Réglages modifiés'],
    'au.user.create': ['إضافة مستخدم', 'User added', 'Utilisateur ajouté'], 'au.user.update': ['تعديل مستخدم', 'User updated', 'Utilisateur modifié'], 'au.user.password': ['تغيير كلمة مرور', 'Password changed', 'Mot de passe changé'],
    'au.tank.create': ['إضافة خزان', 'Tank added', 'Cuve ajoutée'], 'au.pump.create': ['إضافة مضخة', 'Pump added', 'Pompe ajoutée'], 'au.fuel.create': ['إضافة وقود', 'Fuel added', 'Carburant ajouté'], 'au.customer.create': ['إضافة عميل', 'Customer added', 'Client ajouté'],
    'au.station.create': ['إضافة محطة', 'Station added', 'Station ajoutée'], 'au.org.register': ['إنشاء الحساب', 'Account created', 'Compte créé']
  };
  Object.assign(D, window.FP_I18N || {});
  const LANGS = ['ar', 'en', 'fr'], CATS = ['salaries', 'power', 'maint', 'transport', 'rent', 'fees', 'other'];
  const CURS = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'YER', 'KWD', 'QAR', 'OMR', 'BHD', 'JOD', 'IQD', 'EGP', 'SYP', 'LBP', 'SDG', 'LYD', 'TND', 'DZD', 'MAD', 'TRY', 'KES', 'NGN', 'GHS', 'ZAR', 'INR', 'PKR', 'IDR', 'MYR'];
  const UNITS = { L: { ml: 1000, k: 'uL', n: 'nL' }, galUS: { ml: 3785.411784, k: 'uGalUS', n: 'nGalUS' }, galUK: { ml: 4546.09, k: 'uGalUK', n: 'nGalUK' } };

  /* ---------- preferences (per browser) ---------- */
  const PALETTES = ['royal', 'emerald', 'bordeaux', 'onyx'];   // luxury colour sets (app.css, data-palette)
  const P = (() => {
    let o = {}; try { o = JSON.parse(localStorage.getItem('prefs') || '{}'); } catch {}
    const nav = (navigator.language || 'en').slice(0, 2);
    return { lang: LANGS.includes(o.lang) ? o.lang : (LANGS.includes(nav) ? nav : 'en'), unit: UNITS[o.unit] ? o.unit : 'L', cal: o.cal === 'islamic-umalqura' ? o.cal : 'gregory', nums: o.nums === 'arab' ? 'arab' : 'latn', theme: ['light', 'dark'].includes(o.theme) ? o.theme : 'system', palette: PALETTES.includes(o.palette) ? o.palette : 'royal' };
  })();
  const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(P)); } catch {} };
  const li = () => LANGS.indexOf(P.lang);
  const T = (k, v) => { const e = D[k]; let s = e ? (e[li()] || e[1]) : k; if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]); return s; };
  const U = () => UNITS[P.unit];
  const uLbl = () => T(U().k);

  /* ---------- exact decimal <-> integers ---------- */
  function parseDec(str, scale) {
    let s = String(str == null ? '' : str).trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٬\s  ]/g, '').replace('٫', '.');
    if (s.includes(',') && !s.includes('.')) s = /^\d{1,3}(,\d{3})+$/.test(s) && P.lang !== 'fr' ? s.replace(/,/g, '') : s.replace(',', '.'); else s = s.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [i, f = ''] = s.split('.'); if (f.length > scale) return null;
    const n = BigInt(i + f.padEnd(scale, '0'));
    return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
  }
  const S = { user: null, stations: [], sid: null, st: null, tab: 'dash', fuels: [], tanks: [], pumps: [], customers: [], salesDate: null, expMonth: null, stmt: null };
  const dec = () => S.st.cur_dec;
  const base = () => P.lang;
  const nfmt = (max) => FPFMT.nf(base() + '-u-nu-' + P.nums, { maximumFractionDigits: max });
  const ddec = () => (S.st.disp_dec ?? S.st.cur_dec);   // digits shown (amounts may be stored more precisely)
  /* amounts are shown as plain figures (the currency is in the column head / the station's base currency), like a printed ledger */
  const money = (v) => { const d = dec(), dd = Math.min(ddec(), d); try { return FPFMT.nf(base() + '-u-nu-' + P.nums, { minimumFractionDigits: dd, maximumFractionDigits: dd }).format(v / Math.pow(10, d)); } catch { return String(v / Math.pow(10, d)); } };
  const volNum = (ml, max = 2) => nfmt(max).format(ml / U().ml);
  const vol = (ml, max = 2) => volNum(ml, max) + ' ' + uLbl();
  const volMl = (str) => { const n = parseDec(str, 3); return n == null ? null : Math.round(n * U().ml / 1000); };           // thousandths of the display unit -> ml
  const priceE4 = (str) => { const n = parseDec(str, dec() + 4); return n == null ? null : Math.round(n * 1000 / U().ml); };       // per display unit -> per litre
  const priceShow = (e4) => nfmt(Math.min(ddec(), dec()) + 2).format(e4 * (U().ml / 1000) / Math.pow(10, dec() + 4));
  const priceInput = (e4) => (e4 * (U().ml / 1000) / Math.pow(10, dec() + 4)).toFixed(dec() + 2).replace(/0+$/, '').replace(/\.$/, '');
  const dtf = (o) => { try { return FPFMT.dt(base() + '-u-ca-' + P.cal + '-nu-' + P.nums, { timeZone: 'UTC', ...o }); } catch { return FPFMT.dt('en', { timeZone: 'UTC', ...o }); } };
  const fdate = (d) => dtf({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T12:00:00Z'));
  const fdt = (utc) => { try { return FPFMT.dt(base() + '-u-ca-' + P.cal + '-nu-' + P.nums, { timeZone: S.st.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(utc.replace(' ', 'T') + 'Z')); } catch { return utc; } };
  const ftime = (utc) => { try { return FPFMT.dt(base() + '-u-nu-' + P.nums, { timeZone: S.st.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(utc.replace(' ', 'T') + 'Z')); } catch { return utc; } };
  const todayIso = () => FPFMT.dt('en-CA', { timeZone: S.st.timezone }).format(new Date());

  /* ---------- tiny DOM helpers ---------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    /* style through the CSSOM: the page's Content-Security-Policy (style-src 'self') blocks style="" attributes, so those were silently dropped */
    for (const k in (attrs || {})) { const v = attrs[k]; if (k === 'class') e.className = v; else if (k === 'style') { if (v) e.style.cssText = v; } else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const field = (label, input) => h('div', null, h('label', { for: input.id }, label), input);
  const sel = (id, opts, cur) => h('select', { id }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) }, l)));
  const toast = (m, kind) => { const t = document.getElementById('toast'); t.replaceChildren(h('span', { class: kind || '' }, m)); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4500); };
  const table = (heads, rows) => h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, heads.map(x => h('th', null, x)))), h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, c)))))));
  const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* numbers roll up to their value (integers in minor units / ml, so no float drift in what is finally shown) */
  function countUp(el, to, fmt, ms = 950) {
    if (calm() || !to) { el.textContent = fmt(to); return el; }
    const t0 = performance.now(); el.textContent = fmt(0);
    const step = (t) => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(p < 1 ? Math.round(to * e) : to); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); return el;
  }
  const statN = (k, n, fmt) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), countUp(h('div', { class: 'v' }), n, fmt));
  const sec = (title, ...c) => h('section', { class: 'card' }, title && h('h2', null, title), ...c);

  /* ---------- API ---------- */
  /* A phone that wakes up, a Wi-Fi switch or a server restart drops the connection for a moment and fetch() fails with
     "Failed to fetch". Reads are retried quietly (3 times, ~4 s in all); a save is never re-sent by itself (it may have reached
     the server), the user gets a clear message instead. */
  const NET_RETRY = [400, 1200, 2500];
  const netError = (save) => { const err = new Error(T(save ? 'err.NETWORK_SAVE' : 'err.NETWORK')); err.code = 'NETWORK'; return err; };
  async function api(method, path, body) {
    const read = method === 'GET';
    let res;
    for (let i = 0; ; i++) {
      try { res = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch { if (read && i < NET_RETRY.length) { await new Promise(r => setTimeout(r, NET_RETRY[i])); continue; } throw netError(!read); }
      if ([502, 503, 504].includes(res.status)) {   // the proxy answered but FuelPro is restarting (an update)
        if (read && i < NET_RETRY.length) { await new Promise(r => setTimeout(r, NET_RETRY[i])); continue; }
        throw netError(!read);
      }
      break;
    }
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!res.ok) { const e = (json && json.error) || { code: 'ERR', message: res.statusText }; const err = new Error(D['err.' + e.code] ? T('err.' + e.code) : e.message); err.code = e.code; err.details = e.details; throw err; }
    return json;
  }
  const sp = (p) => `/api/stations/${S.sid}${p}`;
  /* A second tap on «save» while the first save is still on its way used to post the document twice (vouchers, payments, expenses
     have no client id like sales do). For submit and click events the same handler now ignores re-entry until the first call ends,
     and the buttons involved are greyed out meanwhile. Other events (a select's change, typing) are not held back. */
  const guard = (fn) => { let busy = false; return async (...a) => {
    const ev = a[0], hold = !!ev && (ev.type === 'submit' || ev.type === 'click');
    if (hold && busy) { if (ev.preventDefault) ev.preventDefault(); return; }
    const btns = hold ? (ev.type === 'submit' && ev.target && ev.target.querySelectorAll ? [...ev.target.querySelectorAll('button[type=submit], button:not([type])')] : ev.currentTarget && ev.currentTarget.tagName === 'BUTTON' ? [ev.currentTarget] : []).filter(b => !b.disabled) : [];
    if (hold) { busy = true; btns.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); }); }
    let ok = false; const place = hold ? placeOf(ev) : null;   // read now: the event's currentTarget is gone after the first await
    try { if (place) clearFormError(place); await fn(...a); ok = true; }
    catch (e) { if (e.code === 'UNAUTHENTICATED') { toast(e.message, 'err'); S.user = null; authScreen(); } else if (!(place && showFormError(place, btns[0], e))) toast(e.message, 'err'); }
    finally { if (hold) { busy = false; btns.forEach(b => { b.disabled = false; b.removeAttribute('aria-busy'); if (ok && b.isConnected) { b.classList.remove('saved'); void b.offsetWidth; b.classList.add('saved'); setTimeout(() => b.classList.remove('saved'), 1300); } }); } }
  }; };
  /* 0.30: errors are shown where they happened — under the field that is wrong, and in a box beside the button — instead of only a toast */
  const looksNumeric = (i) => /^(decimal|numeric)$/.test(i.getAttribute('inputmode') || '') || i.type === 'number';
  function fieldError(input, msg) {
    input.setAttribute('aria-invalid', 'true');
    const box = input.parentElement; if (!box) return;
    let fe = box.querySelector(':scope > .fe'); if (!fe) { fe = h('div', { class: 'fe', role: 'alert', id: (input.id || 'f' + Math.random().toString(36).slice(2, 8)) + '-err' }); input.after(fe); }
    fe.textContent = msg; input.setAttribute('aria-describedby', fe.id);
  }
  function clearField(input) { input.removeAttribute('aria-invalid'); const fe = input.parentElement && input.parentElement.querySelector(':scope > .fe'); if (fe) fe.remove(); }
  const placeOf = (ev) => { const t = ev && (ev.type === 'submit' ? ev.target : ev.currentTarget); return t && t.closest ? (t.tagName === 'FORM' ? t : t.closest('form, .modal .card, .card')) : null; };
  function clearFormError(box) { box.querySelectorAll(':scope .form-err').forEach(x => x.remove()); box.querySelectorAll('[aria-invalid=true]').forEach(clearField); }
  function showFormError(box, btn, e) {
    if (!box.isConnected) return false;
    const inputs = [...box.querySelectorAll('input, select, textarea')].filter(i => i.offsetParent !== null && !i.disabled && i.type !== 'hidden');
    let first = null;
    if (num.lastBad != null) for (const i of inputs) if (i.value === num.lastBad) { fieldError(i, e.message); first = first || i; }
    for (const i of inputs) if (i.required && !String(i.value).trim()) { fieldError(i, T('fe.req')); first = first || i; }
    for (const i of inputs) if (looksNumeric(i) && String(i.value).trim() && parseDec(i.value, 6) == null && i.getAttribute('aria-invalid') !== 'true') { fieldError(i, T('fe.num')); first = first || i; }
    num.lastBad = null;
    const msg = h('div', { class: 'form-err', role: 'alert' }, first ? T('fe.fix') : e.message);   // the exact reason is already under the field
    const row = btn && btn.closest && btn.closest('.row'); if (row && box.contains(row)) row.before(msg); else box.append(msg);
    if (first) first.focus({ preventScroll: false });
    return true;
  }
  /* a number box says at once when what was typed is not a number */
  document.addEventListener('change', (e) => { const i = e.target; if (!(i instanceof HTMLInputElement) || !looksNumeric(i)) return;
    if (String(i.value).trim() && parseDec(i.value, 6) == null) fieldError(i, T('fe.num')); else if (i.getAttribute('aria-invalid') === 'true') clearField(i); });
  document.addEventListener('input', (e) => { const i = e.target; if (i && i.getAttribute && i.getAttribute('aria-invalid') === 'true' && (!looksNumeric(i) || !String(i.value).trim() || parseDec(i.value, 6) != null)) clearField(i);
    const fe = i && i.closest && i.closest('form, .card'); if (fe) fe.querySelectorAll(':scope .form-err').forEach(x => x.remove()); });
  const can = (...roles) => S.user && roles.includes(S.user.role);
  const cd = (...ps) => !!S.perms && (S.perms.includes('*') || ps.some(p => S.perms.includes(p)));   // server-provided permissions (the server enforces them again)
  const mgr = () => cd('config.edit');
  const num = (v, fn, err = 'err.BAD_NUMBER') => { const r = fn(v); if (r == null) { num.lastBad = String(v); throw new Error(T(err)); } return r; };   // lastBad: the form error box marks that field

  async function loadBase() {
    const me = await api('GET', '/api/me'); S.user = me.user; S.stations = me.stations; S.perms = me.perms || [];
    if (!S.sid || !S.stations.find(s => s.id === S.sid)) S.sid = S.stations[0] && S.stations[0].id;
    S.st = S.stations.find(s => s.id === S.sid);
    [S.fuels, S.tanks, S.pumps, S.customers] = await Promise.all([api('GET', sp('/fuels')), api('GET', sp('/tanks')), api('GET', sp('/pumps')), api('GET', sp('/customers'))]);
    S.salesDate = S.salesDate || todayIso(); S.expMonth = S.expMonth || todayIso().slice(0, 7);
    if (window.FP && window.FP.loadBrand) window.FP.loadBrand();
  }

  /* ---------- shell ---------- */
  const root = document.getElementById('root');
  function applyPrefs() {
    const r = document.documentElement; r.lang = P.lang; r.dir = P.lang === 'ar' ? 'rtl' : 'ltr';
    if (P.theme === 'system') delete r.dataset.theme; else r.dataset.theme = P.theme;
    r.dataset.palette = P.palette;
    const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = getComputedStyle(r).getPropertyValue('--side1').trim() || tc.content;
    savePrefs();
  }
  const isDark = () => P.theme === 'dark' || (P.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  function modal(title, body, { closable = true } = {}) {
    const m = h('div', { class: 'modal', onclick: (e) => { if (closable && e.target === m) m.remove(); } }, h('div', { class: 'card' }, h('h2', null, title), body, closable && h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => m.remove() }, T('close')))));
    document.body.append(m); return m;
  }
  function askReason(cb) {
    const input = h('input', { id: 'reasonIn', placeholder: T('reason') });
    const m = h('div', { class: 'modal' }, h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); if (input.value.trim().length < 3) return toast(T('reason')); m.remove(); cb(input.value.trim()); } },
      h('h2', null, T('void')), input, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('confirm')), h('button', { class: 'btn ghost', type: 'button', onclick: () => m.remove() }, T('cancel')))));
    document.body.append(m); input.focus();
  }
  function prefsDialog() {
    const lang = sel('pLang', [['ar', 'العربية'], ['en', 'English'], ['fr', 'Français']], P.lang), unit = sel('pUnit', Object.entries(UNITS).map(([k, v]) => [k, T(v.n)]), P.unit),
      cal = sel('pCal', [['gregory', T('greg')], ['islamic-umalqura', T('hijri')]], P.cal), nums = sel('pNums', [['latn', T('latn')], ['arab', T('arab')]], P.nums), theme = sel('pTheme', [['system', T('thSystem')], ['light', T('thLight')], ['dark', T('thDark')]], P.theme);
    /* palette: preview live while choosing; Save keeps it, closing restores the previous one */
    let pal = P.palette; const was = P.palette;
    const sws = PALETTES.map(k => h('button', { type: 'button', class: 'swatch', 'aria-pressed': String(k === pal), onclick: () => { pal = k; document.documentElement.dataset.palette = k; sws.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === k))); } }, h('i', { class: k }), T('pal.' + k)));
    sws.forEach((b, i) => { b.dataset.p = PALETTES[i]; });
    const m = modal(T('prefs'), h('form', { onsubmit: (e) => { e.preventDefault(); P.lang = lang.value; P.unit = unit.value; P.cal = cal.value; P.nums = nums.value; P.theme = theme.value; P.palette = pal; applyPrefs(); m.remove(); S.user ? render() : authScreen(); } },
      h('div', null, h('label', null, T('palette')), h('div', { class: 'swatches' }, sws)),
      h('div', { class: 'grid', style: 'margin-top:14px' }, field(T('lang'), lang), field(T('unit'), unit), field(T('cal'), cal), field(T('nums'), nums), field(T('theme'), theme)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    const mo = new MutationObserver(() => { if (m.isConnected) return; mo.disconnect(); if (P.palette === was) document.documentElement.dataset.palette = P.palette; }); mo.observe(document.body, { childList: true });
  }
  const copyBtn = (text) => h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast(T('copied')); } catch { toast(text); } } }, T('copy'));
  const otpInput = (id) => h('input', { id, class: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 11, spellcheck: 'false' });
  function showCodes(codes) {
    const m = modal(T('tfaCodesT'), h('div', null, h('p', { class: 'note' }, T('tfaCodesHelp')), h('div', { class: 'codes' }, codes.map(c => h('div', { class: 'key' }, c))),
      h('div', { class: 'row' }, copyBtn(codes.join('\n')), h('button', { class: 'btn', type: 'button', onclick: () => { m.remove(); accountDialog(); } }, T('done')))), { closable: false });
  }
  async function tfaSetup(pw) {
    const r = await api('POST', '/api/auth/2fa/setup', { password: pw });
    const code = otpInput('tfaCode'); let qr; try { qr = QR.svg(r.uri, 220); } catch { qr = null; }
    const m = modal(T('tfaStart'), h('form', { onsubmit: guard(async (e) => { e.preventDefault(); const out = await api('POST', '/api/auth/2fa/enable', { code: code.value.trim() }); m.remove(); S.user.totp = true; showCodes(out.recovery_codes); }) },
      h('p', { class: 'hint' }, T('tfaScan')), qr && h('div', { class: 'qr' }, qr),
      h('label', null, T('tfaKey')), h('div', { class: 'row' }, h('div', { class: 'key' }, r.secret.replace(/(.{4})/g, '$1 ').trim()), copyBtn(r.secret)),
      field(T('code2fa'), code), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('tfaConfirm')))));
    code.focus();
  }
  async function accountDialog() {
    let me; try { me = (await api('GET', '/api/me')).user; S.user = { ...S.user, ...me }; } catch (e) { return toast(e.message); }
    const cur = h('input', { id: 'acCur', type: 'password', autocomplete: 'current-password' }), nw = h('input', { id: 'acNew', type: 'password', autocomplete: 'new-password' });
    const tp = h('input', { id: 'tfaPw', type: 'password', autocomplete: 'current-password' }), tc = otpInput('tfaOff');
    const tfa = me.totp
      ? h('form', { class: 'subsec', onsubmit: (e) => e.preventDefault() },
          h('h3', null, T('tfa'), ' ', h('span', { class: 'pill ok-pill' }, T('tfaOn'))), h('p', { class: 'hint' }, T('tfaLeft', { n: me.recovery_left })), h('p', { class: 'hint' }, T('tfaNeed')),
          h('div', { class: 'grid' }, field(T('password'), tp), field(T('code2fa'), tc)),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', type: 'button', onclick: guard(async () => { const r = await api('POST', '/api/auth/2fa/recovery-codes', { password: tp.value, code: tc.value.trim() }); m.remove(); showCodes(r.recovery_codes); }) }, T('tfaNewCodes')),
            h('button', { class: 'btn ghost', type: 'button', onclick: guard(async () => { await api('POST', '/api/auth/2fa/disable', { password: tp.value, code: tc.value.trim() }); S.user.totp = false; m.remove(); toast(T('saved')); }) }, T('tfaStop'))))
      : h('form', { class: 'subsec', onsubmit: guard(async (e) => { e.preventDefault(); const pw = tp.value; await tfaSetup(pw); m.remove(); }) },
          h('h3', null, T('tfa'), ' ', h('span', { class: 'pill' }, T('tfaOff'))), h('p', { class: 'hint' }, T('tfaWhy')),
          field(T('password'), tp), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('tfaStart'))));
    const m = modal(T('account'), h('div', null,
      h('form', { onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/auth/change-password', { current: cur.value, new: nw.value }); m.remove(); toast(T('saved')); }) },
        h('p', { class: 'hint' }, me.email), h('div', { class: 'grid' }, field(T('curPw'), cur), field(T('newPw'), nw)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('changePw')))),
      tfa));
  }
  const prefsBtn = () => h('button', { class: 'btn ghost sm', type: 'button', onclick: prefsDialog }, T('prefs'));

  function authScreen(mode = 'login', opts = {}) {
    applyPrefs(); const f = {}; const reg = mode === 'register';
    const shell = (...c) => root.replaceChildren(h('div', { class: 'authbg', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('div', { class: 'auth' }, h('div', { class: 'logo' }, h('div', { class: 'mark' }, icon('sales', 34)), h('h1', null, 'FuelPro'), h('p', null, T('tagline'))), ...c));
    const back = () => h('button', { class: 'linkbtn', type: 'button', onclick: () => authScreen() }, T('backToLogin'));
    if (mode === 'forgot') {
      const em = h('input', { id: 'fgEmail', type: 'email', autocomplete: 'username', value: opts.email || '' });
      const form = h('form', { class: 'card', onsubmit: guard(async (e) => {
        e.preventDefault(); await api('POST', '/api/auth/forgot', { email: em.value.trim(), lang: P.lang });
        form.replaceChildren(h('h2', null, T('forgotT')), h('p', { class: 'note' }, T('linkSent')), h('div', { class: 'row' }, back()));
      }) }, h('h2', null, T('forgotT')), h('p', { class: 'hint' }, T('forgotHelp')), field(T('email'), em), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('sendLink')), back()));
      shell(form); return em.focus();
    }
    if (mode === 'reset') {
      const a = h('input', { id: 'rsPw', type: 'password', autocomplete: 'new-password' }), b = h('input', { id: 'rsPw2', type: 'password', autocomplete: 'new-password' });
      const form = h('form', { class: 'card', onsubmit: guard(async (e) => {
        e.preventDefault(); if (a.value !== b.value) throw new Error(T('pwMismatch'));
        try { await api('POST', '/api/auth/reset', { token: opts.token, password: a.value }); }
        catch (err) { if (err.code === 'RESET_INVALID') { authScreen('forgot'); } throw err; }
        authScreen('login', { notice: T('pwResetDone') });
      }) }, h('h2', null, T('newPwT')), h('div', { class: 'grid' }, field(T('newPw'), a), field(T('confirmPw'), b)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')), back()));
      shell(form); return a.focus();
    }
    const mk = (id, type = 'text', val = '') => (f[id] = h('input', { id, type, value: val, autocomplete: type === 'password' ? (reg ? 'new-password' : 'current-password') : type === 'email' ? 'username' : 'off' }));
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
    let regBtn = null;
    /* a server with REGISTRATION=first|closed says so on /api/health: then «create an account» is not offered on the sign-in page */
    if (!reg) fetch('/api/health').then(r => r.json()).then(j => { if (j && j.register === false && regBtn) regBtn.remove(); }).catch(() => {});
    const codeBox = h('div', { hidden: true }, field(T('code2fa'), (f.code = otpInput('loginCode'))), h('p', { class: 'hint' }, T('code2faHelp')));
    const form = h('form', { class: 'card', onsubmit: guard(async (e) => {
      e.preventDefault();
      if (reg) await api('POST', '/api/auth/register', { org_name: f.org.value, name: f.nm.value, email: f.em.value, password: f.pw.value, station: { name: f.st.value || f.org.value, currency: f.cur.value, timezone: f.tz.value } });
      else {
        try { await api('POST', '/api/auth/login', { email: f.em.value, password: f.pw.value, ...(codeBox.hidden ? {} : { code: f.code.value.trim() }) }); }
        catch (err) { if (err.code === 'TOTP_REQUIRED') { codeBox.hidden = false; f.code.focus(); } if (err.code === 'BAD_TOTP') { f.code.value = ''; f.code.focus(); } throw err; }
      }
      await loadBase(); S.tab = 'dash'; render();
    }) }, h('h2', null, reg ? T('register') : T('signIn')), opts.notice && h('p', { class: 'note' }, opts.notice),
      h('div', { class: 'grid' }, reg && field(T('orgName'), mk('org')), reg && field(T('yourName'), mk('nm')), reg && field(T('stationName'), mk('st')), reg && field(T('currency'), (f.cur = sel('cur', CURS.map(c => [c, c]), 'USD'))), reg && field(T('timezone'), mk('tz', 'text', tz)), field(T('email'), mk('em', 'email')), field(T('password'), mk('pw', 'password'))),
      !reg && codeBox,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, reg ? T('register') : T('signIn')), (regBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => authScreen(reg ? 'login' : 'register') }, reg ? T('haveAcct') : T('noAcct'))), prefsBtn()),
      !reg && h('p', { class: 'hint' }, h('button', { class: 'linkbtn', type: 'button', onclick: () => authScreen('forgot', { email: f.em.value }) }, T('forgot'))));
    shell(form);
  }

  /* ---------- navigation ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const PATHS = {
    dash: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z', sales: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M6 8h6M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3',
    shift: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', stock: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    inv: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3zM5 6c0 1.7 3.1 3 7 3s7-1.3 7-3M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
    cust: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', supp: 'M3 21V9l6 4V9l6 4V5h6v16zM7 17h2M13 17h2M17 17h2',
    exp: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4', acct: 'M4 4h11a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3zM4 18a3 3 0 0 1 3-3h11M8 8h6',
    ana: 'M4 20V10M10 20V4M16 20v-7M22 20H2', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0', bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18', fin: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8', rep: 'M3 3v18h18M7 15l4-4 3 3 5-6', vch: 'M4 5h16v14H4zM4 9h16M8 13h4M8 16h6M16 13h1', prc: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01', cnt: 'M9 3h6v3H9zM6 5h12v16H6zM9 11l2 2 4-4M9 17h6', cur: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.8 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2', fa: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6', sreg: 'M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2zM8 8h8M8 12h8M8 16h5', pur: 'M3 4h2l2.4 11h11l2-8H6.3M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', stm: 'M7 3h10l4 4v14H7zM17 3v4h4M10 11h7M10 15h7M3 7v14h4', mtr: 'M12 21a9 9 0 1 1 9-9M12 12l4-4M7 12h1M12 7v1M17 17l3 3',
    setup: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
    users: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 16a4 4 0 0 1 8 0', audit: 'M9 6h12M9 12h12M9 18h12M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
    day: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M8 16h6', col: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', box: 'M3 7h18v12H3zM3 11h18M7 15h3M16 4l-4 3-4-3', jbook: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6', yc: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
    emp: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8', menu: 'M3 6h18M3 12h18M3 18h18', chev: 'M6 9l6 6 6-6', xls: 'M4 4h16v16H4zM4 9h16M9 9v11M8 13l3 4M11 13l-3 4', theme: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
  };
  const icon = (k, size = 20) => { const v = document.createElementNS(NS, 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', size); v.setAttribute('height', size); v.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', PATHS[k] || PATHS.menu); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); v.append(p); return v; };
  const NAV = [
    ['gOps', [['dash', ['read']], ['ana', ['report.read']], ['sales', ['sale.create']], ['shift', ['shift.open', 'shift.approve']], ['day', ['report.read']], ['sreg', ['report.read']], ['mtr', ['report.read']]]],
    ['gStock', [['inv', ['read']], ['stock', ['delivery.create', 'adjust.create', 'report.read']], ['pur', ['report.read']], ['cnt', ['report.read']], ['prc', ['read']]]],
    ['gParties', [['cust', ['read']], ['col', ['report.read']], ['supp', ['supplier.manage', 'supplier.pay', 'report.read']], ['emp', ['payroll.manage', 'payroll.pay', 'report.read']]]],
    ['gFinance', [['exp', ['expense.create']], ['vch', ['journal.read']], ['box', ['report.read']], ['bank', ['report.read']], ['stm', ['report.read']], ['acct', ['journal.read']], ['jbook', ['journal.read']], ['cur', ['report.read']], ['fa', ['report.read']], ['fin', ['report.read']], ['rep', ['report.read']], ['yc', ['period.lock']]]],
    ['gAdmin', [['setup', ['config.edit', 'users.manage']], ['users', ['users.manage']], ['audit', ['audit.read']]]]
  ];
  const allowedTabs = () => NAV.flatMap(([, items]) => items.filter(([k, ps]) => VIEWS[k] && cd(...ps)).map(([k]) => k));
  const closeMenu = () => { document.querySelector('.side')?.classList.remove('open'); document.querySelector('.scrim')?.classList.remove('open'); };
  /* 0.30: menu groups fold (remembered on this device); the group of the open screen always shows */
  let navShut; try { navShut = new Set(JSON.parse(localStorage.getItem('navShut') || '[]')); } catch { navShut = new Set(); }
  function navGroup(g, ks, link) {
    if (!ks.length) return null;
    const open = !navShut.has(g) || ks.includes(S.tab);
    const gi = h('div', { class: 'gi' + (open ? '' : ' shut'), id: 'gi-' + g }, h('div', null, ks.map(link)));
    const btn = h('button', { type: 'button', class: 'grp', 'aria-expanded': String(open), 'aria-controls': 'gi-' + g, onclick: () => {
      const shut = gi.classList.toggle('shut'); btn.setAttribute('aria-expanded', String(!shut)); if (shut) navShut.add(g); else navShut.delete(g);
      try { localStorage.setItem('navShut', JSON.stringify([...navShut])); } catch { /* private mode */ } } }, h('span', null, T(g)), icon('chev', 14));
    return [btn, gi];
  }
  const signOut = guard(async () => { await api('POST', '/api/auth/logout'); S.user = null; authScreen(); });
  async function render() {
    applyPrefs(); const main = h('main', { id: 'main' });
    const sideTop = document.querySelector('.side')?.scrollTop || 0;      // keep the menu where it was when a screen is opened
    const tabs = allowedTabs(); if (!tabs.includes(S.tab)) S.tab = tabs[0] || 'dash';
    if (location.hash !== '#' + S.tab) history.replaceState(null, '', '#' + S.tab);
    const link = (k) => h('a', { href: '#' + k, 'aria-current': S.tab === k ? 'page' : null, onclick: closeMenu }, icon(k), h('span', null, T(k)));
    const side = h('aside', { class: 'side', 'aria-label': T('menu') },
      h('div', { class: 'brand' }, h('div', { class: 'mark' }, icon('sales', 22)), h('div', null, 'FuelPro', h('small', null, T('tagline2')))),
      NAV.map(([g, items]) => navGroup(g, items.map(([k]) => k).filter(k => tabs.includes(k)), link)));
    const scrim = h('div', { class: 'scrim', onclick: closeMenu });
    const openMenu = () => { side.classList.add('open'); scrim.classList.add('open'); };
    /* every table on the screen -> one .xlsx workbook, one sheet per table, named after its heading */
    const exportScreen = () => {
      document.querySelectorAll('#main [data-expand]').forEach(b => b.click());   // long lists shown in parts: put every row on screen first
      const X = window.FPXLSX, tables = [...document.querySelectorAll('#main table')].filter(t => t.rows.length > 1 && t.offsetParent !== null);
      if (!X || !tables.length) { toast(T('xlsxNone')); return; }
      const sheets = tables.map((t, i) => { const box = t.closest('.an-card, section, .sec, .card, .modal') || document.getElementById('main');
        const head = box.querySelector('h2, h3'); const { rows, header } = X.tableRows(t);
        return { name: (head ? head.innerText.split(String.fromCharCode(10))[0] : T(S.tab)) || 'Sheet' + (i + 1), rows, header, rtl: P.lang === 'ar' }; });
      const bytes = X.build({ sheets, title: T(S.tab) });
      const a2 = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: `${T(S.tab)} ${todayIso()}.xlsx` });
      document.body.append(a2); a2.click(); setTimeout(() => { URL.revokeObjectURL(a2.href); a2.remove(); }, 1000); };
    const top = h('div', { class: 'top' },
      h('button', { class: 'iconbtn menubtn', 'aria-label': T('menu'), onclick: openMenu }, icon('menu')),
      h('h1', null, T(S.tab), h('span', { class: 'muted small' }, ' · ', S.st ? S.st.name : '')),
      h('div', { class: 'tools' },
        S.stations.length > 1 && h('select', { id: 'stSel', class: 'compact', 'aria-label': T('station'), onchange: guard(async (e) => { S.sid = +e.target.value; await loadBase(); render(); }) }, S.stations.map(s => h('option', { value: s.id, selected: s.id === S.sid }, s.name))),
        cd('report.read') ? h('button', { id: 'bell', class: 'iconbtn bell', 'aria-label': T('alerts'), title: T('alerts'), onclick: () => window.FP.showAlerts && window.FP.showAlerts() }, icon('bell'), h('span', { id: 'bellN', class: 'bell-n' })) : null,
        h('button', { class: 'btn ghost sm xl', title: T('xlsxHelp'), onclick: exportScreen }, '⇩ Excel'),
        h('button', { class: 'iconbtn theme', 'aria-label': T('theme'), title: T('theme'), onclick: toggleTheme }, icon('theme')),
        h('button', { class: 'btn ghost sm wide', onclick: prefsDialog }, T('prefs')),
        h('button', { class: 'btn ghost sm wide', onclick: accountDialog }, S.user.name),
        h('button', { class: 'iconbtn out', 'aria-label': T('signOut'), title: T('signOut'), onclick: signOut }, icon('out'))));
    const bottom = h('nav', { class: 'bottom', 'aria-label': T('menu') }, ['dash', 'sales', 'shift'].filter(k => tabs.includes(k)).map(k => h('a', { href: '#' + k, 'aria-current': S.tab === k ? 'page' : null, title: T(k) }, icon(k, 22), D['bn.' + k] ? T('bn.' + k) : T(k))),   // short names: one line each
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); openMenu(); } }, icon('menu', 22), T('more')));
    side.append(h('div', { class: 'grp' }, T('account')), h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeMenu(); accountDialog(); } }, icon('users'), h('span', null, S.user.name)), h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeMenu(); prefsDialog(); } }, icon('setup'), h('span', null, T('prefs'))),
      /* on the phone these leave the crowded top bar and live here (app.css: .ph-only) */
      h('a', { href: '#', class: 'ph-only', onclick: (e) => { e.preventDefault(); closeMenu(); exportScreen(); } }, icon('xls'), h('span', null, 'Excel')),
      h('a', { href: '#', class: 'ph-only', onclick: (e) => { e.preventDefault(); toggleTheme(); } }, icon('theme'), h('span', null, T('theme'))),
      h('a', { href: '#', class: 'ph-only', onclick: (e) => { e.preventDefault(); closeMenu(); signOut(); } }, icon('out'), h('span', null, T('signOut'))));
    const skel = h('main', { class: 'skel', 'aria-busy': 'true' }, h('div', { class: 'sk h1' }), h('div', { class: 'row4' }, h('div', { class: 'sk' }), h('div', { class: 'sk' }), h('div', { class: 'sk' }), h('div', { class: 'sk' })), h('div', { class: 'sk big' }));
    root.replaceChildren(h('div', { class: 'layout' }, side, h('div', { class: 'content' }, top, skel)), scrim, bottom);
    side.scrollTop = sideTop;
    try { await VIEWS[S.tab](main); } catch (e) { toast(e.message); }
    if (!skel.isConnected) return;                        // another navigation replaced this screen meanwhile
    skel.replaceWith(main); animateIn(main);
    if (window.FP && window.FP.bellRefresh) window.FP.bellRefresh();
  }
  /* entrance: sections rise one after another; liquids and gauges fill once visible */
  function animateIn(el) {
    [...el.children].forEach((c, i) => { c.classList.add('reveal'); c.style.setProperty('--i', Math.min(i, 8)); });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('[data-h]').forEach(e => { e.style.height = e.dataset.h + '%'; });
      el.querySelectorAll('[data-w]').forEach(e => { e.style.width = e.dataset.w + '%'; });
    }));
  }
  function toggleTheme() {
    const flip = () => { P.theme = isDark() ? 'light' : 'dark'; applyPrefs(); };
    if (document.startViewTransition && !calm()) return document.startViewTransition(flip);
    document.documentElement.classList.add('theme-fade'); flip(); setTimeout(() => document.documentElement.classList.remove('theme-fade'), 600);
  }
  const tankViz = (t) => {
    const pct = t.capacity_ml ? Math.round(t.level_ml * 1000 / t.capacity_ml) / 10 : 0, dsl = /ديزل|diesel|gasoil|gazole|سولار/i.test(t.fuel_name || '');
    const low = t.min_ml > 0 ? t.level_ml <= t.min_ml : pct < 20;
    return h('div', { class: 'tankbox' },
      h('div', { class: 'tankviz' + (dsl ? ' dsl' : '') + (low ? ' low' : ''), role: 'img', 'aria-label': `${t.name} ${pct}%` }, h('div', { class: 'liquid', 'data-h': Math.min(100, pct) }), h('div', { class: 'shine' }), h('div', { class: 'pct' }, nfmt(0).format(pct) + '%')),
      h('b', null, t.name), h('div', { class: 'muted' }, t.fuel_name, ' · ', vol(t.level_ml, 0)), h('div', { class: 'muted' }, T('of'), ' ', vol(t.capacity_ml, 0)),
      t.days_left != null ? h('div', { class: 'muted' }, T('daysLeft', { n: nfmt(1).format(t.days_left) })) : null, low ? h('span', { class: 'low-pill' }, T('low')) : null);
  };
  const refresh = async () => { await loadBase(); render(); };

  /* ---------- views ---------- */
  const VIEWS = {
    async dash(main) {
      const [d, recent, cur] = await Promise.all([api('GET', sp('/dashboard')), api('GET', sp(`/sales?date=${todayIso()}&limit=6`)), api('GET', sp('/shifts/current')).catch(() => ({ shift: null }))]);
      const hr = +FPFMT.dt('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: S.st.timezone }).format(new Date());
      const go = (k) => () => { location.hash = '#' + k; };
      const big = countUp(h('div', { class: 'big' }), d.sales.gross, money);
      main.append(h('section', { class: 'hero' },
        h('div', { class: 'hero-grid' },
          h('div', null, h('div', { class: 'hello' }, T(hr < 12 ? 'goodMorning' : 'goodEvening'), '، ', S.user.name), h('h2', null, S.st.name),
            h('div', { class: 'sub' }, dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(todayIso() + 'T12:00:00Z')), ' ',
              cur.shift ? h('span', { class: 'live' }, h('i'), T('liveShift', { n: cur.shift.id })) : null)),
          h('div', null, h('div', { class: 'hello' }, T('salesToday')), big, h('div', { class: 'sub' }, T('txCount', { n: nfmt(0).format(d.sales.n) }), ' · ', vol(d.sales.qty, 0)))),
        h('div', { class: 'actions' }, cd('sale.create') ? h('button', { class: 'btn gold', onclick: go('sales') }, T('newSaleBtn')) : null,
          cd('shift.open', 'shift.approve') ? h('button', { class: 'btn ghost', onclick: go('shift') }, T('shift')) : null,
          cd('report.read') ? h('button', { class: 'btn ghost', onclick: go('fin') }, T('fin')) : null)));
      const kpi = (ic, k, n, fmt, gold) => h('div', { class: 'kpi' + (gold ? ' g' : '') }, h('div', { class: 'ic' }, icon(ic, 24)), h('div', null, h('div', { class: 'k' }, k), countUp(h('div', { class: 'v' }), n, fmt)));
      main.append(h('div', { class: 'kpis' }, kpi('sales', T('salesToday'), d.sales.gross, money), kpi('inv', T('volToday'), d.sales.qty, (v) => vol(v, 0)),
        kpi('exp', T('expToday'), d.expenses, money, true), kpi('cust', T('recv'), d.receivables, money, true)));
      const max = Math.max(1, ...d.series.map(x => x.gross)), series = P.lang === 'ar' ? d.series.slice().reverse() : d.series;
      main.append(h('div', { class: 'grid2' },
        sec(T('tanks'), d.tanks.length ? h('div', { class: 'tanks' }, d.tanks.map(tankViz)) : h('p', { class: 'muted' }, T('addFirst'))),
        sec(T('last7'), h('div', { class: 'bars' }, series.map(x => { const i = h('i'); i.style.height = Math.max(1.5, Math.round(x.gross * 100 / max)) + '%';
          return h('div', { class: x.date === d.today ? 'today' : null, 'data-tip': `${fdate(x.date)} · ${money(x.gross)} · ${vol(x.qty_ml, 0)}` }, h('b', null, x.gross ? nfmt(1).format(x.gross / Math.pow(10, dec()) / 1000) : ''), i, h('span', null, dtf({ day: 'numeric', month: 'numeric' }).format(new Date(x.date + 'T12:00:00Z')))); })))));
      if (recent.length) main.append(sec(T('recentSales'), h('div', { class: 'feed' }, recent.map((s, i) => { const it = h('div', { class: 'it' }, h('div', { class: 'dot ' + s.pay_type }, icon('sales', 18)),
        h('div', { class: 'grow' }, h('b', null, s.pump_name, ' · ', s.fuel_name), h('div', { class: 'muted small' }, ftime(s.created_at), ' · ', vol(s.quantity_ml, 0), s.customer_name ? ' · ' + s.customer_name : '')),
        s.voided_at ? h('span', { class: 'struck' }, money(s.gross)) : h('span', { class: 'amt' }, money(s.gross))); it.style.setProperty('--i', i); return it; }))));
    },
    async sales(main) {
      if (!S.pumps.length) return main.append(sec(null, h('p', { class: 'muted' }, T('addFirst'))));
      const pump = h('select', { id: 'sPump' }, S.pumps.map(p => h('option', { value: p.id }, `${p.name} — ${p.fuel_name}`)));
      const open = h('input', { id: 'sOpen', readonly: true }), close = h('input', { id: 'sClose', inputmode: 'decimal' }), qty = h('input', { id: 'sQty', inputmode: 'decimal' }), preview = h('div', { class: 'hint', id: 'sPrev' });
      const type = sel('sType', [['cash', T('cash')], ['credit', T('credit')]], 'cash'), cust = h('select', { id: 'sCust' }, S.customers.map(c => h('option', { value: c.id }, c.name))); const custW = field(T('customer'), cust); custW.hidden = true;
      const disc = h('input', { id: 'sDisc', inputmode: 'decimal', placeholder: T('discHint') }); const discW = cd('sale.discount') ? field(T('discount'), disc) : null;
      const discOf = (amount) => { const v = disc.value.trim(); if (!v || !discW) return {}; if (/%$/.test(v)) { const p = Number(v.slice(0, -1).replace(',', '.')); return p > 0 ? { discount_bp: Math.round(p * 100), off: Math.round(amount * p / 100) } : {}; } const m = parseDec(v, dec()); return m > 0 ? { discount: m, off: m } : {}; };
      const cur = () => S.pumps.find(x => x.id === +pump.value);
      const sync = () => { open.value = priceFree(cur().meter_ml); upd(); };
      const upd = () => { const f = S.fuels.find(x => x.id === cur().fuel_id); let ml = null; if (close.value.trim()) { const c = volMl(close.value); ml = c == null ? null : c - cur().meter_ml; } else if (qty.value.trim()) ml = volMl(qty.value); const amt = ml > 0 && f && f.price_e4 ? Math.round(ml * f.price_e4 / 1e7) : 0, d = amt ? discOf(amt) : {};
        preview.textContent = amt ? `${vol(ml, 3)} × ${priceShow(f.price_e4)} ≈ ${money(amt)}` + (d.off ? ` − ${T('discount')} ${money(d.off)} = ${money(amt - d.off)}` : '') : ''; };
      pump.onchange = () => { close.value = ''; qty.value = ''; sync(); }; type.onchange = () => (custW.hidden = type.value !== 'credit'); close.oninput = () => { qty.value = ''; upd(); }; qty.oninput = () => { close.value = ''; upd(); }; disc.oninput = () => upd();
      let cid = crypto.randomUUID();
      const form = h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => {
        e.preventDefault(); const p = cur();
        const body = { client_id: cid, pump_id: p.id, expected_open_ml: p.meter_ml, pay_type: type.value, ...(type.value === 'credit' ? { customer_id: +cust.value } : {}) };
        if (S.salesDate !== todayIso()) body.date = S.salesDate;
        if (close.value.trim()) body.close_ml = num(close.value, volMl); else body.quantity_ml = num(qty.value, volMl);
        { const d = discOf(1); if (d.discount) body.discount = d.discount; if (d.discount_bp) body.discount_bp = d.discount_bp; }
        try { await api('POST', sp('/sales'), body); } catch (er) { if (er.code === 'METER_MISMATCH') await loadBase(); throw er; }
        cid = crypto.randomUUID(); disc.value = ''; toast(T('saved')); await refresh();
      }) }, h('h2', null, T('newSale')), h('div', { class: 'grid' }, field(T('pump'), pump), field(T('prevMeter', { u: uLbl() }), open), field(T('closeMeter', { u: uLbl() }), close), field(T('qtyOr', { u: uLbl() }), qty), field(T('payType'), type), custW, discW), preview, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))));
      const list = sec(null); main.append(form, list); sync(); await salesList(list);
    },
    async stock(main) {
      const tl = (t) => `${t.name} — ${t.fuel_name}`; const tankSel = (id) => sel(id, S.tanks.map(t => [t.id, tl(t)]));
      const dT = tankSel('dTank'), dQ = h('input', { id: 'dQty', inputmode: 'decimal' }), dC = h('input', { id: 'dCost', inputmode: 'decimal' }), dV = h('input', { id: 'dVat', inputmode: 'decimal' }), dS = h('input', { id: 'dSup' }), dP = sel('dPay', [['bank', T('mBank')], ['cash', T('mCash')], ['credit', T('mCredit')]]);
      const sups = cd('supplier.manage', 'supplier.pay', 'report.read') ? await api('GET', sp('/suppliers')) : []; const dSup = sel('dSupId', [['', '—'], ...sups.map(x => [x.id, x.name])]);
      const gT = tankSel('gTank'), gL = h('input', { id: 'gLevel', inputmode: 'decimal' }), gN = h('input', { id: 'gNote' });
      const dels = await api('GET', sp('/deliveries?limit=15'));
      main.append(sec(T('tanks'), table([T('tank'), T('fuel'), T('level', { u: uLbl() }), T('capacity', { u: uLbl() })], S.tanks.map(t => [t.name, t.fuel_name, volNum(t.level_ml, 1), volNum(t.capacity_ml, 0)]))),
        S.tanks.length && cd('delivery.create', 'adjust.create') ? h('div', { class: 'grid2' },
          h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); const b = { tank_id: +dT.value, quantity_ml: num(dQ.value, volMl), cost_e4: num(dC.value, priceE4), pay_type: dP.value, ...(dSup.value ? { supplier_id: +dSup.value } : { supplier: dS.value || undefined }) }; if (dV.value.trim()) b.vat = num(dV.value, (v) => parseDec(v, dec())); await api('POST', sp('/deliveries'), b); toast(T('saved')); await refresh(); }) },
            h('h2', null, T('delivery')), h('div', { class: 'grid' }, field(T('tank'), dT), field(T('qty') + ` (${uLbl()})`, dQ), field(T('costU', { u: uLbl() }), dC), S.st.vat_bp > 0 && field(T('vatPart'), dV), field(T('payType'), dP), sups.length ? field(T('supp'), dSup) : field(T('supplier'), dS)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))),
          h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/adjustments'), { tank_id: +gT.value, after_ml: num(gL.value, volMl), note: gN.value }); toast(T('saved')); await refresh(); }) },
            h('h2', null, T('dip')), h('div', { class: 'grid' }, field(T('tank'), gT), field(T('measured', { u: uLbl() }), gL), field(T('noteReq'), gN)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))))) : null,
        sec(T('recentDel'), dels.length ? table([T('date'), T('tank'), T('qty') + ` (${uLbl()})`, T('costU', { u: uLbl() }), T('net'), T('supplier'), ''], dels.map(x => [fdate(x.business_date), x.tank_name, volNum(x.quantity_ml), priceShow(x.cost_e4), x.voided_at ? h('span', { class: 'muted' }, T('voided')) : money(x.net), x.supplier || '',
          !x.voided_at && cd('delivery.void') ? voidBtn(() => `/deliveries/${x.id}/void`) : ''])) : h('p', { class: 'muted' }, T('noData'))));
    },
    async exp(main) {
      const [y, mo] = S.expMonth.split('-').map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const rows = await api('GET', sp(`/expenses?from=${S.expMonth}-01&to=${S.expMonth}-${String(last).padStart(2, '0')}&limit=200`));
      const dt = h('input', { id: 'eDate', type: 'date', value: todayIso(), max: todayIso() }), cat = sel('eCat', CATS.map(c => [c, T('cat.' + c)])), amt = h('input', { id: 'eAmt', inputmode: 'decimal' }), vat = h('input', { id: 'eVat', inputmode: 'decimal' }), nt = h('input', { id: 'eNote' }), em = sel('eMethod', [['cash', T('mCash')], ['bank', T('mBank')]]);
      const month = h('input', { id: 'eMonth', type: 'month', value: S.expMonth, onchange: (e) => { if (e.target.value) { S.expMonth = e.target.value; render(); } } });
      const live = rows.filter(r => !r.voided_at);
      main.append(h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); const b = { date: dt.value, category: cat.value, gross: num(amt.value, (v) => parseDec(v, dec())), note: nt.value || undefined, method: em.value }; if (vat.value.trim()) b.vat = num(vat.value, (v) => parseDec(v, dec())); await api('POST', sp('/expenses'), b); S.expMonth = dt.value.slice(0, 7); toast(T('saved')); await refresh(); }) },
        h('h2', null, T('exp')), h('div', { class: 'grid' }, field(T('date'), dt), field(T('category'), cat), field(T('amount'), amt), S.st.vat_bp > 0 && field(T('vatPart'), vat), field(T('method'), em), field(T('note'), nt)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))),
        sec(null, h('div', { class: 'row' }, field(T('month'), month), h('span', { class: 'chip' }, T('total'), ': ', h('b', null, money(live.reduce((a, r) => a + r.gross, 0))))),
          rows.length ? table([T('date'), T('category'), T('note'), T('vat'), T('amount'), ''], rows.map(r => [fdate(r.business_date), D['cat.' + r.category] ? T('cat.' + r.category) : r.category, r.note || '', money(r.vat), r.voided_at ? h('span', { class: 'muted' }, T('voided')) : h('b', null, money(r.gross)), !r.voided_at && cd('expense.void') ? voidBtn(() => `/expenses/${r.id}/void`) : ''])) : h('p', { class: 'muted' }, T('noData'))));
    },
    async cust(main) {
      const nm = h('input', { id: 'cName' }), ph = h('input', { id: 'cPhone', inputmode: 'tel' }), cl = h('input', { id: 'cLimit', inputmode: 'decimal' }), ct = h('input', { id: 'cTerms', inputmode: 'numeric', value: '30' }), co = h('input', { id: 'cOpen', inputmode: 'decimal' }), pm = sel('pMethod', [['cash', T('mCash')], ['bank', T('mBank')]]), pc = sel('pCust', S.customers.map(c => [c.id, c.name])), pa = h('input', { id: 'pAmt', inputmode: 'decimal' });
      if (S.stmt && S.customers.find(c => c.id === S.stmt) && F_STMT && await F_STMT(main, 'customer')) return;
      const stm = '';   // the old inline statement is shown by F_STMT now ('' appends nothing; null used to print «null»)
      main.append(S.customers.length && window.FP.partyList ? window.FP.partyList('customer', S.customers, (id) => { S.stmt = id; render(); }) : sec(T('cust'), h('p', { class: 'muted' }, T('noData'))),
        stm && sec(T('stmt') + ': ' + stm.customer.name, table([T('date'), T('desc'), T('debit'), T('creditCol'), T('balance'), ''], stm.entries.map(e => [fdate(e.date), e.kind === 'opening' ? T('openingBal') : e.kind === 'sale' ? T('saleRow', { f: e.fuel_name, q: vol(e.quantity_ml) }) : e.kind === 'journal' ? T('src.' + e.source) + (e.ref_no ? ' ' + e.ref_no : '') + (e.note ? ' — ' + e.note : '') : T('payRow') + (e.note ? ' — ' + e.note : ''), e.debit ? money(e.debit) : '', e.credit ? money(e.credit) : '',
          e.voided ? h('span', { class: 'muted' }, T('voided')) : h('b', null, money(e.balance)), e.kind === 'payment' && !e.voided && cd('payment.void') ? voidBtn(() => `/payments/${e.id}/void`) : ''])), h('div', { class: 'row' }, h('b', null, T('totalDue'), ': ', money(stm.balance)), h('button', { class: 'btn ghost sm', onclick: (ev) => printNode(T('stmt') + ': ' + stm.customer.name, ev.target.closest('section')) }, T('print')), h('button', { class: 'btn ghost sm', onclick: () => { S.stmt = null; render(); } }, T('close')))),
        h('div', { class: 'grid2' }, h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/customers'), { name: nm.value, phone: ph.value || undefined, ...(cl.value.trim() ? { credit_limit: num(cl.value, (v) => parseDec(v, dec())) } : {}), terms_days: +ct.value || 0, ...(co.value.trim() ? { opening_balance: num(co.value, (v) => parseDec(v, dec())) } : {}) }); await refresh(); }) }, h('h2', null, T('addCust')), h('div', { class: 'grid' }, field(T('name'), nm), field(T('phone'), ph), cd('customer.edit') && field(T('creditLimit'), cl), field(T('termsDays'), ct), cd('customer.edit') && field(T('openingBal'), co)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('add')))),
          S.customers.length ? h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/payments'), { customer_id: +pc.value, amount: num(pa.value, (v) => parseDec(v, dec())), method: pm.value }); toast(T('saved')); await refresh(); }) }, h('h2', null, T('pay')), h('div', { class: 'grid' }, field(T('customer'), pc), field(T('amount'), pa), field(T('method'), pm)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))) : null));
    },
    async rep(main) {
      const t = todayIso(), from = h('input', { id: 'rFrom', type: 'date', value: S.repFrom || t.slice(0, 8) + '01' }), to = h('input', { id: 'rTo', type: 'date', value: S.repTo || t }), out = h('div', { class: 'stack' });
      const run = guard(async () => {
        S.repFrom = from.value; S.repTo = to.value; const r = await api('GET', sp(`/summary?from=${from.value}&to=${to.value}`));
        out.replaceChildren(h('div', { class: 'grid' }, stat(T('sales'), money(r.totals.gross)), stat(T('volSold'), vol(r.totals.qty_ml, 0)), stat(T('net'), money(r.totals.net)), stat(T('margin'), money(r.gross_margin)), stat(T('expenses'), money(r.expenses)), stat(T('profit'), money(r.net_profit))),
          r.rows_without_cost > 0 ? h('div', { class: 'note' }, T('noCostWarn', { n: r.rows_without_cost })) : '',
          sec(T('vatH'), h('div', { class: 'grid' }, stat(T('vatOut'), money(r.vat.output)), stat(T('vatIn'), money(r.vat.input)), stat(T('vatDue'), money(r.vat.payable)))),
          h('div', { class: 'grid2' }, sec(T('byFuel'), table([T('fuel'), T('qty') + ` (${uLbl()})`, T('total'), T('margin')], Object.entries(r.by_fuel).map(([id, x]) => [(S.fuels.find(f => f.id === +id) || {}).name || id, volNum(x.qty_ml), money(x.gross), money(x.net - x.cogs)]))),
            sec(T('byDay'), table([T('day'), T('qty') + ` (${uLbl()})`, T('total')], Object.entries(r.by_day).reverse().map(([d, x]) => [fdate(d), volNum(x.qty_ml), money(x.gross)])))));
      });
      const fixed = (v) => (v / Math.pow(10, dec())).toFixed(dec());
      const expSales = guard(async () => { const r = await api('GET', sp(`/sales/export?from=${from.value}&to=${to.value}`)); csv(`sales-${from.value}_${to.value}.csv`, ['id', 'date', 'pump', 'fuel', 'quantity_ml', 'price_e4_per_litre', 'net', 'vat', 'gross', 'type', 'customer'], r.map(x => [x.id, x.business_date, x.pump_name, x.fuel_name, x.quantity_ml, x.price_e4, fixed(x.net), fixed(x.vat), fixed(x.gross), x.pay_type, x.customer_name || ''])); });
      const expExp = guard(async () => { const r = (await api('GET', sp(`/expenses?from=${from.value}&to=${to.value}&limit=200`))).filter(x => !x.voided_at); csv(`expenses-${from.value}_${to.value}.csv`, ['id', 'date', 'category', 'note', 'gross', 'vat'], r.map(x => [x.id, x.business_date, x.category, x.note || '', fixed(x.gross), fixed(x.vat)])); });
      main.append(sec(null, h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', type: 'button', onclick: run }, T('run')), h('span', { class: 'muted small' }, T('exportH')), h('button', { class: 'btn ghost sm', type: 'button', onclick: expSales }, T('csvSales')), h('button', { class: 'btn ghost sm', type: 'button', onclick: expExp }, T('csvExp')), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => printNode(T('rep') + ' ' + from.value + ' → ' + to.value, out) }, T('print')))), out); await run();
    },
    async setup(main) {
      const canCfg = cd('config.edit'), owner = cd('users.manage'), u = uLbl();
      const mini = (fn, ...kids) => h('form', { class: 'row', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); await fn(); await refresh(); }) }, ...kids, h('button', { class: 'btn', type: 'submit' }, T('add')));
      if (canCfg) {
        const rows = S.fuels.map(f => { const p = h('input', { id: 'pr' + f.id, inputmode: 'decimal', value: priceInput(f.price_e4) }); return [f.name, p, h('button', { class: 'btn sm', onclick: guard(async () => { await api('PATCH', sp('/fuels/' + f.id), { price_e4: num(p.value, priceE4) }); toast(T('saved')); await loadBase(); }) }, T('save'))]; });
        const fn = h('input', { id: 'fName' }), fp = h('input', { id: 'fPrice', inputmode: 'decimal' });
        const tn = h('input', { id: 'tName' }), tf = sel('tFuel', S.fuels.map(f => [f.id, f.name])), tc = h('input', { id: 'tCap', inputmode: 'decimal' }), tl = h('input', { id: 'tLvl', inputmode: 'decimal', value: '0' });
        const pn = h('input', { id: 'pName' }), pt = sel('pTank', S.tanks.map(t => [t.id, `${t.name} — ${t.fuel_name}`])), pm = h('input', { id: 'pMeter', inputmode: 'decimal', value: '0' });
        const mp = sel('mPump', S.pumps.map(p => [p.id, p.name])), mv = h('input', { id: 'mVal', inputmode: 'decimal' }), mn = h('input', { id: 'mNote' });
        main.append(sec(T('fuels'), table([T('fuel'), T('sellPrice', { u }), ''], rows), mini(async () => { await api('POST', sp('/fuels'), { name: fn.value, price_e4: fp.value.trim() ? num(fp.value, priceE4) : 0 }); }, field(T('name'), fn), field(T('sellPrice', { u }), fp))),
          h('div', { class: 'grid2' },
            sec(T('tanks'), table([T('tank'), T('fuel'), T('capacity', { u })], S.tanks.map(t => [t.name, t.fuel_name, volNum(t.capacity_ml, 0)])), S.fuels.length ? mini(async () => { await api('POST', sp('/tanks'), { name: tn.value, fuel_id: +tf.value, capacity_ml: num(tc.value, volMl), level_ml: num(tl.value || '0', volMl) }); }, field(T('name'), tn), field(T('fuel'), tf), field(T('capacity', { u }), tc), field(T('level', { u }), tl)) : null),
            sec(T('pumps'), table([T('pump'), T('fuel'), T('meter', { u })], S.pumps.map(p => [p.name, p.fuel_name, volNum(p.meter_ml, 3)])), S.tanks.length ? mini(async () => { await api('POST', sp('/pumps'), { name: pn.value, tank_id: +pt.value, meter_ml: num(pm.value || '0', volMl) }); }, field(T('name'), pn), field(T('tank'), pt), field(T('meter', { u }), pm)) : null,
              S.pumps.length ? h('div', { class: 'sep' }, h('h3', null, T('fixMeter')), h('form', { class: 'row', autocomplete: 'off', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp(`/pumps/${mp.value}/meter`), { meter_ml: num(mv.value, volMl), note: mn.value }); toast(T('saved')); await refresh(); }) }, field(T('pump'), mp), field(T('meter', { u }), mv), field(T('noteReq'), mn), h('button', { class: 'btn ghost', type: 'submit' }, T('save')))) : null)));
      }
      if (owner) {
        const vr = h('input', { id: 'vRate', inputmode: 'decimal', value: String(S.st.vat_bp / 100) }), vi = h('input', { id: 'vIncl', type: 'checkbox', checked: !!S.st.vat_included }), an = h('input', { id: 'aNeg', type: 'checkbox', checked: !!S.st.allow_negative }), rs = h('input', { id: 'reqShift', type: 'checkbox', checked: !!S.st.require_shift });
        main.append(sec(T('station'), h('form', { onsubmit: guard(async (e) => { e.preventDefault(); await api('PATCH', `/api/stations/${S.sid}`, { vat_bp: num(vr.value || '0', (v) => parseDec(v, 2)), vat_included: vi.checked, allow_negative: an.checked, require_shift: rs.checked }); toast(T('saved')); await refresh(); }) },
          h('div', { class: 'grid' }, field(T('vatRate'), vr)), h('label', { class: 'check' }, vi, T('vatIncl')), h('label', { class: 'check' }, an, T('allowNeg')), h('label', { class: 'check' }, rs, T('reqShift')), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))))));
      }
      if (!canCfg) main.append(sec(null, h('p', { class: 'muted' }, T('noData'))));
    },
    async audit(main) {
      const from = h('input', { type: 'date', value: S.auFrom || '', max: todayIso() }), to = h('input', { type: 'date', value: S.auTo || '', max: todayIso() });
      const origin = sel('auOrigin', [['', T('all')], ['fp', T('auFp')], ['m7', T('auM7')]], S.auOrigin || '');
      const out = h('div', { class: 'stack' }); let offset = 0, rows = [];
      const describe = (x) => { let d = {}; try { d = JSON.parse(x.detail || '{}'); } catch {} const parts = [];
        if (x.action.startsWith('m7.')) {
          if (d.book || d.ref) parts.push([d.book, d.ref].filter(Boolean).join(' ')); if (d.doc_date) parts.push(fdate(d.doc_date)); if (d.amount != null) parts.push(money(d.amount));
          if (d.title) parts.push(d.title); if (d.from || d.to) parts.push((d.from ? fdate(d.from) : '') + ' → ' + (d.to ? fdate(d.to) : '')); if (d.text) parts.push(d.text); if (d.memo) parts.push(d.memo);
          if (d.lines && d.lines.length) parts.push(d.lines.length + ' ' + T('auLines'));
          if (parts.length) return parts.join(' · '); delete d.k; }
        for (const [k, v] of Object.entries(d)) { if (v && typeof v === 'object') { if (Array.isArray(v)) parts.push(`${k}: ${v.join(' → ')}`); else parts.push(`${k}: ${Object.entries(v).map(([a2, b2]) => a2 + '=' + b2).join(', ')}`); } else if (/_ml$/.test(k)) parts.push(`${k.replace('_ml', '')}: ${vol(v)}`); else parts.push(`${k}: ${v}`); }
        return parts.join(' · '); };
      const label = (x) => D['au.' + x.action] ? T('au.' + x.action) : x.action;
      const draw = () => out.replaceChildren(table(['#', T('time'), T('name'), '', ''], rows.map(x => [x.id, fdt(x.created_at), x.user_name || '', x.action.startsWith('m7.') ? h('span', null, h('span', { class: 'chip' }, T('auM7Short')), ' ', label(x)) : label(x), h('span', { class: 'muted small' }, describe(x))])),
        rows.length && rows.length % 100 === 0 ? h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: more }, T('loadMore'))) : null);
      const q = () => `/audit?limit=100&offset=${offset}${from.value ? '&from=' + from.value : ''}${to.value ? '&to=' + to.value : ''}${origin.value ? '&origin=' + origin.value : ''}`;
      const run = guard(async () => { S.auFrom = from.value; S.auTo = to.value; S.auOrigin = origin.value; offset = 0; rows = await api('GET', sp(q())); draw(); });
      const more = guard(async () => { offset += 100; rows = rows.concat(await api('GET', sp(q()))); draw(); });
      main.append(sec(T('audit'), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('auOrigin'), origin), h('button', { class: 'btn', onclick: run }, T('run'))), out));
      await run();
    }
  };
  function csv(name, header, rows) { const esc = (v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); const blob = new Blob(['﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); }
  /* print a section as an A4 page, or a sale as an 80 mm receipt */
  /* ---------- column auto-fit: numbers, dates, codes and buttons take only the width they need; text columns share the rest ---------- */
  const RE_NUM = /^(?:[A-Z]{3}\s*)?[\s(+\-–−]*[\d٠-٩][\d٠-٩,.\s٬٫]*%?\)?(\s*[A-Z]{3}|\s*(لتر|L|ل|م|د|يوم))?$/;
  const RE_DATE = /^(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}|\d{1,2}\s+\S+\s+\d{4}|\d{1,2}\s+\S+?،?)(،?\s+\d{1,2}:\d{2}(:\d{2})?(\s*[صمAP]M?)?)?$/;
  function fitTable(t) {
    if (t.dataset.fit === 'off' || t.closest('.classic,.receipt') || t.querySelector('colgroup') || t.classList.contains('tree') || t.querySelector('tbody input, tbody select, tbody textarea')) return;
    const rows = [...t.rows]; if (!rows.length) return;
    const head = t.tHead && t.tHead.rows[t.tHead.rows.length - 1];
    /* real column of every cell, honouring rowspan and colspan */
    const pos = new Map(); { const taken = []; rows.forEach((r, ri) => { let ci = 0; for (const c of r.cells) { while (taken[ri] && taken[ri][ci]) ci++; pos.set(c, ci);
      for (let dr = 0; dr < (c.rowSpan || 1); dr++) for (let dc = 0; dc < (c.colSpan || 1); dc++) { (taken[ri + dr] ||= [])[ci + dc] = true; } ci += c.colSpan || 1; } }); }
    const cellsAt = (r) => [...r.cells].map(c => [pos.get(c), c]);
    const ncol = Math.max(...[...pos.entries()].map(([c, i]) => i + (c.colSpan || 1))); if (ncol < 2) return;
    const stats = Array.from({ length: ncol }, () => ({ n: 0, num: 0, tight: 0, act: 0, len: 0, max: 0 }));
    for (const r of rows) {
      if (r.parentElement && r.parentElement.tagName === 'THEAD') continue;
      for (const [i, c] of cellsAt(r)) {
        if ((c.colSpan || 1) > 1) continue;
        const txt = c.textContent.replace(/\s+/g, ' ').trim(); const st = stats[i];
        if (c.querySelector('button,a.btn,select,input')) { if (!txt || c.querySelectorAll('button,a.btn').length) { st.act++; st.n++; } continue; }
        if (!txt || txt === '—' || txt === '-') continue;
        st.n++; st.len += txt.length; st.max = Math.max(st.max, txt.length);
        if (RE_NUM.test(txt)) st.num++; else if (RE_DATE.test(txt) || (!/\s/.test(txt) && txt.length <= 14)) st.tight++;
      }
    }
    const kind = stats.map(st => !st.n ? 'tight' : st.act / st.n >= .6 ? 'act' : st.num / st.n >= .8 ? 'num' : (st.num + st.tight) / st.n >= .8 && st.max <= 24 ? 'tight' : (st.len / st.n > 28 || st.max > 60) ? 'wide' : 'text');
    if (!kind.some(k => k === 'text' || k === 'wide')) { const i = kind.indexOf('tight'); if (i >= 0) kind[i] = 'text'; }   // someone has to take the spare width
    const nnum = kind.filter(k => k === 'num').length;
    t.classList.add('fit'); t.classList.toggle('dense', nnum >= 6 || ncol >= 10);
    if ((nnum >= 6 && ncol >= 8) || ncol >= 11) t.dataset.wide = '1'; else delete t.dataset.wide;
    for (const r of rows) for (const [i, c] of cellsAt(r)) {
      if ((c.colSpan || 1) > 1) continue;
      c.classList.remove('f-num', 'f-tight', 'f-act', 'f-wide', 'f-text'); c.classList.add('f-' + kind[i]);
      if (kind[i] === 'num' && c.tagName === 'TD') c.classList.add('num');
      if (kind[i] === 'num' && c.tagName === 'TH') c.classList.add('num');
    }
    t.dataset.fitRows = String(rows.length);
    t.classList.remove('squeeze', 'squeeze2');
    return true;
  }
  /* still wider than its box on screen: tighten, then let text columns give up their minimum width.
     Done for all the tables of a screen together: every check reads the layout, and reading it after a change forces the browser
     to lay the page out again. Table by table that was up to 3 full layouts per table (100 journal cards = 300 layouts); in
     three rounds it is at most 3 layouts for the whole screen. Each table still gets the same classes. */
  function squeezeTables(list) {
    let left = list.filter(t => { const w = t.parentElement; return w && t.offsetParent && w.clientWidth; });
    for (const cls of ['dense', 'squeeze', 'squeeze2']) {
      if (!left.length) return;
      const over = left.filter(t => t.scrollWidth > t.parentElement.clientWidth + 1);   // reads only: one layout for the whole round
      over.forEach(t => t.classList.add(cls));                                           // writes only
      left = over;
    }
  }
  function fitTables(root) {
    const done = [];
    (root || document).querySelectorAll('table').forEach(t => { if ((t.dataset.fitRows !== String(t.rows.length) || !t.classList.contains('fit')) && fitTable(t)) done.push(t); });
    squeezeTables(done);
    /* a printed page whose table is too wide for portrait turns to landscape */
    if (root && root.id === 'print' && root.firstElementChild) root.firstElementChild.classList.toggle('landscape', !!root.querySelector('table[data-wide]'));
  }
  let fitQueued = false;
  new MutationObserver(() => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitTables(document.getElementById('main') || document); document.querySelectorAll('.modal').forEach(m => fitTables(m)); }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  let rsz = 0; window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { document.querySelectorAll('#main table.fit').forEach(t => { delete t.dataset.fitRows; }); fitTables(document.getElementById('main')); }, 200); });
  /* print a section as an A4 page (same official layout as every other document), or a sale as an 80 mm receipt */
  function printNode(title, node, receipt = false) {
    let box = document.getElementById('print'); if (!box) { box = h('div', { id: 'print' }); document.body.append(box); }
    const clone = node.cloneNode(true); clone.querySelectorAll('button,input,select,.noprint,.row:empty').forEach(e => e.remove());
    if (receipt) {
      box.replaceChildren(h('div', { class: 'ph' }, h('div', null, h('b', null, S.st ? S.st.name : 'FuelPro'), h('div', null, title)), h('div', { class: 'small' }, fdt(new Date().toISOString().slice(0, 19).replace('T', ' ')))), clone);
      document.body.classList.add('printing', 'receipt');
    } else {
      clone.querySelectorAll('.tw').forEach(w => { w.classList.remove('tw'); w.classList.add('tw-print'); });
      clone.querySelectorAll('table').forEach(t => { t.classList.add('stmt'); if (!t.closest('.tw-print')) { const w = h('div', { class: 'tw-print' }); t.replaceWith(w); w.append(t); } });
      clone.querySelectorAll('.card,.stat').forEach(c => c.classList.add('pcard'));
      const foot = h('div', { class: 'pf' }, h('span', null, (S.brand && S.brand.footer) || ''), h('span', null, T('printedOn'), ': ', fdt(new Date().toISOString().slice(0, 19).replace('T', ' ')), S.user ? ' · ' + S.user.name : ''));
      box.replaceChildren(h('div', { class: 'a4 xdoc' }, window.FP.letterhead ? window.FP.letterhead(title) : h('h2', null, title), clone, foot));
      document.body.classList.add('printing', 'doc');
    }
    fitTables(box);
    const old = document.title; if (!receipt) document.title = title;
    const done = () => { document.body.classList.remove('printing', 'receipt', 'doc'); document.title = old; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 1500);
  }
  function printReceipt(s) {
    const r = h('div', null, h('table', null, h('tbody', null,
      [[T('receiptNo'), '#' + s.id], [T('time'), fdt(s.created_at)], [T('pump'), s.pump_name], [T('fuel'), s.fuel_name], [T('qty'), vol(s.quantity_ml, 3)], [T('price', { u: uLbl() }), priceShow(s.price_e4)],
        ...(s.vat ? [[T('net'), money(s.net)], [T('vat'), money(s.vat)]] : []), [T('total'), money(s.gross)], [T('payType'), T(s.pay_type) + (s.customer_name ? ' · ' + s.customer_name : '')]]
        .map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: 'num' }, h('b', null, v)))))), s.voided_at ? h('p', null, h('b', null, T('voided'))) : null, h('p', { class: 'small' }, T('thanks')));
    printNode(T('receipt'), r, true);
  }
  const priceFree = (ml) => String(+(ml / U().ml).toFixed(3));   // plain decimal for an input box (locale-independent)
  const voidBtn = (path) => h('button', { class: 'btn danger sm', onclick: () => askReason(guard(async (r) => { await api('POST', sp(path()), { reason: r }); await refresh(); })) }, T('void'));

  async function salesList(box) {
    const day = h('input', { id: 'salesDate', type: 'date', value: S.salesDate, max: todayIso(), onchange: (e) => { if (e.target.value) { S.salesDate = e.target.value; render(); } } });
    const rows = await api('GET', sp(`/sales?date=${S.salesDate}&limit=200`)); const live = rows.filter(r => !r.voided_at);
    box.replaceChildren(h('div', { class: 'row' }, h('h2', null, T('sales') + ' — ' + fdate(S.salesDate)), field(T('day'), day)),
      rows.length ? table([T('time'), T('pump'), T('fuel'), T('qty') + ` (${uLbl()})`, T('price', { u: uLbl() }), T('vat'), T('total'), T('payType'), ''], rows.map(s => [ftime(s.created_at), s.pump_name, s.fuel_name, volNum(s.quantity_ml), priceShow(s.price_e4), money(s.vat),
        s.voided_at ? h('span', { class: 'struck' }, money(s.gross)) : h('b', null, money(s.gross), s.discount ? h('small', { class: 'muted' }, ' (' + T('discount') + ' ' + money(s.discount) + ')') : ''), s.voided_at ? h('span', { class: 'muted' }, T('voided')) : h('span', { class: 'pill ' + s.pay_type }, T(s.pay_type) + (s.customer_name ? ' · ' + s.customer_name : '')), h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => printReceipt(s) }, T('receipt')), !s.voided_at && cd('sale.void') ? voidBtn(() => `/sales/${s.id}/void`) : '')])) : h('p', { class: 'muted' }, T('noData')),
      rows.length ? h('p', { class: 'hint' }, T('total'), ': ', h('b', null, money(live.reduce((a, r) => a + r.gross, 0))), ' · ', vol(live.reduce((a, r) => a + r.quantity_ml, 0))) : '');
  }

  const resetFromHash = () => {
    const m = /^#reset=([A-Za-z0-9_-]{43})$/.exec(location.hash); if (!m) return false;
    history.replaceState(null, '', location.pathname);   // drop the token from the address bar and history
    authScreen('reset', { token: m[1] }); return true;
  };
  window.addEventListener('hashchange', resetFromHash);
  window.addEventListener('hashchange', () => { const m = /^#([a-z]+)$/.exec(location.hash); if (m && S.user && VIEWS[m[1]] && m[1] !== S.tab) { S.tab = m[1]; render(); } });
  /* erp.js calls boot() before the later scripts (books-ui, more-ui, …) have registered their screens. If the server answered
     first, the menu lacked those screens and a link such as #jbook fell back to the dashboard. The session is fetched at once,
     but the first screen waits until every app script has run (page: DOMContentLoaded; Artifact page: its loader's event). */
  const scriptsReady = () => new Promise((ok) => {
    if (window.__FP_APP_FILES && !window.__FP_APP_LOADED) { addEventListener('fp:app-loaded', ok, { once: true }); setTimeout(ok, 5000); return; }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', ok, { once: true }); return; }
    ok();
  });
  async function boot() {
    applyPrefs();
    if (resetFromHash()) return;
    const m = /^#([a-z]+)$/.exec(location.hash); if (m) S.tab = m[1];
    const ready = scriptsReady();
    try { await loadBase(); await ready; S.user && S.sid ? render() : authScreen(); }
    catch (e) { await ready; authScreen('login', e && e.code === 'NETWORK' ? { notice: e.message } : {}); }
  }
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button.btn, .iconbtn'); if (!b || calm()) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), sp2 = document.createElement('span'); sp2.className = 'ripple';
    sp2.style.width = sp2.style.height = d + 'px'; sp2.style.left = (e.clientX - r.left - d / 2) + 'px'; sp2.style.top = (e.clientY - r.top - d / 2) + 'px';
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative'; b.style.overflow = 'hidden'; b.append(sp2); setTimeout(() => sp2.remove(), 650);
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  /* shared toolkit for the ERP views in erp.js (which calls FP.boot() once it has registered its views) */
  var F_STMT = (...a) => window.FP.partyStatement && window.FP.partyStatement(...a);
  window.FP = { h, T, D, P, S, api, sp, guard, toast, field, sel, table, stat, sec, modal, askReason, voidBtn, refresh, render, loadBase, cd, money, vol, volNum, volMl, parseDec, dec,
    fdate, fdt, ftime, todayIso, num, volFree: (ml) => priceFree(ml), priceShow, priceE4, uLbl, nfmt, dtf, csv, printNode, fitTables, icon, VIEWS, boot, countUp, statN, tankViz, animateIn };
})();
