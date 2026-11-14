import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

export interface LightingControls {
  setNight(isNight: boolean): void;
  /** Advance the day/night fade. Call once per frame. */
  update(deltaTime: number): void;
}

interface LightPreset {
  sunIntensity: number;
  sunColor: THREE.Color;
  sunHeight: number;
  ambientIntensity: number;
  ambientColor: THREE.Color;
  hemiIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  background: THREE.Color;
}

const DAY: LightPreset = {
  sunIntensity: 1.0,
  sunColor: new THREE.Color(0xffffff),
  sunHeight: 50,
  ambientIntensity: 0.6,
  ambientColor: new THREE.Color(0x404060),
  hemiIntensity: 0.3,
  hemiSky: new THREE.Color(0x87ceeb),
  hemiGround: new THREE.Color(0x7ec850),
  background: new THREE.Color(0x87ceeb),
};

const NIGHT: LightPreset = {
  sunIntensity: 0.15,
  sunColor: new THREE.Color(0x8888cc),
  sunHeight: 20,
  ambientIntensity: 0.3,
  ambientColor: new THREE.Color(0x101030),
  hemiIntensity: 0.1,
  hemiSky: new THREE.Color(0x1a1a3e),
  hemiGround: new THREE.Color(0x0a0a1a),
  background: new THREE.Color(0x0a0a1e),
};

const TRANSITION_SECONDS = 1.2;

// The camera looks along the grid diagonals (and rotates in 90° steps). A sun on
// the same diagonal hides every shadow behind its building and lights both
// visible walls identically, so keep it well off-diagonal.
const SUN_OFFSET_X = 42;
const SUN_OFFSET_Z = 12;

export function setupLighting(scene: THREE.Scene): LightingControls {
  const center = (DEFAULT_GRID_SIZE * CELL_SIZE) / 2;

  // Directional light (sun), aimed at the middle of the plot so the shadow
  // frustum covers the whole grid rather than the corner around the origin
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.target.position.set(center, 0, center);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  scene.add(sun);

  // Ambient fill light
  const ambient = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambient);

  // Hemisphere light for natural sky/ground color
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x7ec850, 0.3);
  scene.add(hemi);

  const background = new THREE.Color();
  scene.background = background;

  let blend = 0;  // 0 = day, 1 = night
  let target = 0;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  function apply(t: number): void {
    sun.intensity = lerp(DAY.sunIntensity, NIGHT.sunIntensity, t);
    sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, t);
    sun.position.set(center + SUN_OFFSET_X, lerp(DAY.sunHeight, NIGHT.sunHeight, t), center + SUN_OFFSET_Z);
    ambient.intensity = lerp(DAY.ambientIntensity, NIGHT.ambientIntensity, t);
    ambient.color.lerpColors(DAY.ambientColor, NIGHT.ambientColor, t);
    hemi.intensity = lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, t);
    hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, t);
    hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, t);
    background.lerpColors(DAY.background, NIGHT.background, t);
  }

  apply(0);

  return {
    setNight(isNight: boolean): void {
      target = isNight ? 1 : 0;

      // Update emissive glow for buildings and cars
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of materials) {
            if (mat instanceof THREE.MeshStandardMaterial && mat.emissive.getHex() !== 0) {
              // Buildings have an emissiveMap, cars only have emissive color
              if (mat.emissiveMap) {
                mat.emissiveIntensity = isNight ? 0.4 : 0;
              } else {
                // Car lights: make them much brighter at night
                mat.emissiveIntensity = isNight ? 2.5 : 0.4;
              }
            }
          }
        }
      });
    },

    update(deltaTime: number): void {
      if (blend === target) return;
      const step = deltaTime / TRANSITION_SECONDS;
      blend = target > blend ? Math.min(target, blend + step) : Math.max(target, blend - step);
      // Smoothstep so the fade eases in and out
      apply(blend * blend * (3 - 2 * blend));
    },
  };
}
