import * as THREE from 'three';

export interface LightingControls {
  setNight(isNight: boolean): void;
}

export function setupLighting(scene: THREE.Scene): LightingControls {
  // Directional light (sun)
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(30, 50, 30);
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

  return {
    setNight(isNight: boolean): void {
      if (isNight) {
        sun.intensity = 0.15;
        sun.color.setHex(0x8888cc);
        sun.position.set(30, 20, 30);
        ambient.intensity = 0.3;
        ambient.color.setHex(0x101030);
        hemi.intensity = 0.1;
        hemi.color.setHex(0x1a1a3e);
        hemi.groundColor.setHex(0x0a0a1a);
        scene.background = new THREE.Color(0x0a0a1e);
      } else {
        sun.intensity = 1.0;
        sun.color.setHex(0xffffff);
        sun.position.set(30, 50, 30);
        ambient.intensity = 0.6;
        ambient.color.setHex(0x404060);
        hemi.intensity = 0.3;
        hemi.color.setHex(0x87ceeb);
        hemi.groundColor.setHex(0x7ec850);
        scene.background = null;
      }

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
  };
}
