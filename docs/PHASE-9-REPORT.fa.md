[English](PHASE-9-REPORT.md)

# گزارش فاز ۹: سخت‌سازی امنیتی

> نتیجه‌ی بازبینی امنیتی ۴ نوامبر ۲۰۲۶: چه چیزی در extension، سایت xomoni.com، دیتابیس و فرایند انتشار تغییر کرد، چه چیزی روی production فعال است، چه مشکلاتی در مسیر پیدا شد و چه کارهایی مانده است. هیچ‌کدام از API رسمی X استفاده نمی‌کند. فهرست کارها در [ROADMAP.md](ROADMAP.md#phase-9--security-hardening) است.
>
> تاریخ: ۵ نوامبر ۲۰۲۶ · کد: شاخه‌ی `main` بعد از [#174](https://github.com/pirdehi/xomoni/pull/174)

## خلاصه

- نُه مورد از ده issue بازبینی بسته شده‌اند. مورد دهم، [#148](https://github.com/pirdehi/xomoni/issues/148)، در کد انجام شده و فقط یک تنظیم در داشبورد Supabase مانده که مالک پروژه باید روشن کند.
- همه‌ی migrationهای دیتابیس و تنظیمات ورود روی production اعمال شده‌اند. هرکدام بعد از اعمال، روی خود production بررسی شد.
- دو باگ واقعی پیدا و رفع شد: Watch گزارش‌دهی مرورگرِ متصل را متوقف می‌کرد، و بعضی تست‌های رابط کاربری وقتی سیستم شلوغ بود شکست می‌خوردند.
- یک قطعی که خودمان ایجاد کردیم: ورود با Google روی xomoni.com چند دقیقه بر اثر یک push تنظیمات از کار افتاد و در همان ساعت برگشت (بخش [حادثه](#حادثه)).

## چه چیزی تغییر کرد

| Issue | تغییر | Pull request |
| --- | --- | --- |
| [#142](https://github.com/pirdehi/xomoni/issues/142) سلامت انتشار | build با دسترسی فقط‌خواندنی، actionهای قفل‌شده با SHA، امضای build provenance، تگ‌های محافظت‌شده، zip تکرارپذیر. | [#155](https://github.com/pirdehi/xomoni/pull/155)، [#157](https://github.com/pirdehi/xomoni/pull/157) |
| [#143](https://github.com/pirdehi/xomoni/issues/143) قفل extension | CSP که فقط به API خود Xomoni وصل می‌شود، بدون host permission، بدون اجرا در incognito. | [#156](https://github.com/pirdehi/xomoni/pull/156) |
| [#144](https://github.com/pirdehi/xomoni/issues/144) فقط پست‌های خودتان | قبل از Delete، نویسنده‌ی پست چک می‌شود و همه‌ی idها اعتبارسنجی می‌شوند. | [#153](https://github.com/pirdehi/xomoni/pull/153) |
| [#145](https://github.com/pirdehi/xomoni/issues/145) پیام‌های قابل‌اعتماد | service worker فقط پیام content script خود Xomoni روی x.com را می‌پذیرد و همه‌ی فیلدها را چک می‌کند. اسکریپت‌های صفحه نمی‌توانند چیزی را که Xomoni می‌خواند جعل کنند. قبل از هر حذف، id پست، تاریخ ذخیره‌شده و زمانی که X نشان می‌دهد باید یکی باشند، و متن روی صفحه نباید کلمه‌ی نگه‌داشتنی داشته باشد. زمان reset محدودیت حداکثر یک روز جلوتر پذیرفته می‌شود. | [#165](https://github.com/pirdehi/xomoni/pull/165) |
| [#146](https://github.com/pirdehi/xomoni/issues/146) فقط اخطارهای واقعی | اخطار محدودیت فقط از بنرهای خود X خوانده می‌شود، نه از متن پست‌ها. | [#154](https://github.com/pirdehi/xomoni/pull/154) |
| [#147](https://github.com/pirdehi/xomoni/issues/147) هدرهای xomoni.com | Trusted Types، گزارش نقض CSP، منابع تصویر محدودتر، CORP و بررسی Origin هنگام خروج. | [#160](https://github.com/pirdehi/xomoni/pull/160) |
| [#148](https://github.com/pirdehi/xomoni/issues/148) امنیت حساب | رمز فعلی با هر تغییر رمز به Supabase هم فرستاده می‌شود. کوکی نشست ۳۰ روز اعتبار دارد به‌جای ۴۰۰ روز. ثبت ورود دومرحله‌ای تا ساخته شدن صفحه‌اش ([#173](https://github.com/pirdehi/xomoni/issues/173)) خاموش است. | [#174](https://github.com/pirdehi/xomoni/pull/174) |
| [#149](https://github.com/pirdehi/xomoni/issues/149) دیتابیس | هیچ جدولی جز با دسترسی صریح در API در دسترس نیست و یک تست کل schema را چک می‌کند. دلیل (reason) کارها هرگز ذخیره نمی‌شود. توکن دستگاه بعد از ۹۰ روز بی‌استفاده باطل می‌شود. فقط اتصال SSL پذیرفته می‌شود. به‌روزرسانی زنده فقط روی کانال خصوصی صاحب حساب پخش می‌شود. هنگام اتصال، حساب با ایمیل نیمه‌مخفی نمایش داده می‌شود و تا تأیید نشود چیزی ارسال نمی‌شود. | [#170](https://github.com/pirdehi/xomoni/pull/170)، [#171](https://github.com/pirdehi/xomoni/pull/171)، [#172](https://github.com/pirdehi/xomoni/pull/172) |
| [#150](https://github.com/pirdehi/xomoni/issues/150) پایش | CodeQL، فایل `security.txt` و برنامه‌ی مکتوب هشدار. خود هشدارها پلن پولی لازم دارند ([#161](https://github.com/pirdehi/xomoni/issues/161)). | [#162](https://github.com/pirdehi/xomoni/pull/162) |
| [#151](https://github.com/pirdehi/xomoni/issues/151) داده‌های محلی | توکن xomoni.com از دسترس صفحه‌ی X خارج شد. «Delete local data» همه چیز را جز سابقه‌ی سرعت و ریسک پاک می‌کند. فایل‌های آرشیو بزرگ‌تر از ۵۱۲ مگابایت رد می‌شوند. صفحه‌ی آرشیو دانلودی نمی‌تواند اسکریپت اجرا کند. مرورگر متصل از نسخه‌ی جدید باخبر می‌شود. | [#166](https://github.com/pirdehi/xomoni/pull/166)، [#167](https://github.com/pirdehi/xomoni/pull/167) |

## چه چیزی روی production فعال است

- **Migrationها**، هرکدام با `supabase db push` اعمال و بعد با درخواست واقعی بررسی شد:
  - `extension_releases`: جدول و `release_rank` به روی همه بسته‌اند و توکن ناشناس همچنان رد می‌شود.
  - `database_hardening`: `anon` روی `devices` و `jobs` خطای 401 می‌گیرد.
  - `dashboard_broadcast`.
  - `pairing_shows_account`: کد اشتباه رد می‌شود و `mask_email` بسته است.
- **تنظیمات** با `supabase config push`: SSL اجباری روشن و ثبت ورود دومرحله‌ای خاموش.
- **سایت** از `main` با Vercel منتشر شد و صفحه‌ی ورود و ورود با Google بعدش بررسی شدند.
- **مرورگر مالک پروژه** extension را از `main` (c764d7f) اجرا می‌کند.

## چه چیزهایی در مسیر پیدا شد

- **Watch گزارش‌دهی را قطع می‌کرد** ([#168](https://github.com/pirdehi/xomoni/issues/168)، رفع‌شده در [#169](https://github.com/pirdehi/xomoni/pull/169)). کار Watch با نوعی گزارش می‌شد که دیتابیس نمی‌پذیرد، پس همه‌ی گزارش‌ها رد می‌شدند و سایت دیگر کارهای آن مرورگر را نشان نمی‌داد. حالا کارهای Watch در مرورگر می‌مانند.
- **تست‌ها روی سیستم شلوغ شکست می‌خوردند** ([#163](https://github.com/pirdehi/xomoni/issues/163)، رفع‌شده در [#164](https://github.com/pirdehi/xomoni/pull/164)). Vitest روی هر هسته یک worker اجرا می‌کرد، و تست‌های دیالوگ وقتی Fluent هنوز صفحه را پنهان نگه داشته بود دنبالش می‌گشتند. حالا Vitest از نصف هسته‌ها استفاده می‌کند و آن تست‌ها منتظر صفحه می‌مانند.
- **تست جدید schema دو نقص پیدا کرد** که در همان PR رفع شدند:
  - یک trigger function که همه می‌توانستند صدایش بزنند؛
  - تابع‌های جدید که به‌طور پیش‌فرض برای همه قابل اجرا بودند (تنظیمی سراسری که تغییر در سطح schema نمی‌تواند حذفش کند).

## حادثه

در ۵ نوامبر ۲۰۲۶ یک `supabase config push` از نسخه‌ای از پروژه اجرا شد که فایل `supabase/.env` را نداشت. شناسه‌ی Google به‌صورت متن خام `env(…)` فرستاده شد و ورود با Google روی xomoni.com چند دقیقه از کار افتاد. چون ورودی CLI ترمینال نبود، بدون پرسیدن اعمالش کرد.

push با مقادیر درست تکرار شد و آدرس ورود Google آن‌قدر چک شد تا دوباره شناسه‌ی درست را نشان داد. تنظیمات Turnstile و ایمیل هم در همان push برگشتند. از این به بعد هر push اول آن فایل را بارگذاری می‌کند و بعدش همین بررسی انجام می‌شود.

## چطور بررسی شد

- قبل از هر push، `npm run verify` اجرا شد: بیش از ۱٬۰۰۰ تست extension، بیش از ۵۴۰ تست سایت، lint، typeها، قواعد معماری، مستندات و وجود تست برای هر فایل.
- ۱۰۵ تست دیتابیس (pgTAP) روی یک استک محلی تازه، و کل تست‌های end-to-end (۳۴ تست) به‌صورت محلی با سرویس‌های واقعی Supabase، علاوه بر CI در هر PR.
- روی حساب واقعی مالک: Watch با بررسی‌های جدید پیام‌ها اجرا شد و محدودیت‌های X همچنان از پاسخ‌های واقعی خوانده شدند.

## کارهای باقی‌مانده

**با مالک پروژه**
1. داشبورد Supabase → Authentication → Providers → Email → **Require current password when updating** → روشن. بعد یک بار «Forgot password» را امتحان کنید. نسخه‌ی CLI پروژه نمی‌تواند این را تنظیم کند.
2. اختیاری: Realtime → **Allow public access** → خاموش. سایت دیگر از کانال عمومی استفاده نمی‌کند.
3. GitHub → Settings → Advanced Security: دو گزینه‌ی secret scanning که GitHub پذیرفت ولی خاموش ماند.

**نیاز به پلن پولی**
- هشدار برای خطاهای ورود و محدودیت نرخ ([#161](https://github.com/pirdehi/xomoni/issues/161)).
- محدودیت نشست خود Supabase (پلن Pro). تا آن موقع کوکی‌های ۳۰ روزه جایگزین‌اند.
- سهمیه‌ی ایمیل بیشتر (Resend). فعلاً در [SECURITY.md](../SECURITY.md) پذیرفته شده است.

**قدم بعدی**
- [#173](https://github.com/pirdehi/xomoni/issues/173): صفحه‌ی ورود دومرحله‌ای.
- [#117](https://github.com/pirdehi/xomoni/pull/117) (انتشار 0.2.0) و [#114](https://github.com/pirdehi/xomoni/pull/114) (صفحه‌ی نصب): هر دو قبل از merge باید rebase شوند.
