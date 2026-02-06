import * as THREE from 'three';

export function setupLighting(scene: THREE.Scene): void {
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
}
