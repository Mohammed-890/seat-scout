/* 3D cabin, aircraft cutaway and camera system (procedural Three.js r147). Reads globals from web/globals.js. */
"use strict";

/* ================= 3D cabin: native render, procedural PBR, instanced seats ================= */
const canvas=document.getElementById("scene");
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
function applyQuality(){renderer.setPixelRatio(QUALITY.low?1:Math.min(2,window.devicePixelRatio||1));if(typeof sun!=="undefined"){sun.shadow.mapSize.set(QUALITY.low?1024:4096,QUALITY.low?1024:4096);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null}renderer.shadowMap.needsUpdate=true}lastSize="";dirty=true}
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.92;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
THREE.RectAreaLightUniformsLib.init();
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(52,16/9,0.03,400);
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
renderer.autoClear=false;
/* Quality: "low" lowers pixel ratio and shadow resolution and stops scenery motion. Chosen automatically when a
   measured frame time is slow (see PERF in the loop), and switchable by the user. */
let QUALITY={low:false};try{QUALITY.low=localStorage.getItem("ss-quality")==="low"}catch(e){}
const FRAME_HOOKS=[];
const maxAniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());

/* ---------- procedural textures ---------- */
function mkCanvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}
function tex(c,srgb,rep){const t=new THREE.CanvasTexture(c);if(srgb)t.encoding=THREE.sRGBEncoding;t.anisotropy=maxAniso;t.wrapS=t.wrapT=THREE.RepeatWrapping;if(rep)t.repeat.set(rep[0],rep[1]);return t}
function vnoise(w,h,scale,seed){const g=new Float32Array((scale+1)*(scale+1));for(let i=0;i<g.length;i++)g[i]=rnd(i*1.7+seed);
  const out=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const fx=x/w*scale,fy=y/h*scale,ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;
    const sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);const a=g[iy*(scale+1)+ix],b=g[iy*(scale+1)+ix+1],c=g[(iy+1)*(scale+1)+ix],d=g[(iy+1)*(scale+1)+ix+1];
    out[y*w+x]=a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy}return out}
function fbm(w,h,oct,base,seed){const o=new Float32Array(w*h);let amp=1,tot=0;for(let k=0;k<oct;k++){const n=vnoise(w,h,base<<k,seed+k*13);for(let i=0;i<o.length;i++)o[i]+=n[i]*amp;tot+=amp;amp*=.5}for(let i=0;i<o.length;i++)o[i]/=tot;return o}
function normalFromHeight(hgt,w,h,strength){const c=mkCanvas(w,h),g=c.getContext("2d"),img=g.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const l=hgt[y*w+((x-1+w)%w)],r=hgt[y*w+((x+1)%w)],u=hgt[((y-1+h)%h)*w+x],d=hgt[((y+1)%h)*w+x];
    const nx=(l-r)*strength,ny=(u-d)*strength,len=Math.hypot(nx,ny,1);const i=(y*w+x)*4;img.data[i]=(nx/len*.5+.5)*255;img.data[i+1]=(ny/len*.5+.5)*255;img.data[i+2]=(1/len*.5+.5)*255;img.data[i+3]=255}
  g.putImageData(img,0,0);return c}
function colorFromHeight(hgt,w,h,fn){const c=mkCanvas(w,h),g=c.getContext("2d"),img=g.createImageData(w,h);for(let i=0;i<w*h;i++){const [r,gg,b]=fn(hgt[i],i);img.data[i*4]=r;img.data[i*4+1]=gg;img.data[i*4+2]=b;img.data[i*4+3]=255}g.putImageData(img,0,0);return c}
// woven upholstery: 2/2 twill with melange yarn
function makeFabric(base,seed,rep=2.5){const w=512,h=512,hgt=new Float32Array(w*h),mel=fbm(w,h,3,16,seed);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const cell=((x>>2)+(y>>2))&3,up=cell<2;const fx=(x&3)/3,fy=(y&3)/3;const bump=up?Math.sin(Math.PI*fy):Math.sin(Math.PI*fx);
    hgt[y*w+x]=bump*.65+mel[y*w+x]*.2+rnd(x*7+y*131+seed)*.15}
  const col=colorFromHeight(hgt,w,h,(v,i)=>{const m=(mel[i]-.5)*.28+(v-.5)*.22+(rnd(i*3+seed)-.5)*.06;return [base[0]*(1+m),base[1]*(1+m),base[2]*(1+m)]});
  return {map:tex(col,true,[rep,rep]),normal:tex(normalFromHeight(hgt,w,h,1.6),false,[rep,rep])}}
function makeGrain(base,seed,amp,scale,rep,nstr=1.2){const w=256,h=256,n=fbm(w,h,4,scale,seed);
  const col=colorFromHeight(n,w,h,(v)=>{const m=(v-.5)*amp;return [base[0]*(1+m),base[1]*(1+m),base[2]*(1+m)]});
  return {map:tex(col,true,rep),normal:tex(normalFromHeight(n,w,h,nstr),false,rep)}}
function makeCarpet(base,rep){const w=512,h=512,n=fbm(w,h,3,32,9),hgt=new Float32Array(w*h);for(let i=0;i<w*h;i++)hgt[i]=n[i]*.35+rnd(i*3.1)*.65;
  const col=colorFromHeight(hgt,w,h,(v,i)=>{const x=i%w,y=(i/w)|0;const dot=((x%64)<3&&(y%64)<3)?1:0;const m=(v-.5)*.35+(n[i]-.5)*.2;
    return dot?[base[0]*1.9,base[1]*1.8,base[2]*1.6]:[base[0]*(1+m),base[1]*(1+m),base[2]*(1+m)]});
  return {map:tex(col,true,rep),normal:tex(normalFromHeight(hgt,w,h,2.2),false,rep)}}
// panel texture with a recessed seam line along u (one seam per tile)
function makePanel(base,seed,horizontalSeam){const w=512,h=512,n=fbm(w,h,3,24,seed),hgt=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=horizontalSeam?y:x;const s=c<3||c>w-3?-1:0;hgt[y*w+x]=n[y*w+x]*.08+s}
  const col=colorFromHeight(hgt,w,h,(v,i)=>{const m=v<-0.5?-0.42:(v-.04)*.25;return [base[0]*(1+m),base[1]*(1+m),base[2]*(1+m)]});
  const t=tex(col,true),nt=tex(normalFromHeight(hgt,w,h,0.9),false);return {map:t,normal:nt}}
function makeGrille(){const w=256,h=256,c=mkCanvas(w,h),g=c.getContext("2d");g.fillStyle="#c9c7c2";g.fillRect(0,0,w,h);g.fillStyle="#3a3c40";
  for(let x=8;x<w;x+=14)g.fillRect(x,40,5,h-80);const t=tex(c,true);return t}
function labelTex(txt,bg,fg,w=256,h=80,font="600 40px Figtree, sans-serif"){const c=mkCanvas(w,h),g=c.getContext("2d");g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font=font;g.textAlign="center";g.textBaseline="middle";g.fillText(txt,w/2,h/2+2);const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.anisotropy=maxAniso;return t}
function signTex(){const c=mkCanvas(256,96),g=c.getContext("2d");g.fillStyle="#2a2f36";g.fillRect(0,0,256,96);g.strokeStyle="#f3f1ea";g.fillStyle="#f3f1ea";g.lineWidth=5;
  // seatbelt icon
  g.beginPath();g.arc(70,48,26,0,Math.PI*2);g.stroke();g.fillRect(50,44,40,8);g.fillRect(64,40,12,16);
  // no-smoking icon
  g.beginPath();g.arc(186,48,26,0,Math.PI*2);g.stroke();g.fillRect(166,44,34,8);g.beginPath();g.moveTo(168,30);g.lineTo(204,66);g.stroke();
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t}
function blobTex(){const c=mkCanvas(128,128),g=c.getContext("2d"),gr=g.createRadialGradient(64,64,4,64,64,62);gr.addColorStop(0,"rgba(0,0,0,1)");gr.addColorStop(.55,"rgba(0,0,0,.55)");gr.addColorStop(1,"rgba(0,0,0,0)");g.fillStyle=gr;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c)}

/* ---------- one cohesive palette: warm ivory shell, graphite plastics, petrol-blue wool fabric, linen headrest covers ---------- */
const FAB=makeFabric([24,44,82],1), FABXL=makeFabric([30,36,60],4), LINEN=makeFabric([224,216,198],3,3), CAR=makeCarpet([40,46,64],[1.2,24]);
const PLA=makeGrain([66,72,84],7,.05,64,[3,3],.5), PLA_D=makeGrain([38,42,51],8,.05,64,[3,3],.5);
const WALLP=makePanel([226,219,203],11,false), BINP=makePanel([233,227,213],12,true), CEILP=makePanel([230,224,210],13,true);
const PANEL=2*WP; // wall panel width = two window frames
{const rep=1/PANEL,seam=WIN[0]+WP/2;WALLP.map.repeat.set(rep,rep);WALLP.normal.repeat.set(rep,rep);WALLP.map.offset.x=WALLP.normal.offset.x=-seam*rep;
 BINP.map.repeat.set(1,rep);BINP.normal.repeat.set(1,rep);BINP.map.offset.y=BINP.normal.offset.y=-(1-(seam-Z0))*rep;
 CEILP.map.repeat.set(1,L/PANEL);CEILP.normal.repeat.set(1,L/PANEL);CEILP.map.offset.y=CEILP.normal.offset.y=-(seam-Z0)/PANEL}
const std=(o)=>new THREE.MeshStandardMaterial(Object.assign({envMapIntensity:.45},o));
const M={
  fabric:std({map:FAB.map,normalMap:FAB.normal,normalScale:new THREE.Vector2(.55,.55),roughness:.92,envMapIntensity:.35}),
  fabricXL:std({map:FABXL.map,normalMap:FABXL.normal,normalScale:new THREE.Vector2(.55,.55),roughness:.9,envMapIntensity:.35}),
  linen:std({map:LINEN.map,normalMap:LINEN.normal,normalScale:new THREE.Vector2(.4,.4),roughness:.95,envMapIntensity:.4}),
  seam:std({color:0x1d2b37,roughness:.9}),
  shell:std({map:PLA.map,normalMap:PLA.normal,normalScale:new THREE.Vector2(.15,.15),roughness:.44,envMapIntensity:.45}),
  trim:std({map:PLA_D.map,normalMap:PLA_D.normal,normalScale:new THREE.Vector2(.15,.15),roughness:.5}),
  armPad:std({color:0x2a2d32,roughness:.62}),
  tray:std({color:0x3e4552,roughness:.5,envMapIntensity:.35}),
  metal:std({color:0xc8ccd2,roughness:.26,metalness:1,envMapIntensity:1}),
  metalDark:std({color:0x6c7178,roughness:.35,metalness:1,envMapIntensity:.9}),
  pocket:std({color:0x1f2a33,roughness:.95,envMapIntensity:.3}),
  card:std({map:labelTex("SAFETY","#f1efe9","#d2492a",128,64,"700 26px Figtree, sans-serif"),roughness:.7}),
  vest:std({color:0x50565e,roughness:.85}),
  wall:std({map:WALLP.map,normalMap:WALLP.normal,roughness:.55,side:THREE.DoubleSide,shadowSide:THREE.DoubleSide}),
  dado:std({map:makeGrille(),roughness:.7,side:THREE.DoubleSide}),
  bin:std({map:BINP.map,normalMap:BINP.normal,roughness:.42}),
  ceil:std({map:CEILP.map,normalMap:CEILP.normal,roughness:.6,side:THREE.DoubleSide}),
  psu:std({color:0xd9d7d1,roughness:.5}),
  carpet:std({map:CAR.map,normalMap:CAR.normal,normalScale:new THREE.Vector2(.8,.8),roughness:1,envMapIntensity:.2}),
  led:new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,1.5,1.35)}),
  ledOff:std({color:0xe8e6e0,roughness:.2,envMapIntensity:1}),
  cove:new THREE.MeshBasicMaterial({color:new THREE.Color(1.25,1.22,1.15)}),
  reveal:std({color:0xe6e3dd,roughness:.45}),
  shade:std({color:0xf0eee8,roughness:.6,side:THREE.DoubleSide}),
  pane:new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.04,transparent:true,opacity:.07,envMapIntensity:1.4,depthWrite:false}),
  curtain:std({map:makeFabric([36,52,70],21).map,roughness:.95}),
  paint:std({color:0xe7eaee,roughness:.32,metalness:.1,envMapIntensity:1,side:THREE.DoubleSide}),
  paintGrey:std({color:0xaab1ba,roughness:.4,metalness:.2,side:THREE.DoubleSide}),
  nacelleIn:std({color:0x24282e,roughness:.6}),
  red:std({color:0xb8322a,roughness:.4}),
  gasper:std({color:0xc8ccd2,roughness:.26,metalness:1,envMapIntensity:1}),
  exitSign:new THREE.MeshBasicMaterial({map:labelTex("EXIT","#127a46","#ffffff",256,96,"700 60px Figtree, sans-serif"),toneMapped:false}),
  sign:new THREE.MeshBasicMaterial({map:signTex(),color:new THREE.Color(1.1,1.1,1.1)}),
};
const HIDE=new THREE.MeshBasicMaterial({visible:false}),TUNNEL=std({color:0xdcd9d3,roughness:.5,side:THREE.DoubleSide});

/* ---------- geometry helpers ---------- */
/* Crease-aware smooth normals. ExtrudeGeometry and friends are non-indexed, so computeVertexNormals()
   shades every triangle flat; that is the faceting visible on shells, cushions and armrests. Here normals
   are averaged across triangles that share a position and meet at less than the crease angle. */
function smoothNormals(geo,creaseDeg=55){if(geo.index)geo=geo.toNonIndexed();const p=geo.attributes.position,n=p.count,fn=new Float32Array(n),cos=Math.cos(creaseDeg*Math.PI/180);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),fnorm=new Float32Array(n*3);
  for(let i=0;i<n;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);c.sub(b);a.sub(b);c.cross(a);const area=c.length();if(area>0)c.divideScalar(area);
    for(let k=0;k<3;k++){fnorm[(i+k)*3]=c.x;fnorm[(i+k)*3+1]=c.y;fnorm[(i+k)*3+2]=c.z;fn[i+k]=area}}
  const key=i=>Math.round(p.getX(i)*1e4)+","+Math.round(p.getY(i)*1e4)+","+Math.round(p.getZ(i)*1e4);const groups=new Map();
  for(let i=0;i<n;i++){const k=key(i);let g=groups.get(k);if(!g)groups.set(k,g=[]);g.push(i)}
  const out=new Float32Array(n*3);
  for(const g of groups.values())for(const i of g){let x=0,y=0,z=0;const ix=fnorm[i*3],iy=fnorm[i*3+1],iz=fnorm[i*3+2];
    const degenerate=fn[i]<1e-12; // zero-area triangles (common in bevels) take the plain average of their neighbours
    for(const j of g){const jx=fnorm[j*3],jy=fnorm[j*3+1],jz=fnorm[j*3+2];if(degenerate||ix*jx+iy*jy+iz*jz>=cos){const w=fn[j]+1e-9;x+=jx*w;y+=jy*w;z+=jz*w}}
    let l=Math.hypot(x,y,z);if(l<1e-9){x=0;y=1;z=0;l=1}out[i*3]=x/l;out[i*3+1]=y/l;out[i*3+2]=z/l}
  geo.setAttribute("normal",new THREE.BufferAttribute(out,3));return geo}
function rrect(w,h,r){const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s}
function extrudeX(shape,width,bevel=0.012,seg=3){const g=new THREE.ExtrudeGeometry(shape,{depth:Math.max(0.001,width-2*bevel),bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:seg,curveSegments:14});g.translate(0,0,-(width-2*bevel)/2);g.rotateY(-Math.PI/2);return smoothNormals(g)}
function plate(w,h,r,d,bevel=0.004,seg=3){const g=new THREE.ExtrudeGeometry(rrect(w,h,r),{depth:d,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:seg,curveSegments:12});g.translate(0,0,-d/2);return smoothNormals(g)}
function bend(geo,side){const p=geo.attributes.position;for(let i=0;i<p.count;i++){const u=p.getX(i),s=p.getY(i),a=s/R;p.setXYZ(i,side*R*Math.cos(a),CY+R*Math.sin(a),u)}geo.computeVertexNormals();return geo}
function band(a0,a1,seg){const g=new THREE.PlaneGeometry(L,(a1-a0)*R,1,seg);g.translate(Z0+L/2,(a0+a1)/2*R,0);const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i),p.getY(i));return g}
function mesh(geo,mat,cast=false,recv=true){const m=new THREE.Mesh(geo,mat);m.castShadow=cast;m.receiveShadow=recv;return m}
function sculpt(geo,fn){const p=geo.attributes.position;for(let i=0;i<p.count;i++){const r=fn(p.getX(i),p.getY(i),p.getZ(i));p.setXYZ(i,r[0],r[1],r[2])}return smoothNormals(geo)}
function tube(pts,r=0.0032){return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),Math.max(8,pts.length*4),r,6,false)}

/* ---------- cabin shell: curved sidewalls with real window openings on a fixed frame pitch ---------- */
const SHADES=[];
function openShadesNear(zs){zs=[].concat(zs);for(const s of SHADES)s.set(zs.some(z=>Math.abs(s.z-z)<1.3)?0.05:s.amt);renderer.shadowMap.needsUpdate=true}
const cabin=new THREE.Group(),upper=new THREE.Group();scene.add(cabin,upper);
const aFloor=Math.asin((0.03-CY)/R), aDado=Math.asin((0.24-CY)/R), aBin=Math.asin((1.64-CY)/R), aW0=Math.asin((WIN_Y-0.33-CY)/R), aW1=Math.asin((WIN_Y+0.33-CY)/R);
const aWin=Math.asin((WIN_Y-CY)/R);
for(const side of[-1,1]){
  cabin.add(mesh(bend(band(aFloor,aDado+0.004,4),side),M.dado,false,true));
  cabin.add(mesh(bend(band(aDado,aW0+0.004,12),side),M.wall,true,true));
  cabin.add(mesh(bend(band(aW1-0.004,aBin,6),side),M.wall,true,true));
  const sh=new THREE.Shape();sh.moveTo(Z0,aW0*R);sh.lineTo(Z0+L,aW0*R);sh.lineTo(Z0+L,aW1*R);sh.lineTo(Z0,aW1*R);sh.lineTo(Z0,aW0*R);
  for(const z of WIN)sh.holes.push(new THREE.Path(rrect(WIN_W,WIN_H,0.1).getPoints(12).map(p=>new THREE.Vector2(z+p.x,aWin*R+p.y))));
  const g=new THREE.ShapeGeometry(sh,12);cabin.add(mesh(bend(g,side),M.wall,true,true));
  WIN.forEach((z,i)=>{
    const grp=new THREE.Group();grp.position.set(side*R*Math.cos(aWin),WIN_Y,z);grp.lookAt(0,WIN_Y-0.04,z);cabin.add(grp);
    const ring=rrect(WIN_W+0.12,WIN_H+0.15,0.15);ring.holes.push(new THREE.Path(rrect(WIN_W,WIN_H,0.1).getPoints(14)));
    const rv=mesh(smoothNormals(new THREE.ExtrudeGeometry(ring,{depth:0.016,bevelEnabled:true,bevelSize:0.014,bevelThickness:0.014,bevelSegments:5,curveSegments:16})),M.reveal,true,true);rv.position.z=0.002;grp.add(rv);
    const tm=mesh(new THREE.ExtrudeGeometry(new THREE.Shape(rrect(WIN_W,WIN_H,0.1).getPoints(16)),{depth:0.12,bevelEnabled:false}),[HIDE,TUNNEL],false,true);tm.position.z=-0.12;grp.add(tm);
    const pane=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(rrect(WIN_W-0.01,WIN_H-0.01,0.095).getPoints(12))),M.pane);pane.position.z=-0.025;grp.add(pane);
    const amt=rnd(i*5+side*3)<0.28?0.25+rnd(i+side*9)*0.5:0.05;
    const sg=new THREE.PlaneGeometry(WIN_W-0.004,WIN_H);sg.translate(0,-WIN_H/2,0);const sm=mesh(sg,M.shade,true,true);sm.position.set(0,WIN_H/2,-0.035);grp.add(sm);
    const lip=mesh(new THREE.BoxGeometry(WIN_W*0.42,0.014,0.014),M.trim,true);grp.add(lip);
    const sh={sm,lip,amt,z,side,set(a){sm.scale.y=a;lip.position.set(0,WIN_H/2-WIN_H*a,-0.03)}};sh.set(amt);SHADES.push(sh);
  });
}
// floor: carpet throughout, darker aisle runner, seat tracks
{const f=mesh(new THREE.BoxGeometry(3.48,0.02,L),M.carpet);f.position.set(0,0,Z0+L/2);cabin.add(f);
 const run=new THREE.MeshStandardMaterial({map:CAR.map,normalMap:CAR.normal,color:0x9aa0ab,roughness:1,envMapIntensity:.2});
 const c=mesh(new THREE.BoxGeometry(AISLE+0.04,0.006,L),run);c.position.set(0,0.012,Z0+L/2);cabin.add(c);
 for(const tx of[-0.42,-1.12,0.42,1.12]){const t=mesh(new THREE.BoxGeometry(0.032,0.004,L),M.metalDark);t.position.set(tx,0.012,Z0+L/2);cabin.add(t)}}
// overhead bins with door seams on the panel grid, latches, PSU strip, ceiling
function binShape(side){const s=new THREE.Shape();const xo=side*1.9,xi=side*1.17;s.moveTo(xo,1.62);s.lineTo(xi+side*0.03,1.62);s.quadraticCurveTo(xi-side*0.045,1.64,xi-side*0.04,1.72);s.quadraticCurveTo(xi-side*0.06,1.88,xi+side*0.03,2.03);s.lineTo(side*1.6,2.162);s.lineTo(xo,2.0);s.lineTo(xo,1.62);return s}
const seams=[];for(let z=WIN[0]+WP/2-PANEL*4;z<ZE;z+=PANEL)if(z>Z0)seams.push(z);
for(const side of[-1,1]){
  const g=new THREE.ExtrudeGeometry(binShape(side),{depth:L,bevelEnabled:false,curveSegments:28});g.translate(0,0,Z0);smoothNormals(g,40);upper.add(mesh(g,M.bin,true,true));
  const psu=mesh(new THREE.BoxGeometry(0.62,0.012,L),M.psu,false,true);psu.position.set(side*1.52,1.612,Z0+L/2);upper.add(psu);
  const lipLed=new THREE.Mesh(new THREE.BoxGeometry(0.012,0.006,L),M.cove);lipLed.position.set(side*1.17,1.612,Z0+L/2);upper.add(lipLed);
  const cv=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.012,L),M.cove);cv.position.set(side*1.585,2.15,Z0+L/2);upper.add(cv);
}
{const g=new THREE.PlaneGeometry(3.2,L,40,1);g.rotateX(Math.PI/2);const p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i);p.setY(i,2.3-x*x/18.4);p.setZ(i,p.getZ(i)+Z0+L/2)}g.computeVertexNormals();upper.add(mesh(g,M.ceil,true,true))}

/* ---------- instancing ---------- */
const instances=new Map();let curTag=null,curPart=null;const _q=new THREE.Quaternion(),_e=new THREE.Euler(),_v=new THREE.Vector3(),_s=new THREE.Vector3();
function put(geo,mat,parentM,x,y,z,rx=0,rz=0,sx=1,sy=1,sz=1,cast=true,ry=0){const key=geo.uuid+"|"+mat.uuid;let it=instances.get(key);if(!it){it={geo,mat,list:[],tags:[],parts:[],cast};instances.set(key,it)}
  _e.set(rx,ry,rz);_q.setFromEuler(_e);_v.set(x,y,z);_s.set(sx,sy,sz);const m=new THREE.Matrix4().compose(_v,_q,_s);it.list.push(parentM?new THREE.Matrix4().multiplyMatrices(parentM,m):m);it.tags.push(curTag);it.parts.push(curPart)}

// PSU per row: reading lights, gaspers, sign panel; row labels on the bin lip
const SIGNG=new THREE.PlaneGeometry(0.09,0.034),LAMPG=new THREE.CylinderGeometry(0.017,0.017,0.006,20),GASP=new THREE.CylinderGeometry(0.012,0.016,0.018,16),LATCH=plate(0.11,0.022,0.008,0.012,0.003);
for(let r=1;r<=30;r++)for(const side of[-1,1]){const z=backZ[r]-0.34;
  put(SIGNG,M.sign,null,side*1.27,1.604,z-0.08,Math.PI/2,0,1,1,1,false);
  for(const k of[0,1,2]){const on=rnd(r*3+side*7+k)>0.86;put(LAMPG,on?M.led:M.ledOff,null,side*(1.33+k*0.08),1.603,z+0.02,0,0,1,1,1,false);put(GASP,M.gasper,null,side*(1.33+k*0.08),1.6,z+0.075,0,0,1,1,1,false)}
  const lab=new THREE.Mesh(new THREE.PlaneGeometry(0.13,0.04),new THREE.MeshBasicMaterial({map:labelTex(r+" "+(side<0?"ABC":"DEF"),"#ebe8e2","#26313d",256,80,"600 44px Figtree, sans-serif"),color:0xdddddd}));
  lab.position.set(side*1.166,1.69,z+0.2);lab.rotation.y=-side*Math.PI/2+side*0.2;lab.rotation.x=-0.1;upper.add(lab)}
for(const z of seams)for(const side of[-1,1])if(z+PANEL/2<ZE)put(LATCH,M.trim,null,side*1.135,1.71,z+PANEL/2,0,0,1,1,1,false,-side*Math.PI/2+side*0.12);
// exits: hatch frames around their windows, red handle, EXIT signs
for(const wi of EXIT_WIN)for(const side of[-1,1]){const z=WIN[wi],a=Math.asin((1.0-CY)/R);
  const s=rrect(0.68,1.04,0.14);s.holes.push(new THREE.Path(rrect(0.62,0.98,0.12).getPoints(14)));
  const fr=mesh(new THREE.ExtrudeGeometry(s,{depth:0.008,bevelEnabled:true,bevelSize:0.006,bevelThickness:0.006,bevelSegments:2}),M.trim);fr.position.set(side*(R-0.012)*Math.cos(a),1.0,z);fr.lookAt(0,1.0,z);cabin.add(fr);
  const hd=mesh(plate(0.16,0.04,0.015,0.03,0.006),M.red,true);const ah=Math.asin((1.42-CY)/R);hd.position.set(side*(R-0.03)*Math.cos(ah),1.42,z);hd.lookAt(0,1.42,z);cabin.add(hd);
  const sg=new THREE.Mesh(new THREE.PlaneGeometry(0.22,0.08),M.exitSign);sg.position.set(side*1.167,1.7,z);sg.rotation.y=-side*Math.PI/2+side*0.2;sg.rotation.x=-0.1;upper.add(sg)}
// bulkhead with doorway curtain, rear wall with lavatory doors
function sectionShape(y0,y1){const xa=y=>Math.sqrt(Math.max(0,R*R-(y-CY)*(y-CY)));const s=new THREE.Shape(),N=14;s.moveTo(-xa(y0),y0);s.lineTo(xa(y0),y0);for(let i=1;i<=N;i++){const y=y0+(y1-y0)*i/N;s.lineTo(xa(y),y)}for(let i=N;i>=0;i--){const y=y0+(y1-y0)*i/N;s.lineTo(-xa(y),y)}return s}
{const bw=sectionShape(0,1.64);bw.holes.push(new THREE.Path(rrect(0.9,1.95,0.08).getPoints(10).map(p=>new THREE.Vector2(p.x,p.y+0.975))));
 const b=mesh(new THREE.ExtrudeGeometry(bw,{depth:0.06,bevelEnabled:false}),M.wall,true,true);b.position.set(0,0,BULK-0.06);cabin.add(b);
 const kick=mesh(new THREE.BoxGeometry(3.6,0.2,0.01),M.trim);kick.position.set(0,0.1,BULK+0.002);cabin.add(kick);
 const cu=mesh(new THREE.PlaneGeometry(0.92,1.94,30,1),M.curtain);{const p=cu.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,0.025*Math.sin(p.getX(i)*34));cu.geometry.computeVertexNormals()}cu.position.set(0,0.98,BULK-0.1);cabin.add(cu);
 const rw=mesh(new THREE.ExtrudeGeometry(sectionShape(0,1.64),{depth:0.06,bevelEnabled:false}),M.wall,true,true);rw.position.set(0,0,ZE-0.03);cabin.add(rw);
 for(const zz of[BULK-0.06,ZE-0.03]){const u=mesh(new THREE.ExtrudeGeometry(sectionShape(1.64,2.32),{depth:0.06,bevelEnabled:false}),M.wall,true,true);u.position.set(0,0,zz);upper.add(u)}
 for(const dx of[-0.55,0.55]){const d=mesh(plate(0.7,1.86,0.05,0.02,0.006),M.psu);d.position.set(dx,0.95,ZE-0.04);cabin.add(d);const h=mesh(new THREE.BoxGeometry(0.12,0.025,0.03),M.metal);h.position.set(dx+(dx<0?0.25:-0.25),0.98,ZE-0.06);cabin.add(h)}}

/* ---------- seat parts (sculpted, instanced) ---------- */
const P={};
function backOutline(wb,ws,wt,h){const s=new THREE.Shape();
  s.moveTo(-wb/2,0);s.lineTo(wb/2,0);
  s.bezierCurveTo(wb/2+0.012,h*0.32,ws/2+0.01,h*0.52,ws/2,h*0.66);
  s.bezierCurveTo(ws/2-0.006,h*0.86,wt/2+0.03,h*0.995,0,h);
  s.bezierCurveTo(-wt/2-0.03,h*0.995,-ws/2+0.006,h*0.86,-ws/2,h*0.66);
  s.bezierCurveTo(-ws/2-0.01,h*0.52,-wb/2-0.012,h*0.32,-wb/2,0);return s}
const W=SW-0.04;
(function(){
  let g=new THREE.ExtrudeGeometry(backOutline(W,W+0.008,W-0.11,BH),{depth:1,bevelEnabled:true,bevelSize:0.016,bevelThickness:0.02,bevelSegments:5,curveSegments:24,steps:1});
  P.shell=sculpt(g,(x,y,z)=>{const t=Math.max(0,Math.min(1,y/BH));const k=(z+0.02)/1.04;return [x,y,k*shellZ(t)]});
  g=new THREE.ExtrudeGeometry(backOutline(W-0.03,W-0.02,W-0.14,BH-0.03),{depth:1,bevelEnabled:true,bevelSize:0.022,bevelThickness:0.022,bevelSegments:6,curveSegments:24,steps:1});
  P.pad=sculpt(g,(x,y,z)=>{const t=Math.max(0,Math.min(1,y/(BH-0.03)));const k=(z+0.022)/1.044;const xn=x/((W-0.02)/2);return [x,y+0.015,padZ(t,xn)*(1-k)+0.012*k]});
  // seams on the backrest: lumbar/headrest split + side bolster lines
  const padPt=(t,xn)=>[xn*(W-0.05)/2,t*(BH-0.03)+0.015,padZ(t,xn)-0.004];
  P.seamH=tube(Array.from({length:9},(_,i)=>padPt(0.72,-0.8+i*0.2)));
  P.seamV=tube(Array.from({length:8},(_,i)=>padPt(0.08+i*0.09,0.62)));
  P.seamV2=tube(Array.from({length:8},(_,i)=>padPt(0.08+i*0.09,-0.62)));
  // cushion: crowned top, waterfall front edge
  const cs=new THREE.Shape();const cw=W-0.01,cd=0.5;cs.moveTo(-cw/2+0.05,-cd/2);cs.lineTo(cw/2-0.05,-cd/2);cs.quadraticCurveTo(cw/2+0.005,-cd/2,cw/2,-cd/2+0.06);cs.lineTo(cw/2-0.008,cd/2-0.03);cs.quadraticCurveTo(cw/2-0.01,cd/2,cw/2-0.04,cd/2);cs.lineTo(-cw/2+0.04,cd/2);cs.quadraticCurveTo(-cw/2+0.01,cd/2,-cw/2+0.008,cd/2-0.03);cs.lineTo(-cw/2,-cd/2+0.06);cs.quadraticCurveTo(-cw/2-0.005,-cd/2,-cw/2+0.05,-cd/2);
  g=new THREE.ExtrudeGeometry(cs,{depth:0.085,bevelEnabled:true,bevelSize:0.026,bevelThickness:0.026,bevelSegments:6,curveSegments:16});g.rotateX(-Math.PI/2);
  const cy=(x,z)=>{const xn=x/(cw/2),front=Math.max(0,(-z-0.12)/0.14);return 0.111+0.014*(1-xn*xn)-0.035*front*front};
  P.cushion=sculpt(g,(x,y,z)=>{const xn=x/(cw/2),front=Math.max(0,(-z-0.12)/0.14),top=Math.max(0,y)/0.111;return [x,y+0.014*(1-xn*xn)*top-0.035*front*front*(0.4+0.6*top),z]});
  P.cseam=tube(Array.from({length:9},(_,i)=>{const x=-0.17+i*0.0425;return [x,cy(x,-0.1)+0.001,-0.1]}));
  P.cseam2=tube(Array.from({length:7},(_,i)=>{const z=-0.09+i*0.05;return [0.13,cy(0.13,z)+0.001,z]}));
  P.cseam3=tube(Array.from({length:7},(_,i)=>{const z=-0.09+i*0.05;return [-0.13,cy(-0.13,z)+0.001,z]}));
  P.cushBase=extrudeX(rrect(0.46,0.05,0.02),W-0.02,0.008);
  // headrest: winged cushion with linen cover
  const hw=W-0.05;
  P.head=sculpt(plate(hw,0.23,0.07,0.03,0.014,5),(x,y,z)=>[x,y,z-0.035*Math.pow(Math.abs(x)/(hw/2),4)]);
  P.cover=sculpt(plate(hw-0.05,0.17,0.05,0.002,0.002,2),(x,y,z)=>[x,y,z-0.035*Math.pow(Math.abs(x)/(hw/2),4)]);
  // armrest: rounded body, soft top pad, metal hinge boss, recline button
  P.arm=extrudeX(rrect(0.40,0.05,0.024),0.052,0.014);
  P.armPad=extrudeX(rrect(0.3,0.016,0.008),0.05,0.006);
  P.armPost=extrudeX(rrect(0.07,0.2,0.02),0.04,0.008);
  P.hinge=new THREE.CylinderGeometry(0.026,0.026,0.058,24);P.hinge.rotateZ(Math.PI/2);
  P.btn=new THREE.CylinderGeometry(0.008,0.008,0.006,16);
  // tray table, recess, latch, side arms
  P.tray=plate(0.34,0.25,0.035,0.012,0.004);P.trayRecess=plate(0.37,0.28,0.04,0.004,0.002);
  P.latch=plate(0.04,0.016,0.007,0.01,0.003);P.trayArm=plate(0.014,0.32,0.006,0.008,0.002);
  P.trayHinge=new THREE.CylinderGeometry(0.009,0.009,0.03,16);P.trayHinge.rotateZ(Math.PI/2);
  // seat pocket with elastic band and safety card
  P.pocket=sculpt(plate(0.34,0.15,0.035,0.016,0.004),(x,y,z)=>[x,y,z+0.012*(1-Math.pow(x/0.17,2))*(y<0?1:0.3)]);
  P.band=plate(0.32,0.016,0.006,0.012,0.002);P.card=new THREE.BoxGeometry(0.15,0.2,0.003);
  P.ped=plate(0.12,0.022,0.008,0.03,0.003);P.hook=plate(0.03,0.04,0.012,0.016,0.004);
  // structure: legs, cross tubes, track feet, life-vest pouch, belt
  P.leg=new THREE.CylinderGeometry(0.013,0.017,0.36,14);P.beam=new THREE.CylinderGeometry(0.019,0.019,3*SW,16);P.beam.rotateZ(Math.PI/2);
  P.foot=plate(0.05,0.06,0.01,0.02,0.004);P.vest=plate(0.2,0.12,0.02,0.035,0.008);
  P.buckle=plate(0.055,0.03,0.008,0.01,0.002);P.strap=new THREE.BoxGeometry(0.038,0.004,0.17);
  P.ao=new THREE.PlaneGeometry(1,1);P.ao.rotateX(-Math.PI/2);
})();
const AO_M=new THREE.MeshBasicMaterial({color:0x000000,alphaMap:blobTex(),transparent:true,opacity:.5,depthWrite:false});
for(let r=1;r<=30;r++){
  for(const Lt of LETTERS){const s=SEATS[r+Lt],x=seatX(Lt),bz=backZ[r],cover=s.pitch>29?M.fabricXL:M.fabric;curTag=s.id;
    const base=new THREE.Matrix4().makeTranslation(x,0,bz);
    curPart="base";
    put(P.cushBase,M.trim,base,0,0.305,-0.25);
    put(P.cushion,cover,base,0,0.33,-0.24,-0.04);
    for(const sg of[P.cseam,P.cseam2,P.cseam3])put(sg,M.seam,base,0,0.33,-0.24,-0.04,0,1,1,1,false);
    put(P.vest,M.vest,base,0,0.25,-0.33,Math.PI/2,0,1,1,1,false);
    curPart="belt";
    put(P.buckle,M.metal,base,0.035,0.46,-0.21,-Math.PI/2+0.04,0.2,1,1,1,false);put(P.strap,M.trim,base,-0.11,0.452,-0.22,-0.04,0.12,1,1,1,false);put(P.strap,M.trim,base,0.13,0.452,-0.2,-0.04,-0.1,1,1,1,false);
    const back=new THREE.Matrix4().multiplyMatrices(base,new THREE.Matrix4().compose(new THREE.Vector3(0,PIVOT_Y,PIVOT_Z),new THREE.Quaternion().setFromEuler(new THREE.Euler(reclineA(s),0,0)),new THREE.Vector3(1,1,1)));
    curPart="back";
    put(P.shell,M.shell,back,0,0,0);put(P.pad,cover,back,0,0,0);
    for(const sg of[P.seamH,P.seamV,P.seamV2])put(sg,M.seam,back,0,0,0,0,0,1,1,1,false);
    const yh=0.86*(BH-0.03)+0.015,zh=padZ(0.86,0)-0.012;put(P.head,cover,back,0,yh,zh,0.03);put(P.cover,M.linen,back,0,yh+0.01,zh-0.02,0.03,0,1,1,1,false);
    const tt=0.6,yt=tt*BH;put(P.trayRecess,M.trim,back,0,yt,shellZ(tt)+0.002,-0.03);
    for(const sx of[-1,1])put(P.trayArm,M.trim,back,sx*0.178,0.2,shellZ(0.26)+0.006,-0.05,0,1,1,1,false);
    put(P.ped,M.trim,back,0,0.93*BH,shellZ(0.93)+0.004,-0.12,0,1,1,1,false);put(P.hook,M.trim,back,0.15,0.86*BH,shellZ(0.86)+0.006,-0.1,0,1,1,1,false);
    put(P.pocket,M.pocket,back,0,0.2,shellZ(0.26)+0.004);put(P.band,M.trim,back,0,0.272,shellZ(0.35)+0.014,0,0,1,1,1,false);
    if(rnd(r*13+Lt.charCodeAt(0))>0.25)put(P.card,M.card,back,-0.06,0.27,shellZ(0.35)+0.008,0,0.04,1,1,1,false);
    curPart="tray";
    put(P.tray,M.tray,back,0,yt,shellZ(tt)+0.008,-0.03);put(P.latch,M.trim,back,0,yt+0.155,shellZ(0.8)+0.006,-0.08,0,1,1,1,false);
    for(const sx of[-1,1])put(P.trayHinge,M.metalDark,back,sx*0.178,yt-0.118,shellZ(tt)+0.012,0,0,1,1,1,false);
    const arm=(ax,part)=>{curPart=part;put(P.arm,M.trim,base,ax,0.6,-0.22);put(P.armPad,M.armPad,base,ax,0.631,-0.25);put(P.armPost,M.trim,base,ax,0.49,-0.06);put(P.hinge,M.metalDark,base,ax,0.58,-0.03,0,0,1,1,1,false);
      put(P.btn,M.metal,base,ax,0.63,-0.39,0,0,1,1,1,false)};
    arm(-SW/2+0.005,"armL");if(Lt==="C"||Lt==="F")arm(SW/2-0.005,"armR");
  }
  curTag=null;curPart=null;
  for(const side of[-1,1]){const xx=side*(AISLE/2+1.5*SW);
    put(P.ao,AO_M,null,xx,0.023,backZ[r]-0.24,0,0,3*SW+0.14,1,0.72,false);
    for(const bz of[-0.42,-0.12])put(P.beam,M.metal,null,xx,0.29,backZ[r]+bz,0,0,1,1,1,false);
    for(const lx of[-0.62,0.62])for(const lz of[-0.42,-0.1]){put(P.leg,M.metal,null,xx+lx,0.15,backZ[r]+lz,lz<-0.2?0:0.12,0,1,0.83,1,false);put(P.foot,M.metalDark,null,xx+lx,0.02,backZ[r]+lz,Math.PI/2,0,1,1,1,false)}}
}
const highlightMeshes=[],instMeshes=[];
for(const it of instances.values()){const im=new THREE.InstancedMesh(it.geo,it.mat,it.list.length);it.im=im;im.userData.it=it;instMeshes.push(im);it.list.forEach((m,i)=>im.setMatrixAt(i,m));im.castShadow=it.cast;im.receiveShadow=it.mat!==AO_M;im.instanceMatrix.needsUpdate=true;
  if(it.geo===P.cushion||it.geo===P.pad||it.geo===P.head){const white=new THREE.Color(1,1,1);for(let i=0;i<it.list.length;i++)im.setColorAt(i,white);im.instanceColor.needsUpdate=true;im.userData.tags=it.tags;highlightMeshes.push(im)}
  if(it.mat===AO_M)im.renderOrder=1;
  (it.geo===LATCH||it.geo===SIGNG||it.geo===LAMPG||it.geo===GASP?upper:scene).add(im)}
// floor path lights
{const dotG=new THREE.BoxGeometry(0.012,0.004,0.03),dotM=new THREE.MeshBasicMaterial({color:new THREE.Color(1.4,1.2,.9)});
 const n=Math.floor((ZE-BULK)/0.6);const im=new THREE.InstancedMesh(dotG,dotM,n*2);let i=0;
 for(let k=0;k<n;k++)for(const sx of[-1,1])im.setMatrixAt(i++,new THREE.Matrix4().makeTranslation(sx*(AISLE/2+0.01),0.017,BULK+0.3+k*0.6));scene.add(im)}

/* Seat parts registry: hide the instanced copies of one seat's parts and return standalone meshes in the same
   place, so the selected seat's tray, armrests, belt and back can move without touching the other 179 seats. */
const ZERO=new THREE.Matrix4().makeScale(0,0,0);
function seatPartEntries(id,parts){const out=[];for(const im of instMeshes){const it=im.userData.it;for(let i=0;i<it.tags.length;i++)if(it.tags[i]===id&&parts.includes(it.parts[i]))out.push({im,i,geo:it.geo,mat:it.mat,matrix:it.list[i],part:it.parts[i],cast:it.cast})}return out}
function detachSeatParts(id,parts){const ents=seatPartEntries(id,parts),meshes=[];
  for(const e of ents){e.im.setMatrixAt(e.i,ZERO);e.im.instanceMatrix.needsUpdate=true;const m=new THREE.Mesh(e.geo,e.mat);m.matrixAutoUpdate=false;m.matrix.copy(e.matrix);m.castShadow=e.cast;m.receiveShadow=true;m.userData.part=e.part;meshes.push(m)}
  return {meshes,restore(){for(const e of ents){e.im.setMatrixAt(e.i,e.matrix);e.im.instanceMatrix.needsUpdate=true}for(const m of meshes)m.parent&&m.parent.remove(m);renderer.shadowMap.needsUpdate=true;dirty=true}}}

/* ---------- outside: wing, engine, sky ---------- */
/* Lofted airfoil surfaces (wings, sharklets, fin, stabilisers). Each station: leading-edge point o, chord c along +z,
   thickness ratio t along the unit vector th. NACA-style thickness, light camber; indexed so normals are smooth,
   with a separate trailing-edge seam so the TE stays crisp. Proportions are A320-like, not an engineering model. */
const NACA=x=>5*(0.2969*Math.sqrt(x)-0.126*x-0.3516*x*x+0.2843*x*x*x-0.1036*x*x*x*x);
function loft(st,nA=30,cap=true){const pos=[],idx=[],ring=2*nA;
  for(const S of st){const th=new THREE.Vector3(...S.th).normalize();
    for(let i=0;i<ring;i++){const up=i<nA,k=up?i:ring-1-i;const x=(1-Math.cos(Math.PI*k/(nA-1)))/2;const half=S.t*S.c*NACA(x),cam=(S.m??0.02)*S.c*4*x*(1-x)*(S.cd??1);
      const off=up?cam+half:cam-half;pos.push(S.o[0]+th.x*off,S.o[1]+th.y*off,S.o[2]+x*S.c+th.z*off)}}
  for(let j=0;j<st.length-1;j++)for(let i=0;i<ring-1;i++){const a=j*ring+i,b=a+1,c=a+ring,d=c+1;idx.push(a,c,b,b,c,d)}
  if(cap){const base=(st.length-1)*ring,cI=pos.length/3;let cx=0,cy=0,cz=0;for(let i=0;i<ring;i++){cx+=pos[(base+i)*3];cy+=pos[(base+i)*3+1];cz+=pos[(base+i)*3+2]}pos.push(cx/ring,cy/ring,cz/ring);
    for(let i=0;i<ring-1;i++)idx.push(base+i,base+i+1,cI)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  // flip if wound inside-out (depends on station direction)
  return g}
function surfLine(st,f,lift=0.012,r=0.016){const pts=st.map(S=>{const th=new THREE.Vector3(...S.th).normalize(),half=S.t*S.c*NACA(f),cam=(S.m??0.02)*S.c*4*f*(1-f)*(S.cd??1);return new THREE.Vector3(S.o[0]+th.x*(cam+half+lift),S.o[1]+th.y*(cam+half+lift),S.o[2]+f*S.c+th.z*(cam+half+lift))});
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),pts.length*6,r,5,false)}
M.wingPaint=std({color:0xaeb5be,roughness:.46,metalness:.22,envMapIntensity:.8,side:THREE.DoubleSide});
M.wingLower=std({color:0x8e959f,roughness:.5,metalness:.2,envMapIntensity:.8,side:THREE.DoubleSide});
M.panelLine=std({color:0x7d858f,roughness:.6});
M.nacelle=std({color:0xe9e6df,roughness:.3,metalness:.08,envMapIntensity:1});
M.intake=std({color:0x2d3138,roughness:.45,metalness:.5,side:THREE.DoubleSide});
M.fan=std({color:0x50565e,roughness:.3,metalness:.9,envMapIntensity:1.1});
M.coreCowl=std({color:0x8d939b,roughness:.38,metalness:.7,side:THREE.DoubleSide});
const WING={le0:backZ[8]+0.1,xr:1.7,yr:-0.48,sweep:Math.tan(THREE.MathUtils.degToRad(27)),dih:Math.tan(THREE.MathUtils.degToRad(5.5))};
function wingStations(){const W=WING,le=x=>W.le0+(x-W.xr)*W.sweep,y=x=>W.yr+(x-W.xr)*W.dih;
  const te=x=>x<=7.2?W.le0+6.25+(x-W.xr)/(7.2-W.xr)*0.35:W.le0+6.6+(x-7.2)/(16.6-7.2)*((le(16.6)+1.5)-(W.le0+6.6));
  return [W.xr,3.2,5.2,7.2,10,13.2,16.6].map((x,i,a)=>{const t=0.145-0.04*(x-W.xr)/(16.6-W.xr);return {o:[x,y(x),le(x)],c:te(x)-le(x),t,th:[0,1,0]}})}
function sharkletStations(tip){const [x,y,z]=tip.o,c=tip.c;
  return [tip,{o:[x+0.25,y+0.3,z+0.35],c:c*0.82,t:0.1,th:[-0.5,1,0]},{o:[x+0.38,y+0.8,z+0.75],c:c*0.62,t:0.1,th:[-1,0.35,0]},{o:[x+0.42,y+1.6,z+1.15],c:c*0.45,t:0.1,th:[-1,0.08,0]},{o:[x+0.44,y+2.3,z+1.45],c:c*0.32,t:0.1,th:[-1,0,0]}]}
function buildWing(side){const g=new THREE.Group();const st=wingStations(),tip=st[st.length-1];
  const top=mesh(loft(st,34,false),M.wingPaint,true,true);g.add(top);
  g.add(mesh(loft(sharkletStations(tip),20,true),M.wingPaint,true,true));
  // panel lines: front spar/slat seam, flap/aileron hinge line, a spoiler row (thin, restrained)
  for(const [f,a,b] of[[0.13,0,7],[0.72,1,7],[0.6,1,4]]){const sub=st.slice(a,b);if(sub.length>1)g.add(mesh(surfLine(sub,f,0.006,0.012),M.panelLine,false,false))}
  // flap-track fairings (canoes) under the trailing edge
  for(const x of[4.4,8.2,11.3]){const S=st.find((q,i)=>st[i+1]&&st[i+1].o[0]>=x)||st[1];const k=(x-S.o[0]);const le=WING.le0+(x-WING.xr)*WING.sweep,yy=WING.yr+(x-WING.xr)*WING.dih;
    const cg=new THREE.SphereGeometry(1,28,14);cg.scale(0.13,0.2,1.35);const cm=mesh(cg,M.wingLower,true,true);cm.position.set(x,yy-0.2,le+S.c*0.92+0.4);g.add(cm)}
  // engine: lathe-profiled nacelle, dark intake, fan with spinner, core cowl, exhaust plug, pylon
  const ex=5.6,ey=-1.62,ez=WING.le0+(ex-WING.xr)*WING.sweep-2.25,E=new THREE.Group();E.position.set(ex,ey,ez);g.add(E);
  const lathe=(pts,mat,seg=72)=>{const ge=new THREE.LatheGeometry(pts.map(([r,a])=>new THREE.Vector2(r,a)),seg);ge.rotateX(Math.PI/2);const m=mesh(ge,mat,true,true);E.add(m);return m};
  lathe([[0.86,0.62],[0.875,0.3],[0.9,0.1],[0.95,0.015],[1.0,0],[1.045,0.05],[1.075,0.22],[1.095,0.65],[1.09,1.6],[1.05,2.6],[0.96,3.35],[0.86,3.82]],M.nacelle);
  lathe([[0.86,0.62],[0.862,0.66],[0.86,0.9]],M.intake);
  lathe([[0.66,3.6],[0.64,3.95],[0.58,4.5],[0.49,4.95],[0.45,5.05]],M.coreCowl);
  lathe([[0.001,5.75],[0.12,5.6],[0.27,5.3],[0.34,5.06],[0.33,4.95]],M.fan,48);
  lathe([[0.001,0.38],[0.1,0.46],[0.2,0.6],[0.28,0.78],[0.3,0.88]],M.fan,48);
  {const bl=new THREE.BoxGeometry(0.035,0.56,0.012);bl.translate(0,0.58,0);const im=new THREE.InstancedMesh(bl,M.intake,18);const q=new THREE.Quaternion(),e=new THREE.Euler();
   for(let i=0;i<18;i++){e.set(0,0,i/18*Math.PI*2);q.setFromEuler(e);const tw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.55);q.multiply(tw);im.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(0,0,0.86),q,new THREE.Vector3(1,1,1)))}E.add(im)}
  {const sh=new THREE.Shape();const yl=WING.yr+(ex-WING.xr)*WING.dih-0.32-ey;sh.moveTo(0.6,0.95);sh.lineTo(1.4,yl+0.15);sh.quadraticCurveTo(3.6,yl+0.35,5.4,yl+0.05);sh.lineTo(5.3,0.62);sh.quadraticCurveTo(3.2,0.98,0.6,0.95);
   const pg=smoothNormals(new THREE.ExtrudeGeometry(sh,{depth:0.26,bevelEnabled:true,bevelSize:0.05,bevelThickness:0.05,bevelSegments:4,curveSegments:16}),40);pg.rotateY(-Math.PI/2);pg.translate(0.13,0,0);
   // shape x is axial (z after rotation), y is up
   const pm=mesh(pg,M.wingLower,true,true);E.add(pm)}
  g.scale.x=side;return g}
scene.add(buildWing(-1),buildWing(1));
/* wing-to-body fairing under the centre section */
{const fg=new THREE.SphereGeometry(1,48,24,0,Math.PI*2,Math.PI*0.42,Math.PI*0.58);fg.scale(2.05,0.95,5.2);const fm=mesh(fg,std({color:0xd9dde2,roughness:.4,metalness:.12,envMapIntensity:.9}),true,true);fm.position.set(0,-0.34,WING.le0+3.0);scene.add(fm)}
const SUN_DIR=new THREE.Vector3(-0.68,0.52,0.52).normalize(); // updated by scenery presets
{const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(new THREE.RoomEnvironment(),0.04).texture;pm.dispose()}

/* ---------- lights: sun through the windows, soft wash from bin-edge and cove strips ---------- */
scene.add(new THREE.HemisphereLight(0xf4f1ea,0x3a3732,0.3));
const sun=new THREE.DirectionalLight(0xfff0dc,3.6);sun.castShadow=true;sun.shadow.mapSize.set(QUALITY.low?1024:4096,QUALITY.low?1024:4096);sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.03;sun.shadow.radius=2.5;
Object.assign(sun.shadow.camera,{left:-16,right:16,top:5,bottom:-5,near:1,far:40});scene.add(sun,sun.target);
for(const side of[-1,1]){const a=new THREE.RectAreaLight(0xfff1e0,1.6,0.12,L);a.position.set(side*1.16,1.6,Z0+L/2);a.rotation.set(-Math.PI/2,0,0);scene.add(a)}
{const c=new THREE.RectAreaLight(0xf2f2f0,0.55,2.6,L);c.position.set(0,2.25,Z0+L/2);c.rotation.set(-Math.PI/2,0,0);scene.add(c)}
let shadowAt=null;
function placeSun(p){if(shadowAt&&shadowAt.distanceTo(p)<0.01)return;shadowAt=p.clone();sun.position.set(SUN_DIR.x*18,1+SUN_DIR.y*18,p.z+SUN_DIR.z*18-5);sun.target.position.set(0,1,p.z-5);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true}


/* =====================================================================
   AIRCRAFT CUTAWAY: simplified fuselage shell, nose, tail, midnight studio
   ===================================================================== */
const RO=2.06, CUT_Y=1.64, thC=Math.acos((CY-CUT_Y)/RO), ZC=(Z0+ZE)/2;
const exterior=new THREE.Group();scene.add(exterior);
M.skin=std({color:0xeeebe3,roughness:.34,metalness:.06,envMapIntensity:.9,side:THREE.DoubleSide});
M.belly=std({color:0x0b1533,roughness:.55,metalness:.05,envMapIntensity:.45,side:THREE.DoubleSide});
M.cutEdge=std({color:0xe2dccd,roughness:.55});
M.glass=std({color:0x0d1424,roughness:.08,metalness:.3,envMapIntensity:1.4,side:THREE.DoubleSide});
function hull(th0,th1,z0,z1,nth,nz,prof){const pos=[],uv=[],idx=[];
  for(let j=0;j<=nz;j++){const t=j/nz,z=z0+(z1-z0)*t,p=prof(t);
    for(let i=0;i<=nth;i++){const th=th0+(th1-th0)*i/nth;pos.push(p.r*Math.sin(th),p.cy-p.r*Math.cos(th),z);uv.push(t,i/nth)}}
  for(let j=0;j<nz;j++)for(let i=0;i<nth;i++){const a=j*(nth+1)+i,b=a+1,c=a+nth+1,d=c+1;idx.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setIndex(idx);g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g}
const cyl=()=>({r:RO,cy:CY});
exterior.add(mesh(hull(-thC,thC,Z0,ZE,96,1,cyl),M.skin,true,true));
exterior.add(mesh(hull(-0.72,0.72,Z0,ZE,24,1,()=>({r:RO+0.003,cy:CY})),M.belly,false,true));
// exterior window line, drawn on a thin band at the real window positions
{const W=4096,H=64,c=mkCanvas(W,H),g=c.getContext("2d");g.fillStyle="#0e1628";
  for(const z of WIN){const x=(z-Z0)/L*W,w=WIN_W/L*W*1.05;g.beginPath();g.roundRect?g.roundRect(x-w/2,10,w,44,w*0.45):g.rect(x-w/2,10,w,44);g.fill()}
  const t=new THREE.CanvasTexture(c);t.anisotropy=maxAniso;t.encoding=THREE.sRGBEncoding;
  const wm=std({map:t,transparent:true,alphaTest:0.4,roughness:.1,metalness:.3,envMapIntensity:1.3,side:THREE.DoubleSide});
  const th=y=>Math.acos((CY-y)/(RO+0.004));
  // canvas alpha = drawn windows only
  const a=mkCanvas(W,H),ag=a.getContext("2d");ag.drawImage(c,0,0);const id=ag.getImageData(0,0,W,H);for(let i=0;i<id.data.length;i+=4){const on=id.data[i+3]>0;id.data[i]=id.data[i+1]=id.data[i+2]=on?255:0;id.data[i+3]=255}ag.putImageData(id,0,0);
  wm.alphaMap=new THREE.CanvasTexture(a);
  for(const side of[-1,1]){const g2=hull(side*th(1.0),side*th(1.44),Z0,ZE,4,1,()=>({r:RO+0.004,cy:CY}));exterior.add(mesh(g2,wm,false,false))}}
// cut edge: the fuselage wall sliced open (skin, frame depth, lining), with frame stubs on the frame pitch and a fine amber line
M.frameStub=std({color:0xb9b2a3,roughness:.6});M.cutLine=new THREE.MeshBasicMaterial({color:new THREE.Color(0.95,0.62,0.22)});
for(const side of[-1,1]){const xi=Math.sqrt(R*R-(CUT_Y-CY)**2),xo=Math.sqrt(RO*RO-(CUT_Y-CY)**2);
  const e=mesh(plate(L,0.03,0.008,xo-xi,0.006,2).rotateY(Math.PI/2).rotateZ(0),M.cutEdge,false,true);e.position.set(side*(xi+xo)/2,CUT_Y-0.012,ZC);exterior.add(e);
  const ln=new THREE.Mesh(new THREE.BoxGeometry(0.008,0.004,L),M.cutLine);ln.position.set(side*(xi+0.004),CUT_Y+0.006,ZC);exterior.add(ln);
  const fs=new THREE.BoxGeometry(xo-xi-0.02,0.012,0.05),n=Math.floor(L/0.535),im=new THREE.InstancedMesh(fs,M.frameStub,n);
  for(let k=0;k<n;k++)im.setMatrixAt(k,new THREE.Matrix4().makeTranslation(side*(xi+xo)/2,CUT_Y+0.009,Z0+0.27+k*0.535));exterior.add(im)}
// nose and tail (closed), end caps
const NOSE=5.4,TAIL=9.6;
exterior.add(mesh(hull(-Math.PI,Math.PI,Z0,Z0-NOSE,72,28,t=>({r:RO*Math.pow(Math.max(0,1-Math.pow(t,2.3)),0.5),cy:CY-0.55*t*t})),M.skin,true,true));
exterior.add(mesh(hull(Math.PI-0.62,Math.PI+0.62,Z0-NOSE*0.52,Z0-NOSE*0.74,16,8,t=>{const tt=0.52+0.22*t;return {r:RO*Math.pow(Math.max(0,1-Math.pow(tt,2.3)),0.5)+0.006,cy:CY-0.55*tt*tt}}),M.glass,false,false));
exterior.add(mesh(hull(-Math.PI,Math.PI,ZE,ZE+TAIL,72,24,t=>({r:RO*(1-0.86*Math.pow(t,1.25)),cy:CY+0.95*Math.pow(t,1.5)})),M.skin,true,true));
for(const [z,dir] of[[Z0,1],[ZE+0.035,-1]]){const d=mesh(new THREE.CircleGeometry(RO-0.01,64),M.cutEdge,false,true);d.position.set(0,CY,z);if(dir<0)d.rotation.y=Math.PI;exterior.add(d)}
// vertical fin and stabilisers (lofted airfoils, same construction as the wings)
{const fin=[{o:[0,2.35,ZE+3.4],c:5.4,t:0.11,th:[1,0,0],m:0},{o:[0,4.8,ZE+6.4],c:3.0,t:0.1,th:[1,0,0],m:0},{o:[0,7.25,ZE+8.6],c:1.6,t:0.1,th:[1,0,0],m:0}];
 exterior.add(mesh(loft(fin,26,true),M.belly,true,true));
 for(const side of[-1,1]){const d=Math.tan(THREE.MathUtils.degToRad(6));const st=[{o:[0.3,1.95,ZE+6.0],c:3.2,t:0.1,th:[0,1,0],m:0},{o:[3.2,1.95+2.9*d,ZE+7.6],c:2.0,t:0.1,th:[0,1,0],m:0},{o:[6.1,1.95+5.8*d,ZE+9.0],c:1.1,t:0.1,th:[0,1,0],m:0}];
   const m=mesh(loft(st,24,true),M.skin,true,true);m.scale.x=side;exterior.add(m)}}
// midnight studio: gradient dome + soft contact shadow under the aircraft
const studio=new THREE.Group();scene.add(studio);
const studioMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,transparent:true,uniforms:{op:{value:1}},
  vertexShader:"varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader:"varying vec3 vP;uniform float op;void main(){float h=vP.y;vec3 top=vec3(.035,.055,.12),hor=vec3(.085,.12,.22),bot=vec3(.025,.035,.07);vec3 c=h>0.?mix(hor,top,pow(clamp(h,0.,1.),.55)):mix(hor,bot,pow(clamp(-h,0.,1.),.45));gl_FragColor=vec4(c,op);}"});
{const dome=new THREE.Mesh(new THREE.SphereGeometry(160,48,24),studioMat);dome.position.set(0,0,ZC);dome.renderOrder=-5;studio.add(dome);
 const blob=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x000000,alphaMap:blobTex(),transparent:true,opacity:.55,depthWrite:false}));
 blob.rotation.x=-Math.PI/2;blob.scale.set(9,L+NOSE+TAIL,1);blob.position.set(0,-3.05,ZC+1.5);studio.add(blob);
 const wingBlob=blob.clone();wingBlob.material=blob.material;wingBlob.scale.set(38,11,1);wingBlob.position.set(0,-3.07,(backZ[8]+backZ[16])/2+3.5);studio.add(wingBlob);
 const floorGlow=new THREE.Mesh(new THREE.CircleGeometry(30,64),new THREE.MeshBasicMaterial({color:new THREE.Color(0.018,0.03,0.06),transparent:true,opacity:.7,alphaMap:blobTex(),depthWrite:false}));
 floorGlow.rotation.x=-Math.PI/2;floorGlow.position.set(0,-3.1,ZC);studio.add(floorGlow)}

/* ---------- fade groups (materials cloned so cabin and upper fade independently) ---------- */
function under(o,g){for(let p=o;p;p=p.parent)if(p===g)return true;return false}
function isolate(group){const outside=new Set();scene.traverse(o=>{if(o.material&&!under(o,group))[].concat(o.material).forEach(m=>outside.add(m))});
  const map=new Map();group.traverse(o=>{if(!o.material||Array.isArray(o.material))return;if(outside.has(o.material)){if(!map.has(o.material))map.set(o.material,o.material.clone());o.material=map.get(o.material)}});
  const mats=new Set();group.traverse(o=>{if(o.material)[].concat(o.material).forEach(m=>mats.add(m))});return [...mats]}
const UPPER_MATS=isolate(upper), EXT_MATS=isolate(exterior), STUDIO_MATS=[...new Set(studio.children.map(c=>c.material))].filter(m=>m!==studioMat);
const baseOpacity=new Map();for(const m of[...UPPER_MATS,...EXT_MATS,...STUDIO_MATS])baseOpacity.set(m,{o:m.opacity,t:m.transparent});
function fadeGroup(group,mats,a){a=Math.max(0,Math.min(1,a));group.visible=a>0.004;for(const m of mats){const b=baseOpacity.get(m);m.opacity=b.o*a;const tr=b.t||a<0.999;if(m.transparent!==tr){m.transparent=tr;m.needsUpdate=true}}}
const fades={upper:1,ext:1,studio:1};
function applyFades(f){Object.assign(fades,f);fadeGroup(upper,UPPER_MATS,fades.upper);fadeGroup(exterior,EXT_MATS,fades.ext);fadeGroup(studio,STUDIO_MATS,fades.studio);studioMat.uniforms.op.value=fades.studio;
  const on=fades.ext>0.5;if(on!==extCasting){extCasting=on;exterior.traverse(o=>{if(o.isMesh){if(o.userData.cast===undefined)o.userData.cast=o.castShadow;o.castShadow=on&&o.userData.cast}});renderer.shadowMap.needsUpdate=true}}
let extCasting=true;

/* ---------- selected-seat illumination ---------- */
const selLight=new THREE.SpotLight(0xffb44d,0,7,0.2,0.75,0);scene.add(selLight,selLight.target);
let selGlow=0;
function aimSelLight(id){const s=SEATS[id],x=seatX(s.letter),z=backZ[s.row]-0.25;selLight.position.set(x,3.6,z+0.2);selLight.target.position.set(x,0.5,z);selLight.target.updateMatrixWorld()}

/* =====================================================================
   CAMERA: aircraft orbit  ⇄  planned path  ⇄  seated eye (rotate only)
   ===================================================================== */
const app=document.getElementById("app"),markersEl=document.getElementById("markers"),fadeEl=document.getElementById("fade");
let view="AIR",selected="14A",hover=null,recs=[],cmp={a:null,b:null},seatView="F",dirty=true,anim=null,trans=null;
/* seats linked from the engineering trace: tone rec | excl | sel */
let focus={seats:[],tone:null};
let yaw=0,pitch=-0.1,transW=0;const eye=new THREE.Vector3();
const air={target:new THREE.Vector3(0,0.4,ZC+0.8),az:-0.95,pol:0.92,zoom:1};
const airGoal={target:air.target.clone(),zoom:1};
/* Fit-to-screen: solve the camera distance so the nose, tail, wingtips and engines fit the area left free by the
   panels (with margins). Zoom is a factor on top of that, so the composition holds at any window size. */
const FIT_SEG=[[[0,CY,Z0-5.4],[0,CY+0.9,ZE+9.6]],[[0,-1.05,Z0],[0,-1.05,ZE]],[[-1.8,-0.3,backZ[8]],[-17.4,1.6,backZ[8]+8.5]],[[1.8,-0.3,backZ[8]],[17.4,1.6,backZ[8]+8.5]],[[-1.8,-0.3,backZ[8]+6.3],[-17,1.4,backZ[8]+9.6]],[[1.8,-0.3,backZ[8]+6.3],[17,1.4,backZ[8]+9.6]],
  [[-5.6,-2.75,backZ[8]-0.3],[5.6,-2.75,backZ[8]-0.3]],[[-6.4,1.95,ZE+9.6],[6.4,1.95,ZE+9.6]],[[0,7.4,ZE+9.9],[0,2.4,ZE+3]]];
const FIT_PTS=[];for(const [p,q] of FIT_SEG)for(let i=0;i<=6;i++){const t=i/6;FIT_PTS.push(new THREE.Vector3(p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t))}
const fitCam=new THREE.PerspectiveCamera();let fitCache={key:"",d:40};
/* panels the aircraft should not sit under (desktop card and dock, mobile sheet), in canvas pixels */
function fitObstacles(){const cr=canvas.getBoundingClientRect(),out=[];for(const id of["card","dock","sheet","ctrlBar"]){const el=document.getElementById(id);if(!el||el.hidden)continue;const st=getComputedStyle(el);if(st.display==="none"||st.visibility==="hidden"||Number(st.opacity)<0.1||(id==="dock"&&el.classList.contains("collapsed")))continue;
  if(id==="sheet"&&st.display==="contents")continue;const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;out.push([r.left-cr.left-12,r.top-cr.top-12,r.right-cr.left+12,r.bottom-cr.top+12])}return {w:cr.width,h:cr.height,rects:out}}
/* Centre the projection on a free screen rectangle (beside or above the seat card, left of the dock, below the
   top bar) and solve the distance that fits the aircraft inside it. The larger result wins. */
function setOffsetXY(c,w,h,dx,dy){if(Math.abs(dx)<0.5&&Math.abs(dy)<0.5){if(c.view&&c.view.enabled)c.clearViewOffset();return}
  c.setViewOffset(w+2*Math.abs(dx),h+2*Math.abs(dy),dx>0?0:-2*dx,dy>0?0:-2*dy,w,h)}
let airLay={key:"",dx:0,dy:0,d:40};
function airLayout(w,h){const ob=fitObstacles();const key=[w,h,camera.fov,air.az.toFixed(2),air.pol.toFixed(2),ob.rects.map(r=>r.map(Math.round).join(",")).join(";")].join("|");if(key===airLay.key)return airLay;
  let right=w,bottom=h,cardTop=h,cardRight=0;const top=96;
  for(const r of ob.rects){if(r[0]>w*0.45&&r[3]-r[1]>h*0.45)right=Math.min(right,r[0]);else if(r[2]-r[0]>w*0.8&&r[1]>h*0.3)bottom=Math.min(bottom,r[1]);else if(r[0]<w*0.35&&r[1]>h*0.25){cardTop=Math.min(cardTop,r[1]);cardRight=Math.max(cardRight,r[2])}}
  const cands=[[0,top,right,Math.min(cardTop,bottom)],[cardRight,top,right,bottom]].filter(r=>r[2]-r[0]>160&&r[3]-r[1]>160);
  if(!cands.length)cands.push([0,top,w,h]);
  const c=new THREE.Vector3(0,0.4,ZC+0.8),dir=new THREE.Vector3(Math.sin(air.pol)*Math.sin(air.az),Math.cos(air.pol),Math.sin(air.pol)*Math.cos(air.az));let best=null;
  for(const R of cands){const dx=(R[0]+R[2])/2-w/2,dy=(R[1]+R[3])/2-h/2;fitCam.copy(camera);fitCam.aspect=w/h;setOffsetXY(fitCam,w,h,dx,dy);fitCam.updateProjectionMatrix();
    const fits=d=>{fitCam.position.copy(c).addScaledVector(dir,d);fitCam.lookAt(c);fitCam.updateMatrixWorld();for(const p of FIT_PTS){const q=p.clone().project(fitCam);if(q.z>1)return false;const px=(q.x+1)/2*w,py=(1-q.y)/2*h;if(px<R[0]+14||px>R[2]-14||py<R[1]+8||py>R[3]-14)return false}return true};
    let lo=6,hi=300;if(!fits(hi))continue;for(let i=0;i<22;i++){const m=(lo+hi)/2;if(fits(m))hi=m;else lo=m}if(!best||hi<best.d)best={dx,dy,d:hi}}
  airLay=Object.assign({key},best||{dx:0,dy:0,d:90});return airLay}
function fitDist(){return airLay.d}
const VIEWS={F:{y:0,p:-0.1},W:{y:1.62,p:-0.3},A:{y:-1.25,p:-0.12},L:{y:0,p:-0.86}};
const outSide=id=>SEATS[id].letter<="C"?-1:1;
function viewAngles(id,m){const v=VIEWS[m],o=outSide(id);return {y:(m==="W"||m==="A")?v.y*o:v.y,p:v.p}}
function eyeFor(id){const s=SEATS[id];return new THREE.Vector3(seatX(s.letter),EYE_Y,backZ[s.row]-0.01)}
/* in the window view a window-seat passenger leans toward the glass; others stay upright */
let lean=0,leanGoal=0;function leanFor(id,m){return m==="W"&&SEATS[id].position==="window"?1:0}
function leanVec(id){const s=SEATS[id];return new THREE.Vector3((s.letter<="C"?-1:1)*0.17*lean,-0.03*lean,0.06*lean)}
const _m=new THREE.Matrix4(),_up=new THREE.Vector3(0,1,0);
function quatLook(pos,tgt){_m.lookAt(pos,tgt,_up);return new THREE.Quaternion().setFromRotationMatrix(_m)}
function dirFrom(y,p){return new THREE.Vector3(Math.sin(y)*Math.cos(p),Math.sin(p),-Math.cos(y)*Math.cos(p))}
function airPose(){const a=air,d=fitDist()*a.zoom,pos=new THREE.Vector3(a.target.x+d*Math.sin(a.pol)*Math.sin(a.az),a.target.y+d*Math.cos(a.pol),a.target.z+d*Math.sin(a.pol)*Math.cos(a.az));return {pos,quat:quatLook(pos,a.target)}}
function seatPose(id,y,p){const pos=eyeFor(id);return {pos,quat:quatLook(pos,pos.clone().add(dirFrom(y,p)))}}
const ease=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2, sstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};

/* planned path: aircraft → above the row (open roof) → just above the seat → eye. Bins/ceiling are hidden
   while the camera is above 1.6 m and fade in only after it has dropped below them; it never crosses a solid. */
function seatPath(id){const e=eyeFor(id),x=e.x;
  const k1=new THREE.Vector3(x*0.5,5.4,e.z+3.6),k2=new THREE.Vector3(x,e.y+0.38,e.z-0.02);
  const q1=quatLook(k1,new THREE.Vector3(x,0.7,e.z-0.9)),q2=quatLook(k2,k2.clone().add(new THREE.Vector3(0,-0.32,-1))),q3=seatPose(id,VIEWS.F.y,VIEWS.F.p).quat;
  return {pts:[k1,k2,e],quats:[q1,q2,q3]}}
function makeTransition(from,path,dir,done){let pts=[from.pos,...path.pts],quats=[from.quat,...path.quats];
  if(dir<0){pts.reverse();quats.reverse()}
  // drop coincident points (an interrupted transition can start where it ends); a curve needs distinct points
  const keep=pts.map((p,i)=>i===0||p.distanceTo(pts[i-1])>1e-3);pts=pts.filter((_,i)=>keep[i]);quats=quats.filter((_,i)=>keep[i]);
  if(pts.length<2){pts=[pts[0],pts[0].clone().add(new THREE.Vector3(0,1e-3,0))];quats=[quats[0],quats[quats.length-1]]}
  const curve=new THREE.CatmullRomCurve3(pts,false,"centripetal");const n=pts.length-1;const dur=reduce?0:2900;const t0=performance.now();
  return {dur,step(t){const k=dur?Math.max(0,Math.min(1,(t-t0)/dur)):1,u=ease(k);camera.position.copy(curve.getPoint(u));
      const s=Math.min(n-1e-6,u*n),i=Math.floor(s),f=sstep(0,1,s-i);camera.quaternion.copy(quats[i]).slerp(quats[i+1],f);
      const w=dir>0?u:1-u; // 0 = aircraft, 1 = seated
      transW=w;
      applyFades({ext:1-sstep(0.05,0.4,w),studio:1-sstep(0.5,0.86,w),upper:sstep(0.88,1,w)});selGlow=1-sstep(0.55,0.85,w);
      if(k>=1){done();return false}return true},finish(){this.step(t0+dur+1)}}}
function cutTo(fn){if(reduce){fn();dirty=true;return}fadeEl.classList.add("on");setTimeout(()=>{fn();dirty=true;requestAnimationFrame(()=>requestAnimationFrame(()=>fadeEl.classList.remove("on")))},220)}
function setSeatState(id,m){selected=id;seatView=m;const a=viewAngles(id,m);eye.copy(eyeFor(id));yaw=a.y;pitch=a.p;openShadesNear(eye.z);placeSun(eye);applyFades({ext:0,studio:0,upper:1});selGlow=0;window.onSeatEnter&&onSeatEnter(id)}
const leaveSeat=()=>{window.onSeatLeave&&onSeatLeave()};
function enterSeat(id,m="F"){if(trans)trans.finish();if(SEATS[id].taken)return;
  if(view==="AIR"){selected=id;view="T";const from={pos:camera.position.clone(),quat:camera.quaternion.clone()};airGoal.stash={az:air.az,pol:air.pol,zoom:air.zoom,target:air.target.clone()};
    openShadesNear(eyeFor(id).z);placeSun(eyeFor(id));
    trans=makeTransition(from,seatPath(id),1,()=>{trans=null;view=m;if(!isMobile()){$("dock").classList.add("collapsed");$("dockOpen").classList.add("on")}setSeatState(id,"F");if(m!=="F")rotateTo(m);ui.sync();applyHighlights()});ui.sync();applyHighlights();if(reduce)trans.finish();return}
  if(view==="CMP"){cutTo(()=>{view=m;setSeatState(id,m);ui.sync();applyHighlights()});return}
  if(id!==selected){leaveSeat();cutTo(()=>{view=m;setSeatState(id,m);ui.sync()});return}
  rotateTo(m)}
function rotateTo(m){seatView=m;view=m;const a=viewAngles(selected,m);if(reduce){yaw=a.y;pitch=a.p;dirty=true;ui.sync();return}
  const y0=yaw,p0=pitch,t0=performance.now();anim=t=>{const k=Math.min(1,(t-t0)/650),e=ease(k);yaw=y0+(a.y-y0)*e;pitch=p0+(a.p-p0)*e;if(k>=1)anim=null};ui.sync()}
function backToAircraft(){if(trans)trans.finish();if(view==="AIR")return;leaveSeat();if(view==="R"||view==="X"){view="F";camera.position.copy(eye);camera.lookAt(eye.clone().add(dirFrom(yaw,pitch)))}
  const st=airGoal.stash;const s=SEATS[selected];air.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);air.zoom=st?Math.min(st.zoom,0.62):0.62;air.az=st?st.az:-0.95;air.pol=st?st.pol:0.92;airGoal.target.copy(air.target);airGoal.zoom=air.zoom;
  if(view==="CMP"){cutTo(()=>{view="AIR";applyFades({ext:1,studio:1,upper:0});placeSun(new THREE.Vector3(0,1,ZC));aimSelLight(selected);selGlow=1;ui.sync();applyHighlights()});return}
  const sp=seatPose(selected,yaw,pitch),from={pos:sp.pos.add(leanVec(selected)),quat:sp.quat},ap=airPose();
  const p=seatPath(selected);p.pts[p.pts.length-1]=from.pos;p.quats[p.quats.length-1]=from.quat; // start from wherever the seated view is looking
  view="T";aimSelLight(selected);
  trans=makeTransition(ap,p,-1,()=>{trans=null;view="AIR";$("dock").classList.remove("collapsed");$("dockOpen").classList.remove("on");placeSun(new THREE.Vector3(0,1,ZC));ui.sync();applyHighlights()});ui.sync();applyHighlights();if(reduce)trans.finish()}
function skipTransition(){if(trans)trans.finish()}

/* ---------- comparison: same view angle from two seats, split screen ---------- */
const camB=new THREE.PerspectiveCamera(52,1,0.03,400);
function enterCompare(a,b,m){leaveSeat();cmp.a=a;cmp.b=b;if(m)seatView=m;if(seatView==="O"||!VIEWS[seatView])seatView="F";if(trans)trans.finish();
  cutTo(()=>{view="CMP";selected=a;applyFades({ext:0,studio:0,upper:1});selGlow=0;openShadesNear([eyeFor(a).z,eyeFor(b).z]);placeSun(eyeFor(a).clone().lerp(eyeFor(b),0.5));const an=viewAngles(a,seatView);yaw=an.y;pitch=an.p;ui.sync();applyHighlights()})}
function cmpSetView(m){seatView=m;const an=viewAngles(cmp.a,m);if(reduce){yaw=an.y;pitch=an.p;dirty=true;ui.sync();return}const y0=yaw,p0=pitch,t0=performance.now();anim=t=>{const k=Math.min(1,(t-t0)/650),e=ease(k);yaw=y0+(an.y-y0)*e;pitch=p0+(an.p-p0)*e;if(k>=1)anim=null};ui.sync()}

/* ---------- "Show my space": pitch, knee space, estimated clearance ---------- */
const guideMat=(c,o)=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,depthTest:false,depthWrite:false,toneMapped:false});
const GM={pitch:guideMat(0xd8d2c2,.55),knee:guideMat(0xf3efe6,.95),clr:guideMat(0xf0a640,1),bad:guideMat(0xff6a52,1)};
function bar(z0,z1,y,x,mat,th=0.006){const m=new THREE.Mesh(new THREE.BoxGeometry(th,th,1),mat);m.position.set(x,y,(z0+z1)/2);m.scale.z=Math.max(0.001,Math.abs(z1-z0));m.renderOrder=30;return m}
function tick(z,y,x,mat,h=0.07){const m=new THREE.Mesh(new THREE.BoxGeometry(0.004,h,0.004),mat);m.position.set(x,y,z);m.renderOrder=30;return m}
function buildGuides(id,hcm){const g=new THREE.Group(),s=SEATS[id],x=seatX(s.letter),r=s.row,ks=kneeSpace(r),knee=ks.own-KNEE_RATIO*hcm/100,gap=knee-ks.ahead;
  const pz1=backZ[r]+PIVOT_Z,pz0=r===1?BULK:backZ[r-1]+PIVOT_Z,px=x+0.17,py=0.24;
  g.add(bar(pz0,pz1,py,px,GM.pitch,0.004),tick(pz0,py,px,GM.pitch),tick(pz1,py,px,GM.pitch));
  g.add(bar(ks.own,ks.ahead,KNEE_Y,x,GM.knee),tick(ks.own,KNEE_Y,x,GM.knee),tick(ks.ahead,KNEE_Y,x,GM.knee,0.1));
  const kz=Math.max(knee,ks.ahead),cm_=gap>=0?GM.clr:GM.bad;
  for(let z=kz;z>ks.ahead+0.004;z-=0.02){g.add(bar(z,Math.max(ks.ahead,z-0.012),KNEE_Y+0.03,x,cm_,0.008))}
  g.add(tick(knee,KNEE_Y+0.03,x,cm_,0.05));
  g.userData={labels:[
    {cls:"pitch",p:new THREE.Vector3(px,py,(pz0+pz1)/2),t:`Seat pitch ${s.pitch}″ · ${Math.round(s.pitch*2.54)} cm${r===1?" (no seat ahead)":""}`},
    {cls:"knee",p:new THREE.Vector3(x,KNEE_Y-0.035,(ks.own+ks.ahead)/2),t:`Knee space ≈ ${cm(ks.d)} cm`},
    {cls:gap>=0?"clr":"bad",p:new THREE.Vector3(x,KNEE_Y+0.07,Math.max(knee,ks.ahead)),t:`Est. clearance ${gap>=0?"+":""}${cm(gap)} cm`}]};
  return g}
let guideGroups=[];
function refreshGuides(){for(const g of guideGroups)scene.remove(g);guideGroups=[];const want=(view==="L"&&[selected])||(view==="CMP"&&seatView==="L"&&[cmp.a,cmp.b])||[];
  for(const id of want){const g=buildGuides(id,ui.height());g.userData.seat=id;scene.add(g);guideGroups.push(g)}dirty=true}

/* ---------- seat highlighting (instance colours) ---------- */
const COL={white:new THREE.Color(1,1,1),taken:new THREE.Color(.42,.45,.52),sel:new THREE.Color(3.2,1.9,.6),hover:new THREE.Color(1.5,1.4,1.2),rec:new THREE.Color(.75,1.35,1.9),dim:new THREE.Color(.7,.73,.8),excl:new THREE.Color(2.2,.5,.45),focusRec:new THREE.Color(.6,1.7,2.4)};
function applyHighlights(){const air_=view==="AIR"||view==="T";for(const im of highlightMeshes){const tags=im.userData.tags;for(let i=0;i<tags.length;i++){const id=tags[i];let c=COL.white;
  if(air_){const s=SEATS[id];const f=focus.seats.includes(id);c=id===selected?COL.sel:f&&focus.tone==="excl"?COL.excl:f?COL.focusRec:recs.some(r=>r.includes(id))?COL.rec:id===hover?COL.hover:s.taken?COL.taken:COL.dim}im.setColorAt(i,c)}im.instanceColor.needsUpdate=true}dirty=true}

/* ---------- input ---------- */
let drag=null;const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
function pickSeat(ev){const r=canvas.getBoundingClientRect();ndc.set((ev.clientX-r.left)/r.width*2-1,-(ev.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObjects(highlightMeshes,false)[0];return hit&&hit.instanceId!=null?hit.object.userData.tags[hit.instanceId]:null}
canvas.addEventListener("pointerdown",ev=>{if(view==="T"||view==="R"||view==="X")return;drag={x:ev.clientX,y:ev.clientY,az:air.az,pol:air.pol,yaw,pitch,moved:false};canvas.setPointerCapture(ev.pointerId);anim=null});
canvas.addEventListener("pointermove",ev=>{if(!drag){if(view==="AIR"&&ev.pointerType==="mouse"){const id=pickSeat(ev);if(id!==hover){hover=id;canvas.style.cursor=id&&!SEATS[id].taken?"pointer":"grab";applyHighlights()}}return}
  const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;if(!drag.moved)return;dirty=true;
  if(view==="AIR"){air.az=drag.az-dx*0.005;air.pol=Math.max(0.25,Math.min(1.42,drag.pol-dy*0.004))}
  else{yaw=Math.max(-1.8,Math.min(1.8,drag.yaw-dx*0.004));pitch=Math.max(-1.05,Math.min(0.5,drag.pitch+dy*0.0035))}});
canvas.addEventListener("pointerup",ev=>{const d=drag;drag=null;window.__dragMoved=!!(d&&d.moved);if(!d||d.moved||view!=="AIR")return;const id=pickSeat(ev);if(id&&!SEATS[id].taken)ui.select(id);else if(id)ui.toast(`${id} is taken (sample availability)`)});
canvas.addEventListener("pointercancel",()=>{drag=null});
canvas.addEventListener("dblclick",ev=>{if(view!=="AIR")return;const id=pickSeat(ev);if(id&&!SEATS[id].taken){ui.select(id);enterSeat(id)}});
canvas.addEventListener("wheel",ev=>{if(view!=="AIR")return;ev.preventDefault();airGoal.zoom=Math.max(0.3,Math.min(1.35,airGoal.zoom*Math.exp(ev.deltaY*0.001)));dirty=true},{passive:false});
window.addEventListener("resize",()=>{dirty=true});
window.addEventListener("keydown",ev=>{if(ev.target.closest("input,textarea"))return;if(ev.key==="Escape"){if(document.querySelector("dialog[open]"))return;if(trans)skipTransition();else if(view==="X"&&window.stopExitDemo)stopExitDemo();else if(view!=="AIR")backToAircraft()}});

/* ---------- labels projected from 3D ---------- */
const pool=new Map();let poolUsed=new Set();
function label(key,cls,text,v,cam,rect,onclick){let el=pool.get(key);if(!el){el=document.createElement(onclick?"button":"div");el.type="button";markersEl.append(el);pool.set(key,el)}poolUsed.add(key);
  el.className="tag "+cls;if(el.textContent!==text)el.textContent=text;el.onclick=onclick||null;
  const p=v.clone().project(cam);const vis=p.z<1&&Math.abs(p.x)<1.02&&Math.abs(p.y)<1.02;el.style.display=vis?"":"none";
  el.style.transform=`translate(${rect.x+(p.x+1)/2*rect.w}px,${rect.y+(1-p.y)/2*rect.h}px) translate(-50%,-100%)`}
function overlays(rects){poolUsed=new Set();
  if(view==="AIR"||view==="T"){const sp=id=>{const s=SEATS[id];return new THREE.Vector3(seatX(s.letter),1.25,backZ[s.row]-0.2)};
    if(view==="AIR"){recs.forEach((r,i)=>{if(!r.includes(selected))label("r"+r[0],"rec",`Option ${i+1} · ${r.join("+")}`,sp(r[0]),camera,rects[0],()=>ui.select(r[0]))});
      if(hover&&hover!==selected&&!SEATS[hover].taken){const s=SEATS[hover];label("hover","hover",`${hover} · ${s.price?"£"+s.price:"Free"}`,sp(hover),camera,rects[0])}}
    if(selGlow>0.05){const s=SEATS[selected],gi=recs.findIndex(r=>r.includes(selected));label("sel","sel",`Selected ${selected} · ${s.price?"£"+s.price:"Free"}${gi>=0?` · option ${gi+1}`:""}`,sp(selected),camera,rects[0],()=>enterSeat(selected))}}
  for(const [i,g] of guideGroups.entries()){const idx=view==="CMP"?(g.userData.seat===cmp.a?0:1):0,cam=view==="CMP"&&idx===1?camB:camera;for(const l of g.userData.labels)label(`g${i}${l.cls}`,"guide "+l.cls,l.t,l.p,cam,rects[idx])}
  for(const [k,el] of pool)if(!poolUsed.has(k)){el.remove();pool.delete(k)}}

/* ---------- render loop (on demand) ---------- */
function renderView(c){if(typeof renderSky==="function"&&fades.studio<0.999){renderSky(c);renderer.clearDepth()}renderer.render(scene,c)}
/* Frame-time measurement in the running browser (CPU time to submit a frame, plus the interval between frames
   while animating). Shown in Engineering; nothing is claimed without this measurement. */
const PERF={n:0,cpu:[],gap:[],last:0,sample(ms,t){this.n++;this.cpu.push(ms);if(this.cpu.length>240)this.cpu.shift();if(this.last&&t-this.last<500){this.gap.push(t-this.last);if(this.gap.length>240)this.gap.shift()}this.last=t},
  stats(){const q=(a,p)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return Math.round(b[Math.min(b.length-1,Math.floor(p*b.length))]*10)/10};return {frames:this.n,cpuP50:q(this.cpu,.5),cpuP95:q(this.cpu,.95),intervalP50:q(this.gap,.5),intervalP95:q(this.gap,.95),fpsWhileAnimating:this.gap.length>10?Math.round(1000/q(this.gap,.5)):null,renderer:(()=>{try{const g=renderer.getContext(),e=g.getExtension("WEBGL_debug_renderer_info");return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):"unknown"}catch(e){return "unknown"}})(),pixelRatio:renderer.getPixelRatio(),quality:QUALITY.low?"low":"high"}}};
function seatOffset(){const o=ui.offset();return {dx:-o.x/2,dy:-o.y/2}}
function applyOffset(c,w,h){const o=seatOffset();setOffsetXY(c,w,h,o.dx,o.dy)}
function sizeCam(cam,w,h,seat){cam.aspect=w/h;const asp=w/h;cam.fov=seat?(asp>=1.25?52:Math.min(80,2*Math.atan(Math.tan(THREE.MathUtils.degToRad(33))/asp)*180/Math.PI)):(asp<1?44:28);cam.updateProjectionMatrix()}
let first=true,lastSize="",lastT=0;
/* compile every material up front (while "Preparing cabin" is showing) so the first trip into the cabin doesn't stall */
function precompile(){const hidden=[];scene.traverse(o=>{if(!o.visible){hidden.push(o);o.visible=true}});try{renderer.compile(scene,camera)}catch(e){console.warn(e)}hidden.forEach(o=>{o.visible=false})}
function loop(t){requestAnimationFrame(loop);if(document.hidden)return;const dt=lastT?Math.min(1000,t-lastT):16;lastT=t;const kk=1-Math.exp(-dt/120);
  const w=canvas.clientWidth,h=canvas.clientHeight,key=w+"x"+h;if(key!==lastSize){lastSize=key;renderer.setSize(w,h,false);dirty=true}
  if(anim){anim(t);dirty=true}
  leanGoal=["F","W","A","L"].includes(view)?leanFor(selected,view):0;if(Math.abs(lean-leanGoal)>0.002){lean+=(leanGoal-lean)*(reduce?1:kk*0.8);dirty=true}else lean=leanGoal;
  if(view==="AIR"){const k=kk;if(air.target.distanceTo(airGoal.target)>0.002||Math.abs(air.zoom-airGoal.zoom)>0.0005){air.target.lerp(airGoal.target,k);air.zoom+=(airGoal.zoom-air.zoom)*k;dirty=true}}
  const want=view==="AIR"?1:(view==="T"?selGlow:0);if(Math.abs(selLight.intensity-want*9)>0.02){selLight.intensity+=(want*9-selLight.intensity)*kk;dirty=true}
  if(trans){if(!trans.step(t))trans=null;dirty=true}
  for(const h of FRAME_HOOKS)if(h(t,dt))dirty=true;
  if(!dirty)return;dirty=false;if(first)precompile();const fs0=performance.now();
  const split=view==="CMP",port=w<h;let rects=[{x:0,y:0,w,h}];
  if(split){rects=port?[{x:0,y:0,w,h:h/2},{x:0,y:h/2,w,h:h/2}]:[{x:0,y:0,w:w/2,h},{x:w/2,y:0,w:w/2,h}]}
  if(view==="AIR"){sizeCam(camera,w,h,false);const L_=airLayout(w,h);setOffsetXY(camera,w,h,L_.dx,L_.dy);camera.updateProjectionMatrix();const p=airPose();camera.position.copy(p.pos);camera.quaternion.copy(p.quat)}
  else if(view==="T"){sizeCam(camera,w,h,true);const fs=camera.fov,fa=w/h<1?44:28;camera.fov=fa+(fs-fa)*sstep(0,0.75,transW);camera.updateProjectionMatrix();const so=seatOffset(),k=sstep(0,1,transW);setOffsetXY(camera,w,h,airLay.dx+(so.dx-airLay.dx)*k,airLay.dy+(so.dy-airLay.dy)*k)}
  else if(split){camera.clearViewOffset();for(const [c,id,r] of[[camera,cmp.a,rects[0]],[camB,cmp.b,rects[1]]]){sizeCam(c,r.w,r.h,true);c.position.copy(eyeFor(id));const dy=yaw-viewAngles(cmp.a,seatView).y;const a=viewAngles(id,seatView);c.lookAt(c.position.clone().add(dirFrom(a.y+dy,pitch)))}}
  else if(view==="R"||view==="X"){sizeCam(camera,w,h,true);applyOffset(camera,w,h);camera.position.copy(FREECAM.pos);camera.quaternion.copy(FREECAM.quat)}
  else{sizeCam(camera,w,h,true);applyOffset(camera,w,h);camera.position.copy(eye).add(leanVec(selected));camera.lookAt(camera.position.clone().add(dirFrom(yaw,pitch)))}
  camera.updateMatrixWorld();
  if(split){renderer.setScissorTest(true);const H=h;for(const [c,r] of[[camera,rects[0]],[camB,rects[1]]]){renderer.setViewport(r.x,H-r.y-r.h,r.w,r.h);renderer.setScissor(r.x,H-r.y-r.h,r.w,r.h);renderer.clear();renderView(c);renderer.shadowMap.needsUpdate=false}renderer.setScissorTest(false);renderer.setViewport(0,0,w,h)}
  else{renderer.clear();renderView(camera)}
  PERF.sample(performance.now()-fs0,t);
  overlays(rects);ui.frame(rects);
  if(first){first=false;document.getElementById("loading").classList.add("done")}}
