import asyncio, sys, subprocess, time
from playwright.async_api import async_playwright
PORT = 8766
async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', 'www'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = await ctx.new_page()
            page.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error',) else None)
            page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            await page.goto(f'http://localhost:{PORT}/index.html')
            await page.wait_for_timeout(2000)
            # 1. open TF sheet and pick 1h
            await page.click('#btnTf'); await page.wait_for_timeout(300)
            await page.screenshot(path='/tmp/f1_tf.png')
            await page.click('.chip >> text=1h'); await page.wait_for_timeout(500)
            # 2. indicators sheet → add MACD
            await page.click('#btnInd'); await page.wait_for_timeout(300)
            await page.fill('.search', 'MACD'); await page.wait_for_timeout(200)
            await page.screenshot(path='/tmp/f2_ind.png')
            await page.click('.li >> text=MACD'); await page.wait_for_timeout(600)
            # 3. draw a trend line with two taps (mouse emulation of pointer)
            await page.click('#tools [data-tool=trend]')
            await page.mouse.click(150, 300); await page.wait_for_timeout(100)
            await page.mouse.click(300, 200); await page.wait_for_timeout(300)
            n_draw = await page.evaluate('app.drawings.length')
            # 4. pan by drag
            end0 = await page.evaluate('app.chart.endIdx')
            await page.mouse.move(300, 400); await page.mouse.down(); await page.mouse.move(150, 400, steps=8); await page.mouse.up()
            end1 = await page.evaluate('app.chart.endIdx')
            # 5. editor: write a script with an error, run, then fix
            await page.click('#tabs button[data-tab=editor]'); await page.wait_for_timeout(300)
            await page.evaluate("app.editor.set('//@version=5\\nindicator(\"T\")\\nx = ta.sma(close, 10\\nplot(x)')")
            await page.click('text=▶ تشغيل على الشارت'); await page.wait_for_timeout(400)
            err_txt = await page.inner_text('.ed-err')
            await page.screenshot(path='/tmp/f3_edit_err.png')
            await page.evaluate("app.editor.set('//@version=5\\nindicator(\"My RSI Cross\")\\nr = ta.rsi(close, 14)\\nplot(r, color = r > 50 ? color.green : color.red, linewidth = 2)\\nhline(70)\\nhline(30)\\nbgcolor(r > 70 ? color.new(color.red, 85) : na)')")
            await page.click('text=▶ تشغيل على الشارت'); await page.wait_for_timeout(600)
            ok_txt = await page.inner_text('.ed-err')
            await page.screenshot(path='/tmp/f4_edit_ok.png')
            # 6. settings sheet, light theme
            await page.click('#btnSettings'); await page.wait_for_timeout(300)
            await page.select_option('.sheet select >> nth=0', 'light')
            await page.click('.sheet .btn.pri'); await page.wait_for_timeout(500)
            await page.screenshot(path='/tmp/f5_light.png')
            # 7. import CSV
            csv = 'time,open,high,low,close,Volume\n' + '\n'.join(f'{1730000000 + i*3600},{1.08 + i*0.0001:.5f},{1.0810 + i*0.0001:.5f},{1.0795 + i*0.0001:.5f},{1.0805 + i*0.0001:.5f},{100+i}' for i in range(500))
            open('/tmp/EURUSD_H1.csv', 'w').write(csv)
            await page.evaluate("app.sheets.importData()")
            await page.set_input_files('#fileInput', '/tmp/EURUSD_H1.csv'); await page.wait_for_timeout(800)
            await page.screenshot(path='/tmp/f6_import.png')
            await page.click('.sheet .btn.pri'); await page.wait_for_timeout(1500)
            sym = await page.evaluate('app.state.symbol + " " + app.base.length + " " + app.tf.label')
            await page.screenshot(path='/tmp/f7_eur.png')
            print('drawings', n_draw, 'pan', round(end0,1), '->', round(end1,1))
            print('err box:', err_txt.replace('\n',' | ')[:200])
            print('ok box:', ok_txt.replace('\n',' | ')[:200])
            print('symbol after import:', sym)
            await b.close()
    finally:
        srv.terminate()
    print('\n'.join(errs) or 'no console errors')
asyncio.run(main())
