# ZoolGo — دليل مطوري التطبيقات (حزمة التسليم)

كل ما يحتاجه فريق Flutter لبدء تطبيقات **العميل** و**السائق** و**الوكيل** على API جاهز ومختبَر.

| المرجع | الملف |
|---|---|
| عقد الـ API (كل المسارات والأخطاء) | `zool-go-backend/docs/openapi.yaml` — ويعرض تفاعليًا على `http://localhost:4000/docs` |
| مجموعة Postman جاهزة | `zool-go-backend/docs/postman/ZoolGo.postman_collection.json` (تُولَّد بـ `npm run docs:postman`) |
| قواعد الـ API (المصادقة، المال، التواريخ، الأخطاء) | `docs/API_CONVENTIONS.md` |
| كل شاشة فيجما ← الـ endpoint الخاص بها | `docs/SCREEN_API_MAP.md` |
| الشاشات الناقصة من التصميم والهوية البصرية | `docs/MISSING_SCREENS.md` |
| القرارات (النقد، الذهاب والعودة، التعديل، الاسترداد) | `docs/BACKEND_DECISION_REGISTER.md` |

---

## 0. السيرفر التجريبي (جاهز)

- الـ API: **`https://zoolgo-api.nodeteam.site/api/v1`** — Swagger: `https://zoolgo-api.nodeteam.site/docs`.
- لا يعرض الكود (`devOtp`) هناك. حسابات التجربة في الجدول أدناه تدخل **بأكواد ثابتة** يسلّمها مالك المشروع للفريق (لا تُكتب في git). أي رقم من `+249900000300` إلى `+249900000399` يعمل كعميل تجريبي جديد بنفس كود العملاء.
- الدفع الوهمي (`mock-confirm`) مفعّل، والرحلات التجريبية تتجدد تلقائيًا.
- التفاصيل التشغيلية: `docs/handover/13_DEPLOYMENT.md`.

## 1. تشغيل الباك إند محليًا

```bash
cd zool-go-backend
npm ci
cp .env.example .env          # MySQL 3306 + Redis 6379 (Laragon) — راجع docs/handover/12
npx prisma migrate deploy
npm run db:seed               # المدن والمحطات والشركة التجريبية والحسابات أدناه
npm run db:demo               # رحلات الشركة التجريبية لـ 14 يومًا قادمة
npm run dev                   # http://localhost:4000/api/v1
```

- `DEMO_SCHEDULE_DAYS=14` في `.env` يجعل السيرفر **يجدّد الرحلات التجريبية تلقائيًا كل ساعة**، فلا تنتهي البيانات أبدًا (للتطوير والـ staging فقط).
- الرحلات التجريبية: الخرطوم ↔ بورتسودان **في الاتجاهين يوميًا** الساعة 07:00 (بتوقيت السودان)، بحافلتين وسائقين، توقف في شندي وعطبرة، سعر 35,000 ج.س، المقعدان 11 و12 للسيدات.
- للهاتف الحقيقي على نفس الشبكة: استخدم IP الجهاز بدل `localhost` (`http://192.168.x.x:4000/api/v1`) وأضفه في `CORS_ORIGINS` إن احتجت الويب.

## 2. حسابات التجربة (ثابتة)

| الدور | الجوال | التطبيق / السطح |
|---|---|---|
| مدير عام | `+249900000001` | لوحة الإدارة |
| مدير مكتب وكيل | `+249900000101` | تطبيق/لوحة الوكيل (كل الصلاحيات) |
| موظف حجز | `+249900000102` | تطبيق/لوحة الوكيل (حجز فقط) |
| سائق 1 | `+249900000201` | تطبيق السائق (الحافلة خ ر ط 1234) |
| سائق 2 | `+249900000202` | تطبيق السائق (الحافلة خ ر ط 5678) |
| مدير شركة نقل | `+249900000401` | لوحة شركة النقل |
| عميل | `+249900000301` | تطبيق العميل — **أي رقم جديد ينشئ حسابًا تلقائيًا** |

**كود الدخول:** في بيئة التطوير يُرجَع الكود في استجابة `POST …/otp/request` داخل الحقل `devOtp` (لا SMS). في الإنتاج لا يظهر.
**حدود الدخول:** تُضبط من لوحة الإدارة ← الإعدادات ← «الأمان والحدود». إذا ظهر `429 OTP_COOLDOWN` انتظر `details.retryAfterSeconds`.

## 3. المصادقة في التطبيقات

- كل تطبيق له مساره: `/customer/auth/*`، `/driver/auth/*`، `/broker/auth/*`. توكن تطبيق لا يعمل على تطبيق آخر.
- أرسل دائمًا الهيدر `X-Client-Platform: ios|android`. عندها يرجع `refreshToken` في **جسم** الاستجابة: خزّنه في Secure Storage، وأرسله في جسم `POST …/auth/refresh` و`…/auth/logout`.
- الـ access token صالح ~15 دقيقة. عند `401` بكود `AUTH_TOKEN_EXPIRED` أو `AUTH_AUTHZ_STALE`: جدّد مرة واحدة (طلب refresh واحد مشترك لكل الطلبات المعلّقة) ثم أعد الطلب؛ إن فشل التجديد ارجع لشاشة الدخول.
- التجديد **يدوّر** الـ refresh token: استخدم الجديد دائمًا. استعمال توكن قديم يُلغي كل جلسات العائلة (حماية من السرقة).
- العميل: `isNewCustomer: true` عند أول دخول ← اعرض خطوة «اسمك» ثم `PATCH /customer/me`.

## 4. قواعد لا تُخالَف

- **المال بالوحدات الصغرى**: كل حقل `*Minor` عدد صحيح (100 = 1 ج.س). لا تحسب الأسعار في التطبيق؛ اعرض ما يرجعه السيرفر (`quote`).
- **التواريخ** ISO بتوقيت UTC؛ اعرضها بتوقيت السودان (`Africa/Khartoum`، من `GET /public/app-config`). معاملات `date=YYYY-MM-DD` هي أيام سودانية.
- **الأخطاء**: افرع على `code` وليس `message` (رسائلك العربية في التطبيق). قائمة الأكواد في `openapi.yaml` و`src/shared/errors/error-codes.ts`.
- **التكرار**: أي عملية مالية (`POST /customer/bookings`، `…/change`، تأكيد الوكيل) ترسل `Idempotency-Key` (UUID لكل محاولة شراء؛ أعد نفس المفتاح عند إعادة المحاولة بعد انقطاع الشبكة).
- **القوائم**: `page`, `pageSize` ← `meta: { page, pageSize, total, totalPages }`.

## 5. مسارات الشاشات الأساسية

**العميل — الحجز:**
1. `GET /public/app-config` (عند الإقلاع) ← `GET /public/cities` ← `GET /customer/trips?fromCityId&toCityId&date&passengers`
2. `GET /customer/trips/:id` ← `GET /customer/trips/:id/seats` ← `POST /customer/trips/:id/holds { seatLabels }` (عدّاد من `expiresAt`)
3. ذهاب وعودة: احجز مقاعد الرحلتين، وأرسل `holdIds` للرحلتين معًا.
4. `POST /customer/bookings/quote` ← اعرض `cashAllowed` / `cashBlockedReason`
5. `POST /customer/bookings` (+ `Idempotency-Key`) ← نقدًا: مؤكد فورًا. إلكتروني: نفّذ `payment.nextAction` ثم استطلع `GET /customer/payments/:intentId` حتى `SUCCEEDED` (في التطوير: `MOCK_CONFIRM` = استدعِ `POST /customer/payments/:id/mock-confirm`).
6. رحلاتي: `GET /customer/bookings?tab=UPCOMING|ONGOING|PAST|CANCELLED`؛ التذكرة: `tickets[].qrPayload` ← ارسمه QR. التتبع: `GET /customer/bookings/:id/live` كل `pollSeconds`.

**السائق:** `GET /driver/dashboard` ← `GET /driver/trips/:id` ← `POST …/status {BOARDING}` ← مسح QR `POST …/scan {code}` ← `POST …/boardings { ticketNumber, cashCollectedMinor? }` ← `POST …/status {IN_PROGRESS}` ← GPS كل 15–30 ث `POST …/positions` (دفعات، أرسل المخزَّن عند عودة الشبكة) ← `POST …/status {COMPLETED}`.

**الوكيل:** نفس مسارات لوحة الوكلاء الويب (`/broker/*`) — المرجع العملي هو كود `zool-broker-dashboard`.

## 6. الإشعارات

- السجل: `GET /{customer|driver|broker}/notifications` + `unread-count` + `read` / `read-all`.
- تسجيل الجهاز بعد الدخول: `POST /{app}/devices { platform, pushToken }`، وحذفه عند الخروج: `DELETE /{app}/devices/:token`.
- الإرسال الفعلي (FCM) يُربط في المرحلة الأخيرة؛ حتى ذلك الحين السجل داخل التطبيق يعمل بالكامل. `data.bookingId` / `data.tripId` للتنقل عند الضغط.

## 7. ما ينتظر المرحلة الأخيرة (لا تبنِ له حلولًا مؤقتة)

بوابة الدفع الحقيقية (حاليًا مزوّد وهمي بنفس الواجهة)، رسائل SMS (حاليًا `devOtp`)، FCM، رفع الصورة الشخصية (S3)، البطاقات المحفوظة.
