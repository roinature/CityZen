import * as THREE from 'three';

/**
 * Redraws shadow maps only when something that casts a shadow has changed.
 *
 * Almost everything that casts is static (buildings, roof plant, trees, street
 * furniture), yet three redraws every shadow map every frame by default. Each
 * frame this takes a cheap fingerprint of the casters instead (which objects
 * there are, whether they are drawn, where they are, the version of each
 * instance buffer) and of the lights, and asks for a redraw only when it moves.
 * Things that move all the time, such as cars, should not cast at all: they
 * carry a contact shadow of their own instead.
 */
export class ShadowCache {
  private fingerprint = NaN;
  private position = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {}

  /** Call just before rendering with the camera about to be used. */
  update(camera: THREE.Camera): void {
    if (!this.renderer.shadowMap.enabled) {
      this.fingerprint = NaN;
      return;
    }
    let h = camera.layers.mask | 0;
    const mix = (value: number) => {
      h = (Math.imul(h, 31) + (Math.round(value * 1000) | 0)) | 0;
    };
    const lights: THREE.Light[] = [];
    this.scene.traverseVisible(object => {
      if ((object as THREE.Light).isLight && object.castShadow) {
        lights.push(object as THREE.Light);
        mix(object.id);
        this.add(object, mix);
        const target = (object as THREE.DirectionalLight).target;
        if (target) this.add(target, mix);
        return;
      }
      if (!object.castShadow || !(object as THREE.Mesh).isMesh || !object.layers.test(camera.layers)) return;
      mix(object.id);
      this.add(object, mix);
      const instanced = object as THREE.InstancedMesh;
      if (instanced.isInstancedMesh) {
        mix(instanced.count);
        mix(instanced.instanceMatrix.version);
      }
    });

    const changed = h !== this.fingerprint;
    this.fingerprint = h;
    for (const light of lights) {
      const shadow = light.shadow!;
      shadow.autoUpdate = false;
      if (changed) shadow.needsUpdate = true;
    }
  }

  /** Forget the last fingerprint, so the next frame redraws every shadow map. */
  invalidate(): void {
    this.fingerprint = NaN;
  }

  private add(object: THREE.Object3D, mix: (value: number) => void): void {
    const e = object.matrixWorld.elements;
    this.position.set(e[12], e[13], e[14]);
    mix(this.position.x);
    mix(this.position.y);
    mix(this.position.z);
    // Rotation and scale, through two columns of the matrix.
    mix(e[0] + e[1] * 3 + e[2] * 7);
    mix(e[8] + e[9] * 3 + e[10] * 7);
  }
}
