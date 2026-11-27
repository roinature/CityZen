import * as THREE from 'three';

export type PinState = 'available' | 'claimed' | 'yours';

export interface GlobePin {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  state: PinState;
}

interface View { lat: number; lon: number; dist: number }

const PIN_COLORS: Record<PinState, number> = { available: 0x9be39a, claimed: 0x6cb8ff, yours: 0xffcf5a };
const MIN_DIST = 1.45;
const MAX_DIST = 6;
const DEG = Math.PI / 180;

/** Unit-sphere position matching THREE.SphereGeometry's equirectangular UVs. */
function toVector(latitude: number, longitude: number, radius = 1) {
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius);
}

const wrap = (degrees: number) => ((degrees + 540) % 360) - 180;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Interactive Earth: drag to spin, wheel or pinch to zoom, click a pin to pick a site. */
export class EarthGlobe {
  onPick?: (id: string) => void;
  /** Fires once the user drags or zooms, so callers can stop auto-framing. */
  onInteract?: () => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private globe = new THREE.Group();
  private pins = new Map<string, { group: THREE.Group; head: THREE.Mesh; pin: GlobePin }>();
  private hitTargets: THREE.Object3D[] = [];
  private userMarker: THREE.Group;
  private selectedRing: THREE.Mesh;
  private selectedId?: string;
  private view: View = { lat: 20, lon: 0, dist: MAX_DIST };
  private tween?: { from: View; to: View; start: number; duration: number; arc: number };
  private frame = 0;
  private running = false;
  private tooltip: HTMLDivElement;
  private hoverId?: string;
  private raycaster = new THREE.Raycaster();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDistance = 0;
  private pinchStart?: { gap: number; dist: number };

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'earth-globe-canvas';
    this.container.append(this.renderer.domElement);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'earth-globe-tooltip';
    this.tooltip.hidden = true;
    this.container.append(this.tooltip);

    const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth.jpg`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }),
    );
    this.globe.add(earth);
    this.scene.add(this.globe, this.createAtmosphere());

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-2, 1.5, 3);
    this.camera.add(sun);
    this.scene.add(this.camera);

    this.userMarker = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff6b6b }));
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.name = 'halo';
    this.userMarker.add(dot, halo);
    this.userMarker.visible = false;
    this.globe.add(this.userMarker);

    this.selectedRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.9, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.selectedRing.visible = false;
    this.globe.add(this.selectedRing);

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
  }

  private createAtmosphere() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vNormal; void main() { float i = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.36, 0.66, 1.0, 1.0) * i; }`,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 48), material);
  }

  setPins(pins: GlobePin[]) {
    const seen = new Set<string>();
    for (const pin of pins) {
      seen.add(pin.id);
      let entry = this.pins.get(pin.id);
      if (!entry) {
        const group = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), new THREE.MeshBasicMaterial({ color: 0xf4f7f2 }));
        stem.position.y = 0.8;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
        head.position.y = 1.8;
        const hit = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 1.4;
        hit.userData.siteId = pin.id;
        group.add(stem, head, hit);
        group.position.copy(toVector(pin.latitude, pin.longitude));
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), group.position.clone().normalize());
        this.globe.add(group);
        this.hitTargets.push(hit);
        entry = { group, head, pin };
        this.pins.set(pin.id, entry);
      }
      entry.pin = pin;
      const material = entry.head.material as THREE.MeshStandardMaterial;
      material.color.setHex(PIN_COLORS[pin.state]);
      material.emissive.setHex(PIN_COLORS[pin.state]).multiplyScalar(0.35);
    }
    for (const [id, entry] of this.pins) {
      if (seen.has(id)) continue;
      this.globe.remove(entry.group);
      this.hitTargets = this.hitTargets.filter(target => target.parent !== entry.group);
      this.pins.delete(id);
    }
  }

  setSelected(id?: string) {
    this.selectedId = id;
    const entry = id ? this.pins.get(id) : undefined;
    this.selectedRing.visible = !!entry;
    if (entry) this.placeOnSurface(this.selectedRing, entry.pin.latitude, entry.pin.longitude);
  }

  setUserLocation(latitude: number, longitude: number) {
    this.userMarker.visible = true;
    this.placeOnSurface(this.userMarker, latitude, longitude);
  }

  private placeOnSurface(object: THREE.Object3D, latitude: number, longitude: number) {
    const normal = toVector(latitude, longitude);
    object.position.copy(normal).multiplyScalar(1.002);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }

  /** Jump instantly, e.g. to start an intro flight from a far-away vantage point. */
  setView(lat: number, lon: number, dist: number) {
    this.tween = undefined;
    this.view = { lat, lon: wrap(lon), dist };
  }

  /** Fly to a point, rising higher for long trips. */
  flyTo(lat: number, lon: number, dist = this.view.dist, duration = 1400) {
    const from = { ...this.view };
    const to = { lat: Math.max(-75, Math.min(75, lat)), lon: from.lon + wrap(lon - from.lon), dist: Math.max(MIN_DIST, Math.min(MAX_DIST, dist)) };
    const angle = Math.acos(Math.max(-1, Math.min(1, toVector(from.lat, from.lon).dot(toVector(to.lat, to.lon)))));
    const arc = Math.max(0, angle / Math.PI * 2.4 - Math.abs(to.dist - from.dist) * 0.4);
    this.tween = { from, to, start: performance.now(), duration: duration * (0.6 + angle / Math.PI), arc };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.update(performance.now());
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private update(now: number) {
    if (this.tween) {
      const { from, to, start, duration, arc } = this.tween;
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      this.view = {
        lat: from.lat + (to.lat - from.lat) * e,
        lon: from.lon + (to.lon - from.lon) * e,
        dist: from.dist + (to.dist - from.dist) * e + arc * Math.sin(Math.PI * e),
      };
      if (t >= 1) this.tween = undefined;
    }
    this.globe.rotation.set(this.view.lat * DEG, -Math.PI / 2 - this.view.lon * DEG, 0);
    this.camera.position.set(0, 0, this.view.dist);
    this.camera.lookAt(0, 0, 0);

    const scale = 0.011 * (this.view.dist - 0.6);
    const pulse = 1 + 0.25 * Math.sin(now / 260);
    for (const [id, { group }] of this.pins) {
      group.scale.setScalar(scale * (id === this.selectedId ? 1.35 : id === this.hoverId ? 1.2 : 1));
    }
    this.selectedRing.scale.setScalar(scale * pulse);
    this.userMarker.scale.setScalar(scale);
    const halo = this.userMarker.getObjectByName('halo');
    if (halo) {
      halo.scale.setScalar(1 + ((now / 1400) % 1) * 1.6);
      ((halo as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ((now / 1400) % 1));
    }
    this.updateTooltip();
  }

  private updateTooltip() {
    const id = this.hoverId ?? this.selectedId;
    const entry = id ? this.pins.get(id) : undefined;
    if (!entry) { this.tooltip.hidden = true; return; }
    this.globe.updateMatrixWorld();
    const world = entry.group.localToWorld(new THREE.Vector3(0, 2.6, 0));
    const facing = world.clone().normalize().dot(this.camera.position.clone().sub(world).normalize());
    if (facing < 0.05) { this.tooltip.hidden = true; return; }
    const projected = world.project(this.camera);
    this.tooltip.hidden = false;
    this.tooltip.textContent = entry.pin.label;
    this.tooltip.style.transform =
      `translate(${(projected.x + 1) / 2 * this.container.clientWidth}px, ${(1 - projected.y) / 2 * this.container.clientHeight}px) translate(-50%, -100%)`;
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private pick(event: PointerEvent): string | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.globe.children[0], ...this.hitTargets], false);
    // The first hit being the earth itself means the pin is around the back of the globe.
    return hits[0]?.object.userData.siteId as string | undefined;
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragDistance = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { gap: Math.hypot(a.x - b.x, a.y - b.y), dist: this.view.dist };
      }
    });
    canvas.addEventListener('pointermove', event => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) {
        const id = this.pick(event);
        if (id !== this.hoverId) {
          this.hoverId = id;
          canvas.style.cursor = id ? 'pointer' : 'grab';
        }
        return;
      }
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance < 4) return;
      this.tween = undefined;
      this.onInteract?.();
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        this.view.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.pinchStart.dist * this.pinchStart.gap / Math.max(1, gap)));
        return;
      }
      const degreesPerPixel = (this.view.dist - 0.9) * 60 / this.container.clientHeight;
      this.view.lon = wrap(this.view.lon - dx * degreesPerPixel);
      this.view.lat = Math.max(-80, Math.min(80, this.view.lat + dy * degreesPerPixel));
    });
    const release = (event: PointerEvent) => {
      const wasClick = this.pointers.size === 1 && this.dragDistance < 4;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinchStart = undefined;
      if (wasClick && event.type === 'pointerup') {
        const id = this.pick(event);
        if (id) this.onPick?.(id);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) this.hoverId = undefined; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.tween = undefined;
      this.onInteract?.();
      this.view.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.view.dist * Math.exp(event.deltaY * 0.0015)));
    }, { passive: false });
  }
}
