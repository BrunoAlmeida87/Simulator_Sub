/** Assina o estado da central de operação (grupos abertos, fixados, foco). */
import { useEffect, useReducer } from 'react';
import { opsBus } from './opsBus';

export function useOpsBus() {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => opsBus.subscribe(f), []);
  return opsBus;
}
