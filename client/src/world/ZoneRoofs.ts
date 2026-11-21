import * as THREE from 'three';
import { BuildingType } from '@cityzen/shared';

const HOUSE_ROOFS = [0xa24e38, 0xc16c48, 0xa85b43];

export function addZoneRoof(
  group: THREE.Group,
  type: BuildingType,
  { x, y, z, width, depth, tall }: {
    x: number; y: number; z: number; width: number; depth: number; tall: boolean;
  },
  variant: number,
): void {
  const w = width * 1.12;
  const d = depth * 1.12;
  const material = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92 });
  const add = (geometry: THREE.BufferGeometry, color: number, py: number, pz: number): void => {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const house = type === BuildingType.ZONE_RESIDENTIAL && !tall;
  if (house || type === BuildingType.ZONE_INDUSTRIAL) {
    const profile = new THREE.Shape();
    const rise = Math.max(house ? 0.16 : 0.12, w * (house ? 0.53 : 0.38));
    profile.moveTo(-w / 2, -0.015);
    profile.lineTo(w / 2, -0.015);
    if (house) {
      profile.lineTo(0, rise);
    } else {
      // Two sawtooth bays make the workshop distinct from the pitched houses.
      profile.lineTo(w / 2, rise);
      profile.lineTo(0, 0);
      profile.lineTo(0, rise);
    }
    profile.closePath();
    const geometry = new THREE.ExtrudeGeometry(profile, { depth: d, bevelEnabled: false });
    add(geometry, house ? HOUSE_ROOFS[variant % HOUSE_ROOFS.length] : 0xc39b60, y, z - d / 2);
    return;
  }

  // Pale coping outlines a darker raised cap on shops and taller buildings.
  add(new THREE.BoxGeometry(w, 0.085, d), 0xc1b8a7, y + 0.041, z);
  add(new THREE.BoxGeometry(w * 0.74, 0.15, d * 0.72), 0x56858a, y + 0.155, z);
}
