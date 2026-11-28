import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

export interface LightingControls {
  setNight(isNight: boolean): void;
  /** Advance the day/night fade. Call once per frame. */
  update(deltaTime: number): void;
  /** Where the fade is: 0 day .. 1 night, eased. */
  getNight(): number;
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
  sunIntensity: 2.75,
  sunColor: new THREE.Color(0xfff0d6),
  sunHeight: 46,
  ambientIntensity: 0.14,
  ambientColor: new THREE.Color(0xc8dcff),
  hemiIntensity: 1.55,
  hemiSky: new THREE.Color(0x9ec5ff),
  hemiGround: new THREE.Color(0x4d5a70),
  background: new THREE.Color(0xc6d8ec),
};

const NIGHT: LightPreset = {
  sunIntensity: 0.9,
  sunColor: new THREE.Color(0x9db0e6),
  sunHeight: 62,
  ambientIntensity: 0.1,
  ambientColor: new THREE.Color(0x404a80),
  hemiIntensity: 0.9,
  hemiSky: new THREE.Color(0x5a6aa8),
  hemiGround: new THREE.Color(0x1c2438),
  background: new THREE.Color(0x131b33),
};

const TRANSITION_SECONDS = 1.2;

// The camera looks along the grid diagonals (and rotates in 90° steps). A sun on
// the same diagonal hides every shadow behind its building and lights both
// visible walls identically, so keep it well off-diagonal.
const SUN_OFFSET_X = -52;
const SUN_OFFSET_Z = 24;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vWorldDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise2(p);
      p = p * 2.04 + vec2(17.1, 31.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float elev = clamp(dir.y, -0.2, 1.0);

    // Day sky: crisp sunlit blue zenith fading to pale atmospheric haze at the horizon
    vec3 dayZenith = vec3(0.14, 0.38, 0.82);
    vec3 dayMid = vec3(0.42, 0.66, 0.93);
    vec3 dayHorizon = vec3(0.79, 0.87, 0.96);
    vec3 dayGround = vec3(0.28, 0.34, 0.42);

    vec3 daySky = mix(dayHorizon, dayMid, smoothstep(0.0, 0.28, elev));
    daySky = mix(daySky, dayZenith, smoothstep(0.22, 0.85, elev));
    daySky = mix(dayGround, daySky, smoothstep(-0.08, 0.02, elev));

    // Warm golden glow near the sun
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    daySky += vec3(1.0, 0.84, 0.62) * pow(sunDot, 7.0) * 0.32 * smoothstep(-0.05, 0.15, elev);
    daySky += vec3(1.0, 0.96, 0.88) * smoothstep(0.996, 0.9995, sunDot) * 1.4;

    // Soft layered clouds in the upper hemisphere
    if (elev > 0.02) {
      vec2 uv = dir.xz / (elev + 0.18) * 1.15 + vec2(uTime * 0.004, uTime * 0.002);
      float c = fbm(uv);
      float c2 = fbm(uv * 2.2 - vec2(uTime * 0.003, 0.0));
      float cloud = smoothstep(0.48, 0.78, c * 0.72 + c2 * 0.28);
      float horizonFade = smoothstep(0.02, 0.18, elev) * (1.0 - smoothstep(0.75, 0.98, elev) * 0.35);
      vec3 cloudLit = mix(vec3(0.84, 0.90, 0.98), vec3(1.0, 0.97, 0.92), 0.55 + 0.45 * pow(sunDot, 3.0));
      vec3 cloudShade = vec3(0.58, 0.68, 0.82);
      vec3 cloudColor = mix(cloudShade, cloudLit, smoothstep(0.45, 0.78, c));
      daySky = mix(daySky, cloudColor, cloud * horizonFade * 0.78);
    }

    // Night sky: deep navy with subtle horizon glow and crisp stars
    vec3 nightZenith = vec3(0.015, 0.025, 0.07);
    vec3 nightHorizon = vec3(0.06, 0.09, 0.19);
    vec3 nightSky = mix(nightHorizon, nightZenith, smoothstep(0.0, 0.65, elev));
    nightSky = mix(vec3(0.03, 0.04, 0.08), nightSky, smoothstep(-0.05, 0.02, elev));
    if (elev > 0.08 && uNight > 0.05) {
      vec2 starGrid = floor(dir.xz / (elev + 0.1) * 95.0);
      float star = step(0.992, hash21(starGrid)) * smoothstep(0.08, 0.35, elev);
      nightSky += vec3(0.75, 0.85, 1.0) * star * 0.9;
    }

    vec3 col = mix(daySky, nightSky, uNight);
    gl_FragColor = vec4(col, 1.0);
  }`;

function createSkyDome(sunDir: THREE.Vector3): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20), material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, material };
}

function bakeSkyEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3, night: number): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const { mesh, material } = createSkyDome(sunDir);
  material.uniforms.uNight.value = night;
  envScene.add(mesh);
  const rt = pmrem.fromScene(envScene, 0.02);
  mesh.geometry.dispose();
  material.dispose();
  pmrem.dispose();
  return rt.texture;
}

export function setupLighting(scene: THREE.Scene, renderer?: THREE.WebGLRenderer): LightingControls {
  const center = (DEFAULT_GRID_SIZE * CELL_SIZE) / 2;

  // Directional light (sun), aimed at the middle of the plot so the shadow
  // frustum covers the whole grid rather than the corner around the origin
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.target.position.set(center, 0, center);
  scene.add(sun.target);
  sun.castShadow = true;
  const shadowSize = matchMedia('(pointer: coarse)').matches ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
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

  const sunDir = new THREE.Vector3(SUN_OFFSET_X, DAY.sunHeight, SUN_OFFSET_Z).normalize();
  const sky = createSkyDome(sunDir);
  sky.mesh.position.set(center, 0, center);
  scene.add(sky.mesh);

  // Pre-baked sky environment maps (IBL) for crisp PBR reflections on cars, glass, and asphalt
  const dayEnv = renderer ? bakeSkyEnvironment(renderer, sunDir, 0) : null;
  const nightEnv = renderer ? bakeSkyEnvironment(renderer, sunDir, 1) : null;
  if (dayEnv) {
    scene.environment = dayEnv;
    scene.environmentIntensity = 0.9;
  }

  let blend = 0;  // 0 = day, 1 = night
  let target = 0;
  let eased = 0;
  let elapsed = 0;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  function apply(t: number): void {
    sun.intensity = lerp(DAY.sunIntensity, NIGHT.sunIntensity, t);
    sun.color.lerpColors(DAY.sunColor, NIGHT.sunColor, t);
    const sunY = lerp(DAY.sunHeight, NIGHT.sunHeight, t);
    sun.position.set(center + SUN_OFFSET_X, sunY, center + SUN_OFFSET_Z);
    ambient.intensity = lerp(DAY.ambientIntensity, NIGHT.ambientIntensity, t);
    ambient.color.lerpColors(DAY.ambientColor, NIGHT.ambientColor, t);
    hemi.intensity = lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, t);
    hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, t);
    hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, t);
    background.lerpColors(DAY.background, NIGHT.background, t);
    sky.material.uniforms.uNight.value = t;
    sky.material.uniforms.uSunDir.value.set(SUN_OFFSET_X, sunY, SUN_OFFSET_Z).normalize();
    if (dayEnv && nightEnv) {
      scene.environment = t > 0.5 ? nightEnv : dayEnv;
      scene.environmentIntensity = lerp(0.9, 0.35, t);
    }
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
              if (mat.userData?.alwaysEmissive) continue;
              // Buildings have an emissiveMap, cars only have emissive color
              if (mat.emissiveMap) {
                mat.emissiveIntensity = isNight ? 0.4 : 0;
              } else {
                // Car lights: keep crisp daytime LED glow, brighter at night
                mat.emissiveIntensity = isNight ? 2.8 : 1.15;
              }
            }
          }
        }
      });
    },

    update(deltaTime: number): void {
      elapsed += deltaTime;
      sky.material.uniforms.uTime.value = elapsed;
      if (blend === target) return;
      const step = deltaTime / TRANSITION_SECONDS;
      blend = target > blend ? Math.min(target, blend + step) : Math.max(target, blend - step);
      // Smoothstep so the fade eases in and out
      eased = blend * blend * (3 - 2 * blend);
      apply(eased);
    },

    getNight(): number {
      return eased;
    },
  };
}
