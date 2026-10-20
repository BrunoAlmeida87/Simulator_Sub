/** Aparência visual corrente (identificação + preferências gráficas) para a cena 3D e os painéis. */
import { useEffect, useReducer } from 'react';
import { identity, type Identity } from './identity';
import { graphics } from './graphics';
import type { Appearance } from '../render3d/sailArt';

export function currentAppearance(): Appearance {
  const i = identity.get();
  return { ...i, textures: graphics.get().textures };
}

/** número que muda sempre que a aparência muda */
export const appearanceRev = () => identity.rev * 1000 + graphics.rev;

/** Re-renderiza quando a identificação muda. */
export function useIdentity(): Identity {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => identity.subscribe(f), []);
  return identity.get();
}
