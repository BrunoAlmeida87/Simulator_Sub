/** Linhas de profundidade: padrão de 25 m, espaçamento ajustável nas preferências gráficas, até o fundo. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DepthLines } from '../src/render3d/DepthLines';
import { graphics, DEPTH_LINE_SPACINGS } from '../src/ui/graphics';
import type { Environment } from '../src/sim/environment/environment';

const env = { bottomDepthAt: () => 100 } as unknown as Environment;
const rings = (d: DepthLines) => d.group.children.filter((c) => c instanceof THREE.LineLoop && c.visible).map((c) => -c.position.y);

describe('Linhas de profundidade', () => {
  it('padrão 25 m; valores fora da lista são recusados', () => {
    expect(graphics.get().depthLineSpacing).toBe(25);
    graphics.set({ depthLineSpacing: 7 }, false);
    expect(graphics.get().depthLineSpacing).toBe(25);
    expect(DEPTH_LINE_SPACINGS).toContain(25);
  });

  it('desenha as cotas até o fundo e refaz ao mudar o espaçamento', () => {
    const d = new DepthLines();
    d.update(env, 0, 0, new THREE.Vector3(0, -40, 60), true);
    expect(rings(d)).toEqual([25, 50, 75]);
    d.spacing = 10;
    d.update(env, 0, 0, new THREE.Vector3(0, -40, 60), true);
    expect(rings(d)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    d.update(env, 0, 0, new THREE.Vector3(), false);
    expect(d.group.visible).toBe(false);
  });
});
