import asyncio, sys, json, subprocess, time, os
from playwright.async_api import async_playwright
PORT = 8767
async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', 'www'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 852, 'height': 393}, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = await ctx.new_page()
            page.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
            await page.goto(f'http://localhost:{PORT}/index.html')
            await page.wait_for_function('window.app && window.app.base && window.app.inds.length && window.app.inds[0].res', timeout=60000)
            await page.wait_for_timeout(300)
            await page.screenshot(path='/tmp/ui1.png')
            script = sys.argv[1] if len(sys.argv) > 1 else ''
            if script:
                r = await page.evaluate(script)
                if r is not None: print('RESULT:', r)
                await page.wait_for_timeout(1500)
                await page.screenshot(path='/tmp/ui2.png')
            await b.close()
    finally:
        srv.terminate()
    print('\n'.join(errs) or 'no console errors')
asyncio.run(main())
