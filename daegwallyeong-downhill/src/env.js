// 하늘·조명·안개·날씨 입자. 프리셋(WEATHERS)에 따라 장면 분위기를 만든다.
import * as THREE from 'three';
import { WEATHERS, SEASONS } from './config.js';
import { makeAsphalt, makeGrain, makeSignAtlas, makeDecalAtlas, makeSoftDot, makeLattice, makeWallTexture } from './textures.js';

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

let sharedTex = null;
export function getTextures(wet) {
  if (!sharedTex) {
    sharedTex = {
      asphaltDry: makeAsphalt(0), asphaltWet: makeAsphalt(1),
      grain: makeGrain(3, 256, 60), detail: makeGrain(8, 256, 90),
      signs: makeSignAtlas(), decals: makeDecalAtlas(), dot: makeSoftDot(), lattice: makeLattice(), wall: makeWallTexture(),
    };
  }
  return { ...sharedTex, asphalt: wet ? sharedTex.asphaltWet : sharedTex.asphaltDry };
}

export function makePalette(seasonKey, tex) {
  const s = SEASONS[seasonKey];
  const land = {};
  for (const k in s.land) land[k] = lin(s.land[k]);
  land[0] = land[1];
  return {
    land, rock: lin(s.rock), verge: lin(s.verge), high: lin(s.high), sea: lin(s.sea), gravel: lin(s.gravel),
    conifer: s.conifer.map(lin), decid: s.decid.map(lin), trunk: lin(s.trunk), detailTex: tex.detail,
    canopy: [...s.conifer, ...s.decid, ...s.decid].map(lin).map((c) => [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]),
  };
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uHor, uSunDir, uSunCol, uCloudCol;
uniform float uTime, uClouds, uNight;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uHor * 0.82, smoothstep(0.0, -0.3, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 1400.0) * 9.0 + pow(sd, 90.0) * 0.5 + pow(sd, 7.0) * 0.16);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 1.1 + vec2(uTime * 0.006, uTime * 0.002);
    float c = fbm(uv);
    float cover = smoothstep(1.0 - uClouds * 0.72, 1.12 - uClouds * 0.62, c + 0.22);
    vec3 cc = uCloudCol * (0.72 + 0.4 * fbm(uv * 2.3 + 4.0)) + uSunCol * pow(sd, 6.0) * 0.25;
    col = mix(col, cc, cover * smoothstep(0.0, 0.16, h) * 0.92);
    // 별
    if (uNight > 0.5) {
      vec2 sp = d.xz / (h + 0.4) * 90.0;
      float st = step(0.9985, hash(floor(sp)));
      col += vec3(st) * (1.0 - cover) * smoothstep(0.05, 0.4, h) * 0.9;
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'env';
    scene.add(this.group);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunCol: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() }, uTime: { value: 0 }, uClouds: { value: 0.4 }, uNight: { value: 0 },
        },
      }),
    );
    this.sky.scale.setScalar(30000);
    this.sky.renderOrder = -100; this.sky.frustumCulled = false;
    this.group.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 420;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.05;
    this.group.add(this.hemi, this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.particles = null;
  }

  apply(key, quality) {
    const w = (this.w = WEATHERS[key] || WEATHERS.day);
    this.key = key;
    const az = (w.sunAz * Math.PI) / 180, el = (w.sunEl * Math.PI) / 180;
    // 방위각: 북(−Z)에서 시계 방향
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const u = this.sky.material.uniforms;
    u.uTop.value.set(w.top); u.uHor.value.set(w.hor); u.uSunDir.value.copy(this.sunDir);
    u.uSunCol.value.set(w.sun).multiplyScalar(w.night ? 0.5 : 1);
    u.uCloudCol.value.set(w.night ? '#1a2238' : w.wet || key === 'fog' ? '#aeb7bd' : '#ffffff').lerp(new THREE.Color(w.hor), 0.25);
    u.uClouds.value = w.clouds; u.uNight.value = w.night ? 1 : 0;
    this.scene.fog = new THREE.Fog(new THREE.Color(w.fog), w.fogNear, w.fogFar);
    this.hemi.color.set(w.hemiSky); this.hemi.groundColor.set(w.hemiGround); this.hemi.intensity = w.hemiI;
    this.sun.color.set(w.sun); this.sun.intensity = w.sunI;
    this.renderer.toneMappingExposure = w.exposure;
    const shadows = quality.shadows && !w.noShadow;
    this.sun.castShadow = shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.tex = getTextures(!!w.wet);
    this.palette = makePalette(w.season, this.tex);
    this._makeParticles(w.particles, quality);
    return this;
  }

  _makeParticles(kind, quality) {
    if (this.particles) { this.group.remove(this.particles); this.particles.geometry.dispose(); this.particles.material.dispose(); this.particles = null; }
    if (!kind) return;
    const n = Math.round((kind === 'rain' ? 1400 : 260) * (quality.detail || 1));
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const rain = kind === 'rain';
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(rain ? '#cfd8e0' : '#d9792b') }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime, uScale; uniform vec3 uCam, uVel; varying float vA; varying float vSeed;
        void main() {
          vec3 box = vec3(${rain ? '46.0, 26.0, 46.0' : '60.0, 22.0, 60.0'});
          vec3 p = position * box;
          ${rain ? 'p.y -= uTime * (26.0 + seed * 8.0); p.x += uTime * 3.0;' : 'p.y -= uTime * (1.2 + seed * 1.4); p.x += sin(uTime * (0.8 + seed) + seed * 40.0) * 1.6 + uTime * 1.5; p.z += cos(uTime * 0.7 + seed * 20.0) * 1.2;'}
          p = mod(p - uCam, box) - box * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(${rain ? '6.0' : '13.0'} * uScale, ${rain ? '(1.6 + seed) ' : '(7.0 + seed * 9.0) '} * uScale * (22.0 / max(2.0, -mv.z)));
          vA = smoothstep(${rain ? '30.0, 4.0' : '34.0, 6.0'}, -mv.z) * ${rain ? '0.55' : '0.9'};
          vSeed = seed;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA; varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          ${rain ? 'float a = smoothstep(0.5, 0.0, abs(c.x) * 3.0) * smoothstep(0.5, 0.2, abs(c.y));' : 'float a = step(length(c * vec2(1.0, 1.7)), 0.42);'}
          vec3 col = uColor * (0.75 + 0.5 * vSeed);
          ${rain ? '' : 'col = mix(col, vec3(0.85, 0.2, 0.08), step(0.6, vSeed)); col = mix(col, vec3(0.9, 0.72, 0.15), step(0.85, vSeed));'}
          gl_FragColor = vec4(col, a * vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.particles = new THREE.Points(g, m);
    this.particles.frustumCulled = false; this.particles.renderOrder = 50;
    this.group.add(this.particles);
  }

  update(dt, camera, focus, time) {
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uTime.value = time;
    if (this.sun.castShadow) {
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
      this.sun.target.updateMatrixWorld();
    } else {
      this.sun.position.copy(this.sunDir).multiplyScalar(200);
      this.sun.target.position.set(0, 0, 0);
    }
    if (this.particles) {
      const u = this.particles.material.uniforms;
      u.uTime.value = time; u.uCam.value.copy(camera.position);
      u.uScale.value = this.renderer.getPixelRatio() * (this.renderer.domElement.height / this.renderer.getPixelRatio() / 720);
    }
  }
}
