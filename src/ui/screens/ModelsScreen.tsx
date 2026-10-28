import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { MODEL_ASSETS, modelUrl, disposeModel } from '../../render3d/modelAssets';

const fleetModel = MODEL_ASSETS.find((asset) => asset.id === 'frota')!;
const fleetMembers = ['convencional', 'asd', 'voith'].map((id) => MODEL_ASSETS.find((asset) => asset.id === id)!);

export function ModelsScreen() {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ frame: (view?: string) => void; zoom: (factor: number) => void }>();
  const options = useRef({ rotate: false, grid: true, wire: false });
  const [rotate, setRotate] = useState(false);
  const [grid, setGrid] = useState(true);
  const [wire, setWire] = useState(false);
  const [selected, setSelected] = useState(modelUrl(MODEL_ASSETS[0].file));
  const [lastFleetMember, setLastFleetMember] = useState(modelUrl(fleetMembers[0].file));
  const fleetTogether = selected === modelUrl(fleetModel.file);
  const fleetSeparate = fleetMembers.some((asset) => selected === modelUrl(asset.file));
  const selectModel = (url: string) => {
    setSelected(url);
    if (fleetMembers.some((asset) => url === modelUrl(asset.file))) setLastFleetMember(url);
  };
  const [local, setLocal] = useState<{ name: string; url: string }[]>([]);
  const localRef = useRef(local);
  localRef.current = local;
  const [status, setStatus] = useState('Selecione um modelo do catálogo ou abra arquivos GLB do seu computador.');
  options.current = { rotate, grid, wire };
  useEffect(() => () => localRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus('Não foi possível iniciar o 3D. Verifique o suporte a WebGL do navegador.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#101d2a');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 200;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x526779, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(5, 10, 8);
    scene.add(light);
    const floor = new THREE.GridHelper(20, 20, 0x688ca1, 0x2c4558);
    scene.add(floor);
    let model: THREE.Group | undefined;
    let cancelled = false;
    const frame = (view = 'perspectiva') => {
      const distance = 6 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(camera.aspect, 1);
      const direction = view === 'topo' ? new THREE.Vector3(0, 1, 0.001) : view === 'frente' ? new THREE.Vector3(0, 0, -1) : view === 'lado' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, 0.65, 1);
      controls.target.set(0, 0, 0);
      camera.position.copy(direction.normalize().multiplyScalar(distance));
      controls.update();
    };
    actions.current = {
      frame,
      zoom: (factor) => {
        const offset = camera.position.clone().sub(controls.target);
        offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
    };
    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(() => { resize(); frame(); });
    observer.observe(container);
    resize();
    frame();
    if (!selected) setStatus('Selecione um modelo do catálogo ou abra arquivos GLB do seu computador.');
    if (selected) {
      setStatus('Carregando modelo…');
      new GLTFLoader().load(selected, (gltf) => {
        if (cancelled) { disposeModel(gltf.scene); return; }
        model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(extent) || extent <= 0) {
          disposeModel(model);
          model = undefined;
          setStatus('O arquivo não contém geometria 3D visível.');
          return;
        }
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 10 / extent;
        const wrapper = new THREE.Group();
        wrapper.add(model);
        wrapper.scale.setScalar(scale);
        wrapper.position.copy(center.multiplyScalar(-scale));
        scene.add(wrapper);
        floor.position.y = -size.y * scale / 2;
        frame();
        setStatus(`Modelo carregado · dimensões originais: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} unidades`);
      }, undefined, () => {
        if (!cancelled) setStatus('Modelo indisponível ou inválido. Abra um GLB local ou instale o arquivo na pasta public/models do projeto.');
      });
    }
    let raf = 0;
    let previousWire: boolean | undefined;
    const clock = new THREE.Clock();
    const animate = () => {
      controls.autoRotate = options.current.rotate;
      floor.visible = options.current.grid;
      if (previousWire !== options.current.wire && model) {
        previousWire = options.current.wire;
        model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if ('wireframe' in material) material.wireframe = options.current.wire;
        }
        });
      }
      controls.update(Math.min(clock.getDelta(), 0.1));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      actions.current = undefined;
      controls.dispose();
      if (model) disposeModel(model);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [selected]);

  return <section>
    <h2>Modelos 3D</h2>
    <p>Explore os modelos com rotação, zoom e deslocamento da câmera.</p>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      <label>Modelo <select aria-label="Modelo" value={selected} onChange={(event) => selectModel(event.target.value)}>
        <option value="">Selecione um modelo</option>
        {MODEL_ASSETS.map((item) => <option key={item.file} value={modelUrl(item.file)}>{item.name}</option>)}
        {local.map((item) => <option key={item.url} value={item.url}>{item.name} (local)</option>)}
      </select></label>
      <label className="btn">Abrir GLB <input type="file" accept=".glb" multiple style={{ maxWidth: 240 }} onChange={(event) => {
        const files = Array.from(event.target.files ?? []).filter((file) => /\.glb$/i.test(file.name));
        const added = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
        setLocal((previous) => [...previous, ...added]);
        if (added.length) setSelected(added[0].url);
        event.target.value = '';
      }} /></label>
    </div>
    <fieldset style={{ margin: '0 0 12px', padding: 12, border: '1px solid #2c4558', borderRadius: 8, minWidth: 0 }}>
      <legend>Frota de rebocadores</legend>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className={`btn ${fleetTogether ? 'on' : ''}`} aria-pressed={fleetTogether} onClick={() => selectModel(modelUrl(fleetModel.file))}>Ver juntos</button>
        <button className={`btn ${fleetSeparate ? 'on' : ''}`} aria-pressed={fleetSeparate} onClick={() => selectModel(lastFleetMember)}>Ver separados</button>
        {fleetSeparate && <label>Rebocador <select aria-label="Rebocador da frota" value={selected} onChange={(event) => selectModel(event.target.value)}>
          {fleetMembers.map((asset) => <option key={asset.id} value={modelUrl(asset.file)}>{asset.name}</option>)}
        </select></label>}
      </div>
      <p style={{ marginBottom: 0 }}>{fleetTogether ? 'Os três rebocadores no conjunto original.' : fleetSeparate ? 'Exibindo um rebocador por vez, com enquadramento individual. Selecione acima qual deseja explorar.' : 'Veja o conjunto completo ou explore cada um dos três rebocadores individualmente.'}</p>
    </fieldset>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {['perspectiva', 'frente', 'lado', 'topo'].map((view) => <button className="btn" key={view} onClick={() => actions.current?.frame(view)}>{view}</button>)}
      <button className="btn" onClick={() => { host.current?.requestFullscreen?.().catch(() => setStatus('Tela cheia indisponível neste navegador.')); }}>Tela cheia</button>
      <button className="btn" onClick={() => actions.current?.frame()}>Reenquadrar</button>
      <button className="btn" onClick={() => actions.current?.zoom(0.8)}>Aproximar</button>
      <button className="btn" onClick={() => actions.current?.zoom(1.25)}>Afastar</button>
      <label><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> Rotação automática</label>
      <label><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grade</label>
      <label><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> Malha</label>
    </div>
    <p role="status">{status}</p>
    <div ref={host} style={{ height: '60vh', minHeight: 320, overflow: 'hidden', borderRadius: 8, touchAction: 'none' }} aria-label="Visualizador de modelos 3D" />
    <p>Arraste para girar; use a roda do mouse para zoom e o botão direito para deslocar. No celular, use um dedo para girar e dois para zoom e deslocamento.</p>
    <p>Arquivos locais ficam disponíveis somente nesta tela até sair da aba. Para incluir modelos permanentemente no sistema, adicione os GLB ao projeto.</p>
  </section>;
}
