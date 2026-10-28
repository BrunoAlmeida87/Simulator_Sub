"""Com Vite na porta 5173: python scripts/capture-underwater.py (Playwright + Chromium)."""
from playwright.sync_api import sync_playwright
import json
from pathlib import Path
OUTPUT = Path(__file__).resolve().parents[1] / "docs/img/efeitos-submersos"
OUTPUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 for mode in ['cavitation','deep','near','contact']:
  page.goto('http://127.0.0.1:5173/scripts/preview-underwater.html?mode='+mode)
  page.wait_for_function('window.ready===true')
  page.wait_for_timeout(2500)
  print(mode,page.evaluate('window.advancePreview('+('1.2' if mode=='contact' else '8')+')'),flush=True)
  page.screenshot(path=str(OUTPUT / (mode+'.png')))
 print('errors',json.dumps(errors))
 browser.close()
