// 입자 효과: 불꽃(가드레일·센터스탠드), 먼지, 니트로.
import * as THREE from 'three';

export class Fx {
  constructor(scene, tex, additive, max = 500) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.life0 = new Float32Array(max); this.grav = new Float32Array(max); this.grow = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec4 vC;
        void main(){ float a = texture2D(uTex, gl_PointCoord).r; gl_FragColor = vec4(vC.rgb, vC.a * a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 40;
    g.setDrawRange(0, 0);
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grav = 9.8, grow = 0) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = this.life0[i] = life; this.grav[i] = grav; this.grow[i] = grow;
  }
  update(dt, scale) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (j !== i) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
          this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.life0[i] = this.life0[j]; this.grav[i] = this.grav[j]; this.grow[i] = this.grow[j];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] *= Math.pow(this.life[i] / this.life0[i], dt * 3.5);
      i++;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
    this.mat.uniforms.uScale.value = scale;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}
