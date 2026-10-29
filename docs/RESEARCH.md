# گزارش تحقیق: مدیریت حساب X بدون API رسمی

> تاریخ تحقیق: ۷ آبان ۱۴۰۵ (2026-10-29) · پروژه: **Xomoni**
> هدف: حذف پست‌ها و ریپلای‌های قدیمی‌تر از یک تاریخ، برداشتن لایک‌ها و ریپوست‌ها، و مدیریت همه‌ی این کارها در یک داشبورد. همه‌ی این‌ها بدون API رسمی X و با رعایت محدودیت‌های X.

---

## ۱. خلاصه‌ی اجرایی

| سؤال | پاسخ کوتاه |
|---|---|
| آیا بدون API ممکن است؟ | بله. ابزارهایی مثل Cyd، TweetXer، Redact و x-tweet-cleaner همین کار را می‌کنند. |
| بهترین روش فنی چیست؟ | **افزونه‌ی Chrome** که در نشست واقعی خود شما روی x.com کار می‌کند. افزونه روی دکمه‌ها کلیک می‌کند و درخواست‌ها را خود وب‌اپ X می‌فرستد. افزونه فقط پاسخ‌ها را **می‌خواند**. |
| چرا درخواست مستقیم به GraphQL نه؟ | در ۲۰۲۵–۲۰۲۶ هدر ضدربات `x-client-transaction-id` برای عملیات بیشتری اجباری شد. بدون آن پاسخ 404 برمی‌گردد. ابزارهایی که درخواست را خودشان می‌سازند مرتب از کار می‌افتند. |
| آیا می‌شود محدودیت‌ها را «دور زد»؟ | **نه، و نباید.** محدودیت‌ها سمت سرور و برای هر حساب اعمال می‌شوند. «غلبه» یعنی مدیریت هوشمند **درون** محدودیت‌ها: زمان‌بندی، توقف خودکار، از سرگیری، و منبع داده‌ی درست. |
| ریسک چیست؟ | صفر نیست. [قوانین اتوماسیون X](https://help.x.com/en/rules-and-policies/x-automation) صراحتاً «scripting the X website» را منع می‌کند و می‌گوید ممکن است به تعلیق دائمی منجر شود. Xomoni ریسک را کم می‌کند، ولی تضمین نمی‌دهد. |

---

## ۲. چرا API رسمی گزینه‌ی مناسبی نیست

- از **۶ فوریه ۲۰۲۶** مدل اصلی API پرداخت به ازای مصرف (pay-per-use) است و پلن ۲۰۰ دلاری Basic جایگزین شده ([OpenTermsArchive](https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/)، [Gigazine](https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/)).
- حذف پست از طریق API رسمی (`DELETE /2/tweets/:id`) فقط **۵۰ درخواست در ۱۵ دقیقه برای هر کاربر** است ([X Docs – Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)).
- برای خواندن تاریخچه هم باید هزینه‌ی هر پست خوانده‌شده را پرداخت کرد. ساخت اپ توسعه‌دهنده هم برای کاربر عادی سخت است.

**نتیجه:** API رسمی هم هزینه دارد و هم برای کاربر عادی سخت است. Xomoni از API رسمی استفاده نمی‌کند.

---

## ۳. محدودیت‌ها و سازوکارهای کنترلی X

### ۳.۱ محدودیت‌های اعلام‌شده (Help Center)

| عمل | محدودیت | منبع |
|---|---|---|
| پست اصلی (حساب تأییدنشده) | **۵۰ در روز**، تقسیم‌شده به بازه‌های نیم‌ساعته (از مه ۲۰۲۶؛ قبلاً ۲,۴۰۰) | [X limits](https://help.x.com/en/rules-and-policies/x-limits)، [Engadget](https://www.engadget.com/2175771/x-accounts-are-limited-to-50-posts-and-200-replies-a-day/)، [heise](https://heise.de/-11298442) |
| ریپلای (حساب تأییدنشده) | **۲۰۰ در روز** | همان |
| پیام خصوصی | ۵۰۰ در روز | همان |
| فالو | ۴۰۰ در روز؛ بالای ۵,۰۰۰ فالوینگ محدودیت نسبتی | همان |
| فالو/آنفالوی خودکار | **ممنوع** | [Rules & best practices](https://help.x.com/en/rules-and-policies/x-rules-and-best-practices) |

> نکته: این سقف‌ها برای **ساختن** محتوا هستند. هیچ منبعی نگفته که حذف هم جزو این سقف حساب می‌شود. Xomoni هیچ‌وقت پست نمی‌سازد. فقط وقتی کاربر خودش «لایک دوباره برای حذف لایک‌های قدیمی» را روشن کند، لایک موقت می‌سازد (بخش ۵.۵).

### ۳.۲ محدودیت‌های اعلام‌نشده (از تجربه‌ی ابزارهای موجود)

| عمل | برآورد | توضیح |
|---|---|---|
| لایک | حدود **۱,۰۰۰ در روز** (تاریخی) | Semiphemeral به همین دلیل بعد از ۱,۰۰۰ لایک متوقف می‌شد ([Micah Lee](https://micahflee.com/with-semiphemeral-you-can-delete-your-old-twitter-likes-but-its-noisy/)) |
| حذف پست (مسیر وب) | منتشر نشده | x-tweet-cleaner حدود ۱.۵ ثانیه ± ۰.۷ را «امن» می‌داند (≈ ۲,۰۰۰ در ساعت). زیر ۱ ثانیه خطای 429 زیاد می‌شود ([x-tweet-cleaner](https://github.com/zike-code/x-tweet-cleaner)) |
| حذف پست (API رسمی) | ۵۰ / ۱۵ دقیقه | مرجعی محافظه‌کارانه برای پیش‌فرض‌ها |
| عمق تایم‌لاین پروفایل | حدود **۳,۲۰۰** پست آخر | برای پست‌های قدیمی‌تر باید از **جستجو** یا **آرشیو** استفاده کرد |
| تایم‌لاین لایک‌ها | چند هزار لایک آخر | لایک‌های قدیمی‌تر فقط در آرشیو (`like.js`) هستند |

### ۳.۳ سازوکارهای فنی کنترل و ضدربات

| سازوکار | چه می‌کند | واکنش Xomoni |
|---|---|---|
| هدرهای `x-rate-limit-limit / remaining / reset` | سهمیه‌ی هر endpoint در پنجره‌ی ۱۵ دقیقه‌ای | افزونه این هدرها را از پاسخ‌های **خود وب‌اپ** می‌خواند و پیش از تمام شدن سهمیه صبر می‌کند |
| HTTP 429 / کد 88 | سهمیه تمام شده | توقف تا زمان `reset` به‌علاوه‌ی تأخیر تصادفی، و کند شدن خودکار |
| کد **226** («This request looks like it might be automated») | سامانه‌ی ضداتوماسیون رفتار را مشکوک دیده ([twitterapi.io](https://twitterapi.io/blog/twitter-request-looks-like-it-might-be-automated-error-226)، [Roboin](https://roboin.io/article/en/2026/05/18/why-you-cant-post-on-x-causes-and-fixes-for-request-flagged-as-automated/)) | **توقف کامل کار** و نیاز به ادامه‌ی دستی. تلاش دوباره نمی‌کند |
| کد **326** / هدایت به `/account/access` | حساب قفل شده و چالش (Arkose/CAPTCHA) لازم است | **توقف فوری و اعلان به کاربر**. Xomoni هرگز کپچا حل نمی‌کند. کاربر خودش در X آن را حل می‌کند و کار با سرعت کمتر ادامه پیدا می‌کند |
| کد 344 | سقف روزانه | توقف تا ۲۴ ساعت بعد |
| `x-client-transaction-id` | هدر امضاشده‌ی یک‌بارمصرف که با JS مبهم‌شده‌ی X ساخته می‌شود. بدون آن پاسخ 404 است ([twitter_cli #3، اکتبر ۲۰۲۶](https://github.com/quangdang46/twitter_cli/issues/3)، [twitter-cli #88](https://github.com/public-clis/twitter-cli/issues/88)) | Xomoni این هدر را **جعل نمی‌کند**. درخواست را خود وب‌اپ X با هدر درست می‌سازد، چون کار از طریق رابط کاربری انجام می‌شود |
| چرخش `queryId`های GraphQL | شناسه‌ی عملیات‌ها هر چند وقت عوض می‌شود | مهم نیست. Xomoni عملیات را با **نام** (مثل `DeleteTweet`) تشخیص می‌دهد، نه با شناسه |
| کوکی `ct0` و توکن CSRF | امنیت نشست | افزونه به کوکی‌ها دست نمی‌زند. فقط `twid` (شناسه‌ی کاربر) را می‌خواند |
| تشخیص مرورگر خودکار (`navigator.webdriver`، اثرانگشت) | ورود از Playwright/Puppeteer را مشکوک می‌کند | با افزونه این مشکل وجود ندارد، چون Chrome خود کاربر است و webdriver ندارد |

### ۳.۴ قوانین و شرایط استفاده

- **قوانین اتوماسیون X:** کاربر مسئول همه‌ی کارهایی است که از حسابش انجام می‌شود. «اتوماسیون غیر API مثل اسکریپت‌نویسی روی وب‌سایت X» ممنوع است و ممکن است به تعلیق دائمی منجر شود ([X Automation rules](https://help.x.com/en/rules-and-policies/x-automation)).
- **شرایط استفاده (ژانویه ۲۰۲۶):** خزیدن و استخراج داده بدون اجازه ممنوع است ([ConductAtlas](https://conductatlas.com/platform/x/x-terms-of-service/prohibition-on-scraping-without-express-written-permission/)). Xomoni فقط داده‌ی **حساب خود کاربر** را که وب‌اپ به او نشان می‌دهد ذخیره می‌کند. هیچ داده‌ای از دستگاه خارج نمی‌شود.
- **جمع‌بندی حقوقی:** پاک کردن محتوای خودتان کار کاملاً مشروعی است. حتی بخشی از حق شما در قوانین حریم خصوصی است. ولی **روش** خودکار آن طبق متن قوانین X در منطقه‌ی خاکستری است. ابزارهای شناخته‌شده‌ای مثل Cyd با همین روش سال‌هاست فعال‌اند. با این حال، تصمیم و ریسک با خود کاربر است و Xomoni این را شفاف به او می‌گوید.

---

## ۴. مقایسه‌ی رویکردهای فنی

| # | رویکرد | نمونه | مزایا | معایب | نتیجه |
|---|---|---|---|---|---|
| 1 | API رسمی | — | پایدار و قانونی | پولی، ۵۰ حذف در ۱۵ دقیقه، نیاز به اپ توسعه‌دهنده | ❌ خواسته‌ی کاربر نیست |
| 2 | درخواست مستقیم GraphQL با کوکی (سرور/اسکریپت) | x-tweet-cleaner، twikit | سریع | کاربر باید کوکی `auth_token` (کل نشستش) را کپی کند؛ نیاز به جعل `x-client-transaction-id`؛ IP و اثرانگشت TLS متفاوت؛ مدام می‌شکند | ❌ پرریسک و شکننده |
| 3 | اسکریپت کنسول / یوزراسکریپت | TweetXer، backzso/tweetdelete | ساده و رایگان | بدون داشبورد و حالت ذخیره‌شده؛ با بستن تب از دست می‌رود؛ همان مشکل transaction-id | ⚠️ برای استفاده‌ی یک‌باره |
| 4 | Playwright/Puppeteer | — | کنترل کامل | `navigator.webdriver` و ورود مشکوک؛ نصب سنگین؛ کاربر رمزش را در مرورگر خودکار وارد می‌کند | ⚠️ |
| 5 | اپ دسکتاپ Electron با مرورگر داخلی | **Cyd** ([PCWorld](https://www.pcworld.com/article/2792948/x-twitter-how-to-delete-and-archive-your-own-tweets.html)، [FPF](https://freedom.press/digisec/blog/clawing-back-your-data-on-x/)) | تجربه‌ی کاربری خوب؛ کلیک روی دکمه‌های واقعی | حجم بالا؛ باید جداگانه وارد حساب شد | ✅ معتبر ولی سنگین |
| 6 | **افزونه‌ی Chrome (MV3)** | Redact (افزونه)، **Xomoni** | نشست واقعی کاربر؛ بدون رمز و کوکی؛ بدون webdriver؛ داشبورد کامل؛ داده‌ها روی دستگاه خود کاربر | تب X باید باز بماند؛ وابستگی به DOM (با `data-testid`ها نسبتاً پایدار است) | ✅ **انتخاب Xomoni** |

---

## ۵. راهکارهای Xomoni برای کار درون محدودیت‌ها

### ۵.۱ «کلیک واقعی، تأیید از شبکه»

هر عمل (حذف، آن‌لایک، برداشتن ریپوست) با کلیک روی همان دکمه‌هایی انجام می‌شود که کاربر دستی می‌زند:
`caret → Delete → confirmationSheetConfirm`، `unlike`، `unretweet → unretweetConfirm`.

یک اسکریپت ناظر در صفحه پاسخ‌های GraphQL خود X را **می‌خواند** (`DeleteTweet`، `UnfavoriteTweet`، `DeleteRetweet` و…). موفقیت یک عمل فقط وقتی ثبت می‌شود که **سرور X** آن را تأیید کرده باشد، نه وقتی که فقط DOM تغییر کرده. کد خطا و هدرهای rate-limit هم از همین پاسخ خوانده می‌شوند.

### ۵.۲ منبع داده‌ی درست (فراتر از ۳,۲۰۰ پست)

1. **جستجوی پیشرفته‌ی X** با عملگرهای `from:handle until:YYYY-MM-DD` و `filter:replies` / `-filter:replies`. جستجو پست‌های خیلی قدیمی را هم برمی‌گرداند و حذف در همان صفحه‌ی نتایج انجام می‌شود. یعنی هر صفحه ۲۰ پست را با یک درخواست خواندن پوشش می‌دهد، بدون باز کردن هر پست.
2. **آرشیو رسمی X** (`Settings → Your account → Download an archive`). فایل `tweets.js` همه‌ی پست‌ها را دارد و `like.js` همه‌ی لایک‌ها را. هر ۲۴ ساعت یک بار قابل درخواست است و آماده شدنش ۲۴ تا ۷۲ ساعت طول می‌کشد ([TweetArchivist](https://www.tweetarchivist.com/twitter-archive-format-explained)). مرحله‌ی «پاک‌سازی عمیق» Xomoni مواردی را که جستجو پیدا نکرده تک‌به‌تک باز می‌کند.
3. **اسکن زنده:** هر بار که پروفایل، ریپلای‌ها یا لایک‌های خودتان در X باز می‌شود، Xomoni پاسخ‌ها را در موجودی محلی ذخیره می‌کند. فقط داده‌ی **حساب خود شما** ذخیره می‌شود.

### ۵.۳ زمان‌بندی شبیه انسان

- تأخیر تصادفی بین هر عمل، مثلاً ۶ تا ۱۲ ثانیه در حالت «Careful».
- **دسته‌ای کار کردن:** بعد از N عمل، چند دقیقه استراحت تصادفی.
- سقف **ساعتی** و **روزانه** برای هر نوع عمل، با پنجره‌ی چرخان (rolling window).
- ساعت فعالیت اختیاری، مثلاً فقط ۸ صبح تا ۱۱ شب.
- **کنترل تطبیقی (AIMD):** با هر خطای نرم فاصله‌ها ۱.۶ برابر می‌شوند (حداکثر ۶ برابر) و با موفقیت‌های پیاپی آرام به حالت عادی برمی‌گردند.
- **مطابق هدرها:** اگر `x-rate-limit-remaining ≤ 1` باشد، تا زمان `reset` صبر می‌کند.

### ۵.۴ قطع‌کننده‌های ایمنی (Circuit breakers)

| وضعیت | واکنش |
|---|---|
| 429 / کد 88 | صبر تا reset و کاهش سرعت |
| کد 344 | توقف ۲۴ ساعته |
| کد 226 | **توقف کار** و نمایش راهنما. ادامه فقط با دستور کاربر |
| کد 326 / `/account/access` و صفحه‌های تأیید X | **توقف فوری، وضعیت «Needs you» و اعلان دسکتاپ**. کاربر خودش چالش را در X حل می‌کند. بعد از آن Xomoni چند دقیقه صبر می‌کند و آهسته‌تر ادامه می‌دهد |
| خروج از حساب (`/i/flow/login`) یا کدهای 32/89/215 | **وضعیت «Needs you» و اعلان دسکتاپ**. کاربر خودش وارد می‌شود (همراه با 2FA). Xomoni رمز را نه می‌گیرد و نه ذخیره می‌کند و بعد از ورود خودکار ادامه می‌دهد |
| حساب دیگری در پنجره‌ی X | وضعیت «Needs you» تا کاربر به حساب درست برگردد |
| بیش از یک ساعت بدون پاسخ کاربر | توقف موقت (Paused) |
| بسته شدن پنجره‌ی Worker | توقف موقت |
| ۵ شکست پیاپی | توقف موقت. احتمالاً DOM عوض شده |

### ۵.۵ لایک‌های «شبح» (Ghost likes)

لایک‌های خیلی قدیمی در `like.js` هستند، ولی X آن‌ها را «لایک‌شده» نشان نمی‌دهد و دکمه‌ی Unlike ندارند. تنها راه شناخته‌شده: **لایک دوباره و بعد آن‌لایک** ([Semiphemeral](https://micahflee.com/with-semiphemeral-you-can-delete-your-old-twitter-likes-but-its-noisy/)).
این روش هزینه دارد: (۱) نویسنده‌ی پست ممکن است اعلان لایک بگیرد؛ (۲) از سهمیه‌ی لایک (حدود ۱,۰۰۰ در روز) مصرف می‌کند.
به همین دلیل در Xomoni **پیش‌فرض خاموش** است، سقف جداگانه‌ی کوچکی دارد، و هشدار صریح نشان می‌دهد.

### ۵.۶ تاریخ لایک

X زمان لایک کردن را در آرشیو یا رابط کاربری ارائه نمی‌دهد. Xomoni:
- اگر لایک از تایم‌لاین لایک‌ها دیده شده باشد، سعی می‌کند زمان را از `sortIndex` تخمین بزند. فقط وقتی از آن استفاده می‌کند که آزمون‌های سازگاری را بگذراند: بعد از تاریخ پست باشد، در آینده نباشد، و برابر شناسه‌ی پست نباشد.
- در غیر این صورت از **تاریخ خود پست** استفاده می‌کند. این تقریب ممکن است لایک‌هایی را هم شامل شود که بعد از تاریخ انتخابی روی پست‌های قدیمی زده‌اید. رابط کاربری این را صریحاً توضیح می‌دهد.

### ۵.۷ اصول طراحی امن

- **بدون رمز عبور، بدون کپی کوکی، بدون پروکسی، بدون حل کپچا، بدون جعل هدر.**
- **پیش‌نمایش اجباری** قبل از هر حذف، **پشتیبان JSON**، و تأیید با تایپ کلمه‌ی `DELETE`.
- **فهرست محافظت‌شده:** پست‌هایی با لایک بیشتر از N، کلمات کلیدی، و شناسه‌های خاص حذف نمی‌شوند.
- **قابل ادامه (Resumable):** وضعیت در IndexedDB ذخیره می‌شود. با بستن مرورگر چیزی از دست نمی‌رود.
- **«در صورت شک، حذف نکن»:** اگر داده‌ی کافی برای تصمیم نباشد، آیتم رد می‌شود.
- **بررسی مالکیت آرشیو:** شناسه‌ی حساب در `account.js` باید با حساب متصل یکی باشد.

---

## ۶. معماری Xomoni

```
┌──────────────────────── Chrome (پروفایل خود کاربر) ───────────────────────┐
│                                                                           │
│  ┌──────────── Dashboard (صفحه‌ی افزونه، React) ────────────┐              │
│  │ Overview · Cleanup · Inventory · Jobs · Activity · Settings│            │
│  │            Runner (موتور اجرای کار)                         │            │
│  │   Limiter (تأخیر، سقف‌ها، AIMD) · Circuit breakers          │            │
│  └──────┬──────────────────────────────────────────▲──────────┘           │
│         │ chrome.tabs.sendMessage(cmd)             │ IndexedDB (Dexie)    │
│         ▼                                          │ liveQuery            │
│  ┌──── Worker window: x.com ──────────────────┐    │                      │
│  │ content.js (ISOLATED): Actor               │    │                      │
│  │   کلیک روی data-testid ها، اسکرول، وضعیت    │    │                      │
│  │ inject.js (MAIN): ناظر fetch/XHR           │    │                      │
│  │   فقط خواندن پاسخ‌های GraphQL خود X ───────┼──► sw.js (Service Worker) │
│  └────────────────────────────────────────────┘   ورود داده به موجودی     │
└───────────────────────────────────────────────────────────────────────────┘
                         هیچ سرور خارجی‌ای وجود ندارد
```

| لایه | فناوری | مسئولیت |
|---|---|---|
| `inject.js` | MAIN world، `document_start` | پوشاندن `fetch` و `XMLHttpRequest` برای **خواندن** پاسخ عملیات‌های GraphQL مرتبط و هدرهای rate-limit |
| `content.js` | ISOLATED world | تجزیه‌ی پاسخ‌ها و استخراج پست‌های خود کاربر؛ Actor برای کلیک، اسکرول و بررسی وضعیت |
| `sw.js` | MV3 Service Worker | ورود داده به IndexedDB؛ باز کردن داشبورد |
| Dashboard | React 19 + Tailwind 4 + Dexie | رابط کاربری، Runner، Limiter، گزارش‌ها |

---

## ۷. جریان‌های کاربری اصلی

1. **اتصال:** کاربر در Chrome خودش وارد X است. داشبورد «Open X worker» را می‌زند و حساب خودکار شناسایی می‌شود.
2. **ساخت موجودی:** (الف) وارد کردن پوشه‌ی `data` آرشیو؛ و/یا (ب) اسکن زنده (پست‌ها، ریپلای‌ها، لایک‌ها، اسکن عمیق سال‌به‌سال با جستجو).
3. **پاک‌سازی:** نوع (پست، ریپلای، ریپوست، لایک) ← «قدیمی‌تر از» ← قوانین نگه‌داری ← پیش‌نمایش و تخمین زمان ← پشتیبان ← تأیید `DELETE` ← اجرا.
4. **نظارت:** پیشرفت، ETA، شمارش‌گر سقف‌ها، سهمیه‌های مشاهده‌شده‌ی X، و لاگ زنده. توقف، ادامه و لغو در هر لحظه.

---

## ۸. نقشه‌ی راه

| فاز | محتوا |
|---|---|
| **۱ (این نسخه)** | حذف پست، ریپلای و ریپوست بر اساس تاریخ؛ آن‌لایک (با گزینه‌ی ghost likes)؛ وارد کردن آرشیو؛ اسکن زنده؛ داشبورد؛ Limiter و Circuit breaker؛ لاگ و خروجی |
| ۲ | حذف خودکار دوره‌ای (مثلاً «همیشه پست‌های قدیمی‌تر از ۹۰ روز»)؛ حذف بوکمارک‌ها؛ رابط فارسی و راست‌به‌چپ |
| ۳ | آنفالوی گزینشی (دستی و با سقف کم، چون آنفالوی خودکار طبق قوانین X ممنوع است)؛ پاک کردن DMها؛ گزارش‌های تحلیلی |

---

## ۹. موارد نامعلوم و ریسک‌های باقی‌مانده

1. **سقف واقعی حذف از مسیر وب** منتشر نشده. Xomoni آن را از هدرهای پاسخ یاد می‌گیرد و پیش‌فرض‌هایش محافظه‌کارانه است.
2. **تخمین زمان لایک از `sortIndex`** تأییدشده نیست، به همین دلیل با آزمون سازگاری و برچسب «تخمینی» استفاده می‌شود.
3. **کامل بودن جستجو:** ایندکس جستجوی X ممکن است کامل نباشد. پاک‌سازی عمیق با آرشیو این خلأ را پر می‌کند.
4. **تغییر DOM:** `data-testid`ها سال‌هاست پایدارند، ولی تضمینی نیست. انتخاب‌گرها در یک فایل (`src/content/dom.ts`) جمع شده‌اند تا به‌روزرسانی آسان باشد.
5. **زبان رابط X:** گزینه‌ی Delete برای چند زبان تشخیص داده می‌شود. برای اطمینان بیشتر زبان X را روی English بگذارید.
6. **ریسک حساب:** حتی با رعایت همه‌ی موارد، X ممکن است رفتار را خودکار تشخیص دهد. از حالت Careful شروع کنید و قبل از کار بزرگ آرشیو بگیرید.

---

## منابع

- [About X limits — Help Center](https://help.x.com/en/rules-and-policies/x-limits)
- [X Automation rules](https://help.x.com/en/rules-and-policies/x-automation) · [X Rules & best practices](https://help.x.com/en/rules-and-policies/x-rules-and-best-practices)
- [X API Rate Limits — docs.x.com](https://docs.x.com/x-api/fundamentals/rate-limits)
- [Engadget — 50 posts / 200 replies (May 2026)](https://www.engadget.com/2175771/x-accounts-are-limited-to-50-posts-and-200-replies-a-day/) · [heise](https://heise.de/-11298442) · [Roboin — error 226](https://roboin.io/article/en/2026/05/18/why-you-cant-post-on-x-causes-and-fixes-for-request-flagged-as-automated/)
- [OpenTermsArchive — pay-per-use API](https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/) · [Gigazine](https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/)
- [twitter_cli #3 — x-client-transaction-id (Oct 2026)](https://github.com/quangdang46/twitter_cli/issues/3) · [twitter-cli #88](https://github.com/public-clis/twitter-cli/issues/88)
- [x-tweet-cleaner](https://github.com/zike-code/x-tweet-cleaner) · [backzso/tweetdelete](https://github.com/backzso/tweetdelete) · [TweetXer](https://greasyfork.org/ja/scripts/476062-tweetxer)
- [Cyd — PCWorld](https://www.pcworld.com/article/2792948/x-twitter-how-to-delete-and-archive-your-own-tweets.html) · [Freedom of the Press Foundation](https://freedom.press/digisec/blog/clawing-back-your-data-on-x/)
- [Micah Lee — Semiphemeral & old likes](https://micahflee.com/with-semiphemeral-you-can-delete-your-old-twitter-likes-but-its-noisy/) · [Redact — mass delete likes](https://redact.dev/blog/how-to-mass-delete-twitter-likes)
- [twitterapi.io — error 226](https://twitterapi.io/blog/twitter-request-looks-like-it-might-be-automated-error-226)
- [ConductAtlas — X ToS scraping clause](https://conductatlas.com/platform/x/x-terms-of-service/prohibition-on-scraping-without-express-written-permission/)
- [TweetArchivist — archive format](https://www.tweetarchivist.com/twitter-archive-format-explained) · [meemoo — archive contents](https://kennisbank.meemoo.be/toolbox/download-your-own-x-twitter-account-for-archiving-via-x)
