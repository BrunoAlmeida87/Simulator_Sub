/** Modelo geométrico didático do sonar. Não altera o motor do submarino. */
export type SonarObjectType = 'ship' | 'submarine' | 'rock' | 'wreck';

export const SONAR_OBJECTS: Record<SonarObjectType, { label: string; noise: number; reflectivity: number }> = {
  ship: { label: 'Navio', noise: 0.85, reflectivity: 0.9 },
  submarine: { label: 'Submarino', noise: 0.45, reflectivity: 0.7 },
  rock: { label: 'Rocha', noise: 0, reflectivity: 0.55 },
  wreck: { label: 'Destroço', noise: 0, reflectivity: 0.75 },
};

export interface SonarContact {
  id: string;
  type: SonarObjectType;
  bearing: number; // graus, norte no topo
  range: number; // metros
  noise: number; // intensidade relativa para o modo passivo
  reflectivity: number; // intensidade relativa para o eco ativo
}

export const SOUND_SPEED = 1500; // m/s, valor aproximado para a demonstração
export const DISPLAY_SPEED = 2; // segundos acústicos por segundo de relógio

export function makeContact(id: string, type: SonarObjectType, bearing: number, range: number): SonarContact {
  return { id, type, bearing, range, noise: SONAR_OBJECTS[type].noise, reflectivity: SONAR_OBJECTS[type].reflectivity };
}

export const INITIAL_CONTACTS: SonarContact[] = [
  makeContact('A', 'ship', 42, 1450),
  makeContact('B', 'submarine', 155, 2900),
  makeContact('C', 'rock', 278, 4400),
];

export function changeObjectType(contact: SonarContact, type: SonarObjectType): SonarContact {
  return { ...contact, type, noise: SONAR_OBJECTS[type].noise, reflectivity: SONAR_OBJECTS[type].reflectivity };
}

export function contactPoint(contact: Pick<SonarContact, 'bearing' | 'range'>, maxRange: number, cx = 300, cy = 300, radius = 260) {
  const angle = (contact.bearing * Math.PI) / 180;
  const r = (contact.range / maxRange) * radius;
  return { x: cx + Math.sin(angle) * r, y: cy - Math.cos(angle) * r };
}

export function pointContact(x: number, y: number, maxRange: number, cx = 300, cy = 300, radius = 260) {
  const dx = x - cx;
  const dy = y - cy;
  return {
    bearing: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
    range: Math.min(maxRange, (Math.hypot(dx, dy) / radius) * maxRange),
  };
}

export function echoTime(range: number, soundSpeed: number) {
  return (2 * range) / soundSpeed;
}

export function passiveLevel(contact: SonarContact, maxRange: number) {
  return Math.min(1, (contact.noise * (maxRange / 2)) / Math.max(contact.range, 500));
}
