import * as THREE from 'three';

/**
 * The picture after the scene is drawn. The scene goes into a multisampled
 * half-float buffer, so lit windows and headlights can be brighter than white;
 * the glow feeds on exactly those. Then one pass over the screen adds the glow,
 * tone maps (the renderer's own ACES and exposure), and grades: a touch more
 * contrast and colour, warm lights and cool shadows, darker corners, and fine
 * grain against banding in skies and night gradients.
 *
 * The glow: the bright parts at half size, halved again and again (each step a
 * wider, softer copy), then added back together on the way up. Adapted from
 * manhattan-free-roam (MIT, see THIRD_PARTY_NOTICES.md).
 *
 * With effects off the scene still goes through the buffer, for its
 * antialiasing, and is only tone mapped on the way out.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** How many times the bright parts are halved, and how much of each size goes into the glow. */
const LEVELS = 7;
const WEIGHTS = [0, 0.5, 0.4, 0.4, 0.4, 0.5, 0.5];

// What is brighter than the threshold, at half size. Each of the four pixels is
// judged on its own, so a single bright lamp is not lost among dark neighbours.
const BRIGHT = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uTexel;
  uniform float uThreshold, uKnee;
  varying vec2 vUv;
  vec3 bright(vec2 at) {
    vec3 c = max(texture2D(tMap, at).rgb, 0.0);
    return c * smoothstep(uThreshold, uThreshold + uKnee, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  }
  void main() {
    vec2 o = uTexel * 0.5;
    vec3 c = bright(vUv + vec2(-o.x, -o.y)) + bright(vUv + vec2(o.x, -o.y))
      + bright(vUv + vec2(-o.x, o.y)) + bright(vUv + o);
    gl_FragColor = vec4(min(c * 0.25, vec3(16.0)), 1.0);
  }`;

// To half size through a wide, soft, thirteen-tap filter, so nothing flickers as it moves.
const SHRINK = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 at(float x, float y) { return texture2D(tMap, vUv + vec2(x, y) * uTexel).rgb; }
  void main() {
    vec3 c = at(0.0, 0.0) * 0.125;
    c += (at(-1.0, -1.0) + at(1.0, -1.0) + at(-1.0, 1.0) + at(1.0, 1.0)) * 0.125;
    c += (at(-2.0, 0.0) + at(2.0, 0.0) + at(0.0, -2.0) + at(0.0, 2.0)) * 0.0625;
    c += (at(-2.0, -2.0) + at(2.0, -2.0) + at(-2.0, 2.0) + at(2.0, 2.0)) * 0.03125;
    gl_FragColor = vec4(c, 1.0);
  }`;

// Back up one size, smoothly, laid over what is already there (of which uKeep is kept: see the blending).
const GROW = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uTexel;
  uniform float uGain, uKeep;
  varying vec2 vUv;
  vec3 at(float x, float y) { return texture2D(tMap, vUv + vec2(x, y) * uTexel).rgb; }
  void main() {
    vec3 c = at(0.0, 0.0) * 0.25;
    c += (at(-1.0, 0.0) + at(1.0, 0.0) + at(0.0, -1.0) + at(0.0, 1.0)) * 0.125;
    c += (at(-1.0, -1.0) + at(1.0, -1.0) + at(-1.0, 1.0) + at(1.0, 1.0)) * 0.0625;
    gl_FragColor = vec4(c * uGain, uKeep);
  }`;

// The finished picture. The tone mapping and colour space chunks are three's
// own, so the renderer's toneMapping and toneMappingExposure still apply; the
// grade after them works on display colours.
const FINISH = /* glsl */ `
  uniform sampler2D tScene, tGlow;
  uniform float uStrength, uGrade, uNight, uTime, uAspect;
  varying vec2 vUv;
  void main() {
    vec3 c = max(texture2D(tScene, vUv).rgb, 0.0) + texture2D(tGlow, vUv).rgb * uStrength;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    c = clamp(gl_FragColor.rgb, 0.0, 1.0);
    if (uGrade > 0.0) {
      vec3 graded = c;
      // a little more colour, and a gentle S-curve for contrast
      float l = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = clamp(mix(vec3(l), graded, 1.08), 0.0, 1.0);
      graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.16);
      // warm the lights, cool the shadows (crisp late-afternoon urban contrast)
      vec3 cool = mix(vec3(0.955, 0.98, 1.055), vec3(0.96, 0.985, 1.06), uNight);
      graded *= mix(cool, vec3(1.035, 1.005, 0.96), smoothstep(0.12, 0.72, l));
      // the corners fall off a little, as through a lens
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      graded *= 1.0 - (0.16 + 0.1 * uNight) * smoothstep(0.4, 1.1, length(d));
      // fine grain hides banding
      float g = fract(sin(dot(vUv * 1000.0 + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      graded += g * 0.008;
      c = mix(c, graded, uGrade);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

export class PostProcessing {
  /** Glow, grade, vignette and grain. Off: only antialiasing and tone mapping. */
  enabled = true;

  private size = new THREE.Vector2();
  private samples: number;
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private levels: THREE.WebGLRenderTarget[] = [];
  private night = 0;

  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.Camera();
  private bright: THREE.ShaderMaterial;
  private shrink: THREE.ShaderMaterial;
  private grow: THREE.ShaderMaterial;
  private finish: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, samples = 4) {
    this.samples = samples;
    const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, options: THREE.ShaderMaterialParameters = {}) =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader, uniforms,
        depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending, ...options,
      });
    const texel = () => ({ value: new THREE.Vector2() });
    this.bright = material(BRIGHT, { tMap: { value: null }, uTexel: texel(), uThreshold: { value: 1 }, uKnee: { value: 0.2 } });
    this.shrink = material(SHRINK, { tMap: { value: null }, uTexel: texel() });
    // what is drawn + what was there × the alpha that is drawn
    this.grow = material(GROW, { tMap: { value: null }, uTexel: texel(), uGain: { value: 1 }, uKeep: { value: 1 } }, {
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.finish = material(FINISH, {
      tScene: { value: null }, tGlow: { value: null },
      uStrength: { value: 0 }, uGrade: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
    }, { toneMapped: true });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.finish);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Size of the drawing buffer, in real pixels. */
  setSize(width: number, height: number): void {
    width = Math.max(2, Math.round(width));
    height = Math.max(2, Math.round(height));
    if (this.sceneTarget && width === this.size.x && height === this.size.y) return;
    this.size.set(width, height);
    this.dispose();
    this.sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true,
    });
    for (let i = 0, w = width, h = height; i < LEVELS; i++) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      this.levels.push(new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
  }

  /** 0 by day .. 1 by night: the glow is gentle by day and generous at night. */
  setNight(night: number): void {
    this.night = night;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const { renderer } = this;
    if (!this.sceneTarget) {
      renderer.getDrawingBufferSize(this.size);
      this.setSize(this.size.x, this.size.y);
    }
    const sceneTarget = this.sceneTarget!;
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);

    // The passes below each replace or add to all of their target, so nothing is cleared first.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      const glow = this.enabled;
      if (glow) this.renderGlow(sceneTarget.texture);
      const u = this.finish.uniforms;
      u.tScene.value = sceneTarget.texture;
      u.tGlow.value = this.levels[0].texture;
      u.uStrength.value = glow ? 0.19 + 0.36 * this.night : 0;
      u.uGrade.value = glow ? 1 : 0;
      u.uNight.value = this.night;
      u.uTime.value = (performance.now() / 1000) % 1000;
      u.uAspect.value = this.size.x / this.size.y;
      this.pass(this.finish, null);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(null);
    }
  }

  dispose(): void {
    this.sceneTarget?.dispose();
    for (const level of this.levels) level.dispose();
    this.sceneTarget = null;
    this.levels = [];
  }

  private renderGlow(scene: THREE.Texture): void {
    const { levels } = this;
    const b = this.bright.uniforms;
    b.tMap.value = scene;
    b.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    // By day only sun on pale roofs and glass; at night windows, lamps and headlights.
    b.uThreshold.value = 0.95 - 0.6 * this.night;
    b.uKnee.value = 0.25 - 0.1 * this.night;
    this.pass(this.bright, levels[0]);

    for (let i = 1; i < LEVELS; i++) {
      this.shrink.uniforms.tMap.value = levels[i - 1].texture;
      this.shrink.uniforms.uTexel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
      this.pass(this.shrink, levels[i]);
    }
    for (let i = LEVELS - 2; i >= 0; i--) {
      const g = this.grow.uniforms;
      g.tMap.value = levels[i + 1].texture;
      g.uTexel.value.set(1 / levels[i + 1].width, 1 / levels[i + 1].height);
      g.uGain.value = i === LEVELS - 2 ? WEIGHTS[LEVELS - 1] : 1;
      g.uKeep.value = WEIGHTS[i];
      this.pass(this.grow, levels[i]);
    }
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
