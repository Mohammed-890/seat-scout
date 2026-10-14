/* Exterior scenery (illustrative, not live route imagery): sky dome, three procedural cloud layers, distant ground
   (daytime only). Rendered in a separate pass with its own far-plane camera that copies the cabin camera's
   orientation and projection, so the cabin keeps a tight depth range and clouds can be kilometres away.
   Clouds sit far below (deck, cumulus) or far above (cirrus) the aircraft, so they can never pass through it.
   Motion: everything outside drifts toward the tail (+z) because the aircraft flies toward -z. The wing is part of
   the cabin scene, so it stays fixed relative to the windows. */
"use strict";
const SKY = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(52, 1, 5, 600000), preset: "day", motion: !reduce, off: new THREE.Vector2(0, 0), speed: 180, layers: [] };

const NOISE = `
float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p,int oct){float a=.5,s=0.;mat2 r=mat2(.8,-.6,.6,.8);for(int i=0;i<7;i++){if(i>=oct)break;s+=a*vn(p);p=r*p*2.03+vec2(17.1,9.2);a*=.5;}return s;}
`;
const SKY_TAIL = `
#include <tonemapping_fragment>
#include <encodings_fragment>
`;

/* ---------- sky dome ---------- */
const skyU = { sunDir: { value: new THREE.Vector3() }, moonDir: { value: new THREE.Vector3(0.4, 0.5, -0.6).normalize() }, zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
  below: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() }, sunAmt: { value: 1 }, glow: { value: 1 }, stars: { value: 0 }, moon: { value: 0 } };
SKY.scene.add(new THREE.Mesh(new THREE.SphereGeometry(500000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: skyU,
  vertexShader: "varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader: `uniform vec3 sunDir,moonDir,zenith,horizon,below,sunCol;uniform float sunAmt,glow,stars,moon;varying vec3 vD;
  void main(){vec3 d=normalize(vD);float h=d.y;
    vec3 c=mix(horizon,zenith,pow(clamp(h,0.,1.),.42));
    c=mix(c,below,smoothstep(0.,-.08,h));
    float sd=max(dot(d,sunDir),0.);
    c+=sunCol*(smoothstep(.99955,.9998,sd)*sunAmt*14.+pow(sd,14.)*glow*.32+pow(sd,3.)*glow*.12*(1.-clamp(h*2.5,0.,1.)));
    c=mix(c,horizon*1.04,exp(-abs(h)*26.)*.45);
    if(stars>0.){vec3 q=d*260.;vec3 i=floor(q);float r=fract(sin(dot(i,vec3(12.9898,78.233,37.719)))*43758.5453);
      float s=step(.9972,r)*smoothstep(.16,.0,length(fract(q)-.5))*(.35+.65*(r-.9972)/.0028);c+=vec3(.82,.88,1.)*s*stars*smoothstep(.03,.3,h);}
    float md=max(dot(d,moonDir),0.);c+=vec3(.86,.9,1.)*(smoothstep(.99985,.99993,md)*moon*1.6+pow(md,160.)*moon*.035);
    gl_FragColor=vec4(c,1.);${SKY_TAIL}}` })));

/* ---------- cloud layers and ground: horizontal planes that follow the camera, sampled in world space ---------- */
function layer(o) {
  const u = { off: { value: SKY.off }, scale: { value: o.scale }, stretch: { value: new THREE.Vector2(...(o.stretch || [1, 1])) }, cov: { value: o.cov }, sharp: { value: o.sharp },
    sunDir: skyU.sunDir, lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, haze: { value: new THREE.Color() }, sunCol: skyU.sunCol, fogDist: { value: o.fogDist },
    opacity: { value: o.opacity ?? 1 }, city: { value: 0 }, ground: { value: new THREE.Color() }, oct: { value: o.oct ?? 6 }, parallax: { value: o.parallax ?? 1 } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1200000, 1200000, 1, 1), new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false,
    vertexShader: "varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader: `${NOISE}uniform vec2 off,stretch;uniform float scale,cov,sharp,fogDist,opacity,city,parallax;uniform int oct;uniform vec3 sunDir,lit,shade,haze,sunCol,ground;varying vec3 vW;
    float dens(vec2 p){return smoothstep(cov,cov+sharp,fbm(p,oct));}
    void main(){vec2 p=(vW.xz+off*parallax)/scale*stretch;float dist=length(vW);float fog=1.-exp(-dist/fogDist);vec3 v=normalize(vW);
      vec3 c;float a;
      if(city>-.5&&${o.ground ? "true" : "false"}){
        float land=fbm(p*.6,5);c=ground*(.75+.5*land);a=1.;
        if(city>0.){vec2 g=p*90.;vec2 gi=floor(g);float r=h21(gi);float area=smoothstep(.56,.68,fbm(p*.9+3.1,5));
          float dot_=smoothstep(.32,.0,length(fract(g)-.5))*step(.86-area*.25,r)*area;c+=vec3(1.,.66,.32)*dot_*city*(.6+.8*r)*(1.-fog*.85);}
      }else{
        float d=dens(p);if(d<.004)discard;
        float d2=dens(p+normalize(sunDir.xz+1e-4)*.045);
        float l=clamp(.62+(d-d2)*2.2+fbm(p*3.,3)*.25-.12,0.,1.);
        c=mix(shade,lit,l);
        float fwd=pow(max(dot(v,sunDir),0.),6.);c+=sunCol*fwd*(1.-d)*.6;
        a=d*opacity;
      }
      c=mix(c,haze,fog);a*=1.-smoothstep(.55,1.,fog)*${o.ground ? "0." : ".85"};
      gl_FragColor=vec4(c,a);${SKY_TAIL}}` }));
  m.rotation.x = -Math.PI / 2; m.position.y = o.alt; m.renderOrder = o.order; m.userData.o = o; SKY.scene.add(m); SKY.layers.push(m); return m;
}
const L_GROUND = layer({ alt: -10500, scale: 9000, cov: 0, sharp: 1, fogDist: 26000, order: 1, ground: true, oct: 5 });
const L_DECK = layer({ alt: -1900, scale: 2600, cov: 0.5, sharp: 0.13, fogDist: 34000, order: 2, oct: 5 });
const L_CUMULUS = layer({ alt: -650, scale: 1100, cov: 0.6, sharp: 0.13, fogDist: 26000, order: 3, oct: 5 });
const L_CIRRUS = layer({ alt: 5200, scale: 9000, stretch: [0.35, 2.6], cov: 0.56, sharp: 0.3, fogDist: 60000, order: 4, opacity: 0.35, oct: 5 });

/* ---------- one daytime preset: the same values drive the sky, the clouds and the cabin lighting ---------- */
const C = (r, g, b) => new THREE.Color(r, g, b);
const PRESETS = {
  day: { label: "Day above the clouds", sun: [-0.68, 0.52, 0.52], zenith: C(0.1, 0.25, 0.6), horizon: C(0.6, 0.72, 0.87), below: C(0.56, 0.63, 0.72), sunCol: C(1, 0.95, 0.86), sunAmt: 1, glow: 0.6, stars: 0, moon: 0,
    deck: { cov: 0.46, lit: C(1.35, 1.35, 1.37), shade: C(0.5, 0.57, 0.7) }, cum: { cov: 0.6, lit: C(1.3, 1.3, 1.32), shade: C(0.64, 0.7, 0.8) }, cirrus: 0.35, ground: C(0.33, 0.38, 0.34), city: 0,
    cabin: { sun: 3.6, sunCol: 0xfff0dc, hemi: 0.3, hemiSky: 0xf4f1ea, hemiGround: 0x3a3732, strip: 1.6, stripCol: 0xfff1e0, ceil: 0.55, exposure: 0.92, env: 1, win: 2.2 } },
};
/* cabin light handles are found in the cabin scene by type, so cabin3d.js doesn't need to export them */
const CABIN_LIGHTS = { hemi: scene.children.find((o) => o.isHemisphereLight), strips: scene.children.filter((o) => o.isRectAreaLight && o.width < 0.5), ceil: scene.children.find((o) => o.isRectAreaLight && o.width > 2) };
const ENV_BASE = new Map(); scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (m && m.envMapIntensity !== undefined && !ENV_BASE.has(m)) ENV_BASE.set(m, m.envMapIntensity); });

function setPreset(name) {
  const P = PRESETS[name] || PRESETS.day; SKY.preset = name;
  const sd = new THREE.Vector3(...P.sun).normalize(); skyU.sunDir.value.copy(sd);
  for (const k of ["zenith", "horizon", "below", "sunCol"]) skyU[k].value.copy(P[k]);
  skyU.sunAmt.value = P.sunAmt; skyU.glow.value = P.glow; skyU.stars.value = P.stars; skyU.moon.value = P.moon;
  for (const [L, cfg] of [[L_DECK, P.deck], [L_CUMULUS, P.cum]]) { const u = L.material.uniforms; u.cov.value = cfg.cov; u.lit.value.copy(cfg.lit); u.shade.value.copy(cfg.shade); u.haze.value.copy(P.horizon); }
  L_CIRRUS.visible = P.cirrus > 0; L_CIRRUS.material.uniforms.opacity.value = P.cirrus; L_CIRRUS.material.uniforms.lit.value.copy(P.deck.lit); L_CIRRUS.material.uniforms.shade.value.copy(P.deck.lit).multiplyScalar(0.8); L_CIRRUS.material.uniforms.haze.value.copy(P.horizon);
  const g = L_GROUND.material.uniforms; g.ground.value.copy(P.ground); g.city.value = P.city; g.haze.value.copy(P.horizon).lerp(P.below, 0.5);
  // cabin lighting follows the outside light.
  const cb = P.cabin;
  SUN_DIR.copy(sd); sun.intensity = cb.sun; sun.color.set(cb.sunCol);
  if (CABIN_LIGHTS.hemi) { CABIN_LIGHTS.hemi.intensity = cb.hemi; CABIN_LIGHTS.hemi.color.set(cb.hemiSky); CABIN_LIGHTS.hemi.groundColor.set(cb.hemiGround); }
  for (const a of CABIN_LIGHTS.strips) { a.intensity = cb.strip; a.color.set(cb.stripCol); }
  if (CABIN_LIGHTS.ceil) CABIN_LIGHTS.ceil.intensity = cb.ceil;
  renderer.toneMappingExposure = cb.exposure;
  for (const [m, v] of ENV_BASE) m.envMapIntensity = v * cb.env;
  M.cove.color.setScalar(1.22); M.led.color.setRGB(1.6, 1.5, 1.35);
  if (typeof shadowAt !== "undefined") { shadowAt = null; placeSun(eye.lengthSq() ? eye : new THREE.Vector3(0, 1, ZC)); }
  if (window.onPresetChange) window.onPresetChange(name);
  dirty = true;
}

/* one soft "window light" for the selected window seat: its strength follows the preset and that window's shade */
const winLight = new THREE.RectAreaLight(0xffffff, 0, 0.26, 0.36); scene.add(winLight);
function updateWindowLight() {
  const id = selected, s = SEATS[id]; const inSeat = ["F", "W", "A", "L", "R", "X"].includes(view) || view === "T";
  if (!s || s.position !== "window" || !inSeat) { if (winLight.intensity) { winLight.intensity = 0; dirty = true; } return; }
  const side = s.letter <= "C" ? -1 : 1, z = backZ[s.row] - 0.25; let best = null;
  for (const sh of SHADES) if (sh.side === side && (!best || Math.abs(sh.z - z) < Math.abs(best.z - z))) best = sh;
  const open = best ? 1 - best.sm.scale.y : 1, P = PRESETS[SKY.preset];
  winLight.color.copy(P.horizon).lerp(new THREE.Color(1, 1, 1), 0.45); winLight.position.set(side * 1.86, WIN_Y, best ? best.z : z); winLight.lookAt(0, WIN_Y - 0.15, best ? best.z : z);
  const want = P.cabin.win * open * (best && Math.abs(best.z - z) < 0.45 ? 1 : 0.55);
  if (Math.abs(winLight.intensity - want) > 0.01) { winLight.intensity = want; dirty = true; }
}

/* Render pass, called by cabin3d.js before the cabin is drawn. The sky is drawn at a third of the resolution into a
   texture that becomes the cabin's background: soft clouds lose nothing visible, and most of it is hidden behind the
   cabin anyway, so this keeps the per-pixel noise cost small. */
SKY.rt = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false }); SKY.rt.texture.encoding = THREE.sRGBEncoding;
function renderSky(c) {
  const vp = new THREE.Vector4(); renderer.getCurrentViewport(vp); const pr = renderer.getPixelRatio();
  const div = QUALITY.low ? 4 : 3, w = Math.max(16, Math.round(vp.z / div)), h = Math.max(16, Math.round(vp.w / div));
  if (SKY.rt.width !== w || SKY.rt.height !== h) SKY.rt.setSize(w, h);
  SKY.cam.quaternion.copy(c.quaternion); SKY.cam.fov = c.fov; SKY.cam.aspect = c.aspect;
  if (c.view && c.view.enabled) SKY.cam.setViewOffset(c.view.fullWidth, c.view.fullHeight, c.view.offsetX, c.view.offsetY, c.view.width, c.view.height); else SKY.cam.clearViewOffset();
  SKY.cam.updateProjectionMatrix(); SKY.cam.updateMatrixWorld();
  const keep = renderer.shadowMap.needsUpdate, prevTarget = renderer.getRenderTarget(), scis = renderer.getScissorTest();
  renderer.setScissorTest(false); renderer.setRenderTarget(SKY.rt); renderer.clear(); renderer.render(SKY.scene, SKY.cam);
  renderer.setRenderTarget(prevTarget); renderer.setScissorTest(scis); renderer.setViewport(vp.x / pr, vp.y / pr, vp.z / pr, vp.w / pr);
  renderer.shadowMap.needsUpdate = keep; scene.background = SKY.rt.texture;
}
/* per-frame: drift the scenery (only while it is visible and motion is allowed); returns true if a redraw is needed */
function skyFrame(dt) {
  updateWindowLight();
  const visible = fades.studio < 0.999;
  if (!visible || !SKY.motion || reduce || QUALITY.low) return false;
  SKY.off.y -= SKY.speed * dt / 1000; if (SKY.off.y < -2e6) SKY.off.y += 2e6; // wrap well inside float precision
  return true;
}
setPreset("day");
try { renderer.compile(SKY.scene, SKY.cam); } catch (e) { /* compiled lazily on first use instead */ }
