from playwright.sync_api import sync_playwright
import sys
from pathlib import Path
OUTPUT = Path(__file__).resolve().parents[1] / "docs/img/efeitos-submersos"
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 page.goto('http://127.0.0.1:5173/scripts/preview-underwater.html?mode=deep')
 page.wait_for_function('window.ready===true')
 page.wait_for_timeout(2500)
 page.evaluate('''() => {
  const {e,scene}=preview;
  e.env.cfg.bottom.baseDepth=84;
  scene.layers.trail=true;
  e.state.nav.trail=Array.from({length:180},(_,i)=>({n:-180+i,e:20*Math.sin(i/28),z:Math.min(80,12+i*.6)}));
  scene.setCameraPose({pos:[110,150,170],target:[0,30,50]});
  document.querySelector('#title').textContent='Trajetória submersa · câmera acima da água';
  document.querySelector('#detail').textContent='Eixo a 80 m · fundo a 84 m · câmera a 70 m acima da superfície';
  scene.render();
 }''')
 page.screenshot(path=str(OUTPUT / ('trail-'+(sys.argv[1] if len(sys.argv)>1 else 'after')+'.png')))
 browser.close()
