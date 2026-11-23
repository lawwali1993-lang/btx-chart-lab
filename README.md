# BTX Chart Lab

منصة شارت وتدريب تعمل على أندرويد **بدون إنترنت**:

- بيانات الذهب XAUUSD دقيقة واحدة (M1) مع الفوليوم من 2024 حتى الآن (Dukascopy) مدمجة داخل التطبيق.
- محرك **Pine Script** (v4 / v5 / v6): مؤشرات واستراتيجيات TradingView، `request.security`، الجداول، labels/lines/boxes، UDT و methods.
- **مختبر استراتيجيات** مع Bar Magnifier (تنفيذ الأوامر على بيانات الدقيقة)، تقرير أداء كامل وقائمة صفقات.
- **إعادة شمعة بشمعة (Replay)** على أي إطار مع بناء الشمعة الحالية من الدقيقة.
- **تداول تدريبي** بحساب لوت دقيق: سبريد، عمولة، رافعة، هامش، Stop-Out، حساب سنت.
- أدوات رسم: خطوط، فيبوناتشي، قنوات، أدوات مركز شراء/بيع، قياس، نص.
- استيراد أي بيانات CSV (MT5، TradingView، Dukascopy...) وإضافة رموز جديدة.

## البنية
- `www/` تطبيق الويب (Canvas + ES modules) — يعمل داخل WebView.
- `www/js/pine/` المحلل والمفسر ومكتبات ta/math/str/array/strategy.
- `android/` غلاف أندرويد (WebView + WebViewAssetLoader).
- `tools/fetch-data.mjs` جلب بيانات Dukascopy وضغطها بصيغة BTXD.
- `.github/workflows/` بناء APK وتحديث البيانات تلقائياً.

## الاختبارات
```
for t in binfmt data pine-basic pine-adv builtins account compat; do node tests/$t.test.mjs; done
```
