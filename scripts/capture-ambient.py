"""Prévia determinística: Vite na porta 5173, Playwright e Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT = Path(__file__).resolve().parents[1] / 'docs/img/ambiente-vivo'
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text + ' ' + str(m.location)) if m.type=='error' and not m.location.get('url','').endswith('/favicon.ico') else None)
    page.goto('http://127.0.0.1:5173/scripts/preview-underwater.html?mode=near')
    page.wait_for_function('window.ready===true')
    page.wait_for_timeout(1800)
    page.evaluate('''() => {
      const {scene,e}=preview;
      e.state.body.vel.x=0;e.state.propulsion.omega=0;e.state.propulsion.thrust=0;
      scene.ambientSettings={ambientMotion:'moderado',currentDirection:70,bottomLifeDensity:'moderada'};
      scene.marineLife.settings={...scene.marineLife.settings,...scene.ambientSettings};
      scene.setCameraPose({pos:[48,8,48],target:[0,-3,0]});
      document.querySelector('#title').textContent='Ambiente vivo · submarino parado';
      document.querySelector('#detail').textContent='Deriva e oscilação · rochas, esponjas e vegetação rasa · corrente apenas visual';
      window.sampleAmbient = t => {e.state.t=t;scene.render();return Array.from(scene.snow.points.geometry.attributes.position.array)};
      sampleAmbient(20);
    }''')
    page.screenshot(path=str(OUT/'raso.png'))
    a=page.evaluate('sampleAmbient(20)');b=page.evaluate('sampleAmbient(25)');c=page.evaluate('sampleAmbient(25)')
    assert a!=b, 'Partículas congeladas com submarino parado'
    assert b==c, 'Partículas mudaram durante pausa'
    assert page.evaluate('preview.scene.bottomLife.plants.count')>0
    page.evaluate('''() => {const {e,scene}=preview;e.env.cfg.bottom.baseDepth=120;e.state.body.pos.z=115;e.prevPos={...e.state.body.pos};scene.setCameraPose({pos:[48,8,48],target:[0,-3,0]});sampleAmbient(25)}''')
    assert page.evaluate('preview.scene.bottomLife.plants.count')==0
    page.screenshot(path=str(OUT/'profundo.png'))
    page.evaluate('preview.scene.layers.noWater=true;preview.scene.render()')
    assert page.evaluate('!preview.scene.bottomLife.group.visible && !preview.scene.snow.points.visible')
    page.add_init_script("localStorage.setItem('sx1.prefs.v2',JSON.stringify({screen:'config',eng:false}))")
    page.goto('http://127.0.0.1:5173')
    panel=page.locator('section.panel').filter(has=page.get_by_role('heading',name='Vida marinha e ambiente submarino',exact=True))
    panel.wait_for();panel.screenshot(path=str(OUT/'configuracoes.png'))
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'Rolagem horizontal no celular'
    print('Parado: movimento; pausa: estável; plantas: só rasas; sem água: oculto; celular: OK.')
    print('Erros:', errors)
    assert not errors
    browser.close()
