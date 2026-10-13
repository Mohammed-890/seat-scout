/* Interface: seat card, dock, mobile sheet, concierge, engineering view. Uses globals from cabin3d.js and SeatAPI. */

/* =====================================================================
   INTERFACE: floating seat card, collapsible dock, mobile bottom sheet
   ===================================================================== */
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cap=s=>s[0].toUpperCase()+s.slice(1);
const money=p=>p?`£${p}`:"Free";
let mine=null,mineGroup=null,spaceOn=false,armed=null,cardMore=false;const isMobile=()=>innerWidth<=760;
const ui={
  height(){const v=Number($("height").value);return v>=140&&v<=210?v:178},
  toast(t){const el=$("toast");el.textContent=t;el.classList.add("on");clearTimeout(ui._t);ui._t=setTimeout(()=>el.classList.remove("on"),2400)},
  select(id){if(SEATS[id].taken){ui.toast(`${id} is taken (sample availability)`);return}
    if(armed){setPair(armed,id);return}
    if(view==="AIR"){selected=id;const s=SEATS[id];airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.dist=Math.min(airGoal.dist,26);aimSelLight(id);applyHighlights();ui.sync()}
    else if(view==="CMP"){setPair("a",id)}
    else enterSeat(id,view==="T"?"F":view)},
  sync(){renderCard();renderPlan();renderViews();app.classList.toggle("cmp-on",view==="CMP");$("skip").classList.toggle("on",view==="T");refreshGuides();if(view==="CMP")renderCmpBar();dirty=true},
  frame(rects){if(view==="CMP"){const [a,b]=rects;const A=$("halfA"),B=$("halfB"),dv=$("divider");
      A.style.left=(a.x+12)+"px";A.style.top=(a.y+(isMobile()?a.h-52:96))+"px";B.style.left=(b.x+12)+"px";B.style.top=(b.y+(isMobile()?b.h-52:96))+"px";
      if(b.x>0)Object.assign(dv.style,{left:(b.x-1)+"px",top:"0",width:"2px",height:"100%"});else Object.assign(dv.style,{left:"0",top:(b.y-1)+"px",width:"100%",height:"2px"})}},
  offset(){if(view==="CMP")return {x:0,y:0};if(isMobile())return {x:0,y:Math.round(sheetH()*0.85)};const d=$("dock");return {x:d.classList.contains("collapsed")?0:d.offsetWidth+20,y:0}}
};
function sheetH(){return isMobile()?$("sheet").getBoundingClientRect().height:0}

/* ---------- seat card ---------- */
function stat(v,l,k){return `<div class="stat"><b class="${k?"k-"+k:""}">${esc(v)}</b><span>${esc(l)}</span></div>`}
function renderCard(){const s=SEATS[selected],h=ui.height();$("cId").textContent=s.id;$("cPrice").textContent=money(s.price);
  $("cPos").textContent=`${cap(s.position)} · row ${s.row}${s.exitRow?" · exit row":""}${mineGroup&&mineGroup.includes(s.id)?" · selected (demo)":""}`;
  const g=clearanceCm(s,h);
  $("cStats").innerHTML=stat(`${s.pitch}″ · ${s.kneeCm} cm`,"Pitch · knee space")+(s.position==="window"?stat(s.align.t,s.view==="clear"?"Window, clear view":`Window, ${s.view}`,s.align.k):stat("No window",cap(s.position)+" seat"))+stat(s.access.t,"To the aisle",s.access.k);
  $("cNote").textContent=s.notes[0]||(s.recline==="full"?"Full recline, bag fits under the seat in front.":"");
  const go=$("cGo");go.textContent=view==="AIR"||view==="T"?"View from seat →":"← Back to aircraft";go.disabled=view==="T";
  $("cMine").textContent=mineGroup&&mineGroup.includes(s.id)?"Selected ✓":"Select (demo)";$("cSpace").setAttribute("aria-pressed",String(view==="L"));
  const seatV=["F","W","A","L"].includes(view);$("card").classList.toggle("compact",seatV&&!cardMore&&!isMobile());$("cMore").hidden=!seatV||isMobile();$("cMore").textContent=cardMore?"Less":"Details";$("cMore").setAttribute("aria-expanded",String(cardMore));
  $("spaceSum").textContent=`${g>=0?"+":""}${g} cm clearance`;$("card").classList.toggle("space-on",view==="L"||(view==="CMP"&&seatView==="L"))}
$("cMore").onclick=()=>{cardMore=!cardMore;renderCard()};
$("cGo").onclick=()=>{if(view==="AIR")enterSeat(selected,"F");else backToAircraft()};
$("cSpace").onclick=()=>{spaceOn=true;if(view==="AIR")enterSeat(selected,"L");else if(view==="CMP")cmpSetView("L");else rotateTo("L")};
$("cMine").onclick=()=>{const g=recs.find(r=>r.includes(selected))||[selected];selectDemo(g)};
$("cUp").onclick=()=>{const p=upgradeFor(selected);if(!p){ui.toast("No comparable seat is free right now");return}setPairDirect(p[0],p[1]);openTab("x");enterCompare(cmp.a,cmp.b,view==="AIR"||view==="T"?"F":seatView)};
$("height").addEventListener("input",()=>{renderCard();refreshGuides();if(view==="CMP")renderCmpBar();renderCompareTab()});

/* ---------- view switcher ---------- */
function renderViews(){document.querySelectorAll(".views button").forEach(b=>{const v=b.dataset.v;const on=v==="AIR"?view==="AIR":(view==="CMP"?seatView===v:view===v);b.setAttribute("aria-pressed",String(on));b.disabled=view==="T"})}
document.querySelectorAll(".views button").forEach(b=>b.onclick=()=>{const v=b.dataset.v;
  if(v==="AIR"){if(view!=="AIR")backToAircraft();return}
  if(v==="L")spaceOn=true;
  if(view==="CMP"){cmpSetView(v);ui.sync();return}
  if(view==="AIR")enterSeat(selected,v);else rotateTo(v)});
$("skip").onclick=skipTransition;

/* ---------- dock ---------- */
function openTab(t){document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.t===t)));for(const [k,id] of[["c","pC"],["m","pM"],["x","pX"],["e","pE"]])$(id).classList.toggle("on",k===t);
  $("dock").classList.remove("collapsed");$("dockOpen").classList.remove("on");if(isMobile()&&sheetState==="compact")setSheet("expanded");if(t==="x")renderCompareTab();dirty=true}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>openTab(b.dataset.t));
$("dockClose").onclick=()=>{$("dock").classList.add("collapsed");$("dockOpen").classList.add("on");dirty=true};
$("dockOpen").onclick=()=>{$("dock").classList.remove("collapsed");$("dockOpen").classList.remove("on");dirty=true};

/* ---------- seat map (same dataset) ---------- */
function renderPlan(){const el=$("plan");let h=`<div></div>${["A","B","C"].map(l=>`<div class="h">${l}</div>`).join("")}<div></div>${["D","E","F"].map(l=>`<div class="h">${l}</div>`).join("")}`;
  for(let r=1;r<=30;r++){h+=`<div class="rn${EXIT_ROWS.includes(r)?" ex":""}">${r}</div>`;LETTERS.forEach((L,i)=>{if(i===3)h+="<div></div>";const s=SEATS[r+L];
    const c="seat"+(s.taken?" taken":"")+(s.exitRow&&!s.taken?" exit":"")+(s.pitch>29&&!s.exitRow&&!s.taken?" xl":"")+(recs.some(x=>x.includes(s.id))?" rec":"")+(view==="CMP"||armed?(s.id===cmp.b?" cmpB":""):"")+(s.id===selected?" sel":"")+(mineGroup&&mineGroup.includes(s.id)?" mine":"");
    h+=`<button class="${c}" data-id="${s.id}" ${s.taken?"disabled":""} aria-label="${s.id}, ${s.taken?"taken":`${s.position}, ${s.pitch} inch pitch, ${money(s.price)}`}" title="${s.id} · ${s.taken?"taken":money(s.price)}">${s.taken?"":(s.price?s.price:"0")}</button>`})}
  el.innerHTML=h}
$("plan").addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(b)ui.select(b.dataset.id)});

/* ---------- "Is the upgrade worth it?" ---------- */
function upgradeFor(id){const a=SEATS[id];const free=Object.values(SEATS).filter(s=>!s.taken&&s.id!==id);
  const same=free.filter(s=>s.position===a.position);
  const up=same.filter(s=>s.kneeCm>a.kneeCm&&!s.exitRow).sort((x,y)=>(x.price-y.price)||Math.abs(x.row-a.row)-Math.abs(y.row-a.row))[0]||same.filter(s=>s.kneeCm>a.kneeCm).sort((x,y)=>x.price-y.price)[0];
  if(up)return [id,up.id];
  const base=same.filter(s=>s.price<a.price).sort((x,y)=>(y.kneeCm-x.kneeCm)||x.price-y.price)[0];return base?[base.id,id]:null}
function setPairDirect(a,b){cmp.a=a;cmp.b=b;renderCompareTab()}
function setPair(which,id){cmp[which]=id;armed=null;document.querySelectorAll(".pick").forEach(p=>p.classList.remove("arm"));renderCompareTab();renderPlan();
  if(view==="CMP"&&cmp.a&&cmp.b)enterCompare(cmp.a,cmp.b);ui.toast(`Seat ${which.toUpperCase()}: ${id}`)}
$("pickA").onclick=()=>{armed=armed==="a"?null:"a";$("pickA").classList.toggle("arm",armed==="a");$("pickB").classList.remove("arm");renderPlan()};
$("pickB").onclick=()=>{armed=armed==="b"?null:"b";$("pickB").classList.toggle("arm",armed==="b");$("pickA").classList.remove("arm");renderPlan()};
$("xSplit").onclick=()=>{if(!cmp.a||!cmp.b){const p=upgradeFor(selected);if(p)setPairDirect(...p)}if(cmp.a&&cmp.b)enterCompare(cmp.a,cmp.b,view==="AIR"||view==="T"?"F":seatView)};
$("cmpExit").onclick=()=>enterSeat(cmp.a,seatView);
function dfmt(n,u,inv){if(!n)return {t:`same ${u}`,c:""};const good=inv?n<0:n>0;return {t:`${n>0?"+":""}${n}${u}`,c:good?"up":"down"}}
function renderCompareTab(){$("xA").textContent=cmp.a||"–";$("xB").textContent=cmp.b||"–";if(!cmp.a||!cmp.b){$("xBody").innerHTML="";return}
  const c=localCompare(cmp.a,cmp.b),A=SEATS[cmp.a],B=SEATS[cmp.b],h=ui.height();
  const rows=[["Sample price",money(A.price),money(B.price),dfmt(B.price-A.price,"","inv")],["Seat pitch",`${A.pitch}″`,`${B.pitch}″`,dfmt(B.pitch-A.pitch,"″")],["Knee space",`${A.kneeCm} cm`,`${B.kneeCm} cm`,dfmt(B.kneeCm-A.kneeCm," cm")],
    [`Clearance @${h}`,`${clearanceCm(A,h)} cm`,`${clearanceCm(B,h)} cm`,null],["Window",A.align?A.align.t:"None",B.align?B.align.t:"None",null],["To the aisle",A.access.t,B.access.t,null],["Recline",cap(A.recline),cap(B.recline),null],["Bag under seat",A.underSeatStorage?"Yes":"No",B.underSeatStorage?"Yes":"No",null]];
  $("xBody").innerHTML=`<table class="ctab"><thead><tr><th></th><th>${A.id}</th><th>${B.id}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td class="${r[3]&&r[3].c?"delta-"+r[3].c:""}">${esc(r[2])}</td></tr>`).join("")}</tbody></table>
  <div class="gl" style="margin-top:10px"><b>${B.id} gains</b><span>${esc(c.gains.join(", ")||"Nothing measurable")}</span><b style="margin-top:4px">${B.id} gives up</b><span>${esc(c.gives_up.join(", ")||"Nothing measurable")}</span></div>`}
function renderCmpBar(){const A=SEATS[cmp.a],B=SEATS[cmp.b];if(!A||!B)return;const d={pitch_in:B.pitch-A.pitch,knee_space_cm:B.kneeCm-A.kneeCm};
  const chips=[dfmt(B.price-A.price,"","inv"),dfmt(d.pitch_in,"″ pitch"),dfmt(d.knee_space_cm," cm knee space")];chips[0].t=B.price===A.price?"same price":`${B.price>A.price?"+":"−"}£${Math.abs(B.price-A.price)}`;
  const wA=A.align?A.align.t:"no window",wB=B.align?B.align.t:"no window";const acc=A.access.pass===B.access.pass?{t:`aisle: ${B.access.t.toLowerCase()}`,c:""}:{t:`aisle: ${A.access.t.toLowerCase()} → ${B.access.t.toLowerCase()}`,c:B.access.pass<A.access.pass?"up":"down"};
  const win=wA===wB?{t:`window: ${wB.toLowerCase()}`,c:""}:{t:`window: ${wA.toLowerCase()} → ${wB.toLowerCase()}`,c:(B.align?B.align.rank+1:0)>(A.align?A.align.rank+1:0)?"up":"down"};
  $("dchips").innerHTML=[...chips,win,acc].map(x=>`<span class="dchip ${x.c}">${esc(x.t)}</span>`).join("");
  $("halfA").innerHTML=`<b>${A.id}</b><span>A · ${money(A.price)}</span>`;$("halfB").innerHTML=`<b>${B.id}</b><span>B · ${money(B.price)}</span>`}

/* ---------- mobile bottom sheet: compact ⇄ expanded, draggable ---------- */
let sheetState="compact";
function compactH(){return Math.min(innerHeight*0.45,$("card").scrollHeight+28)}
function setSheet(st){sheetState=st;$("sheet").classList.toggle("compact",st==="compact");const h=st==="expanded"?Math.round(innerHeight*0.86):compactH();$("sheet").style.setProperty("--sheet-h",h+"px");document.documentElement.style.setProperty("--sheet-h",h+"px");setTimeout(()=>{dirty=true},420);dirty=true}
{const hd=$("handle");let d=null;
 hd.addEventListener("pointerdown",e=>{$("sheet").classList.remove("compact");d={y:e.clientY,h:$("sheet").getBoundingClientRect().height,moved:false};hd.setPointerCapture(e.pointerId);$("sheet").classList.add("dragging")});
 hd.addEventListener("pointermove",e=>{if(!d)return;const dy=d.y-e.clientY;if(Math.abs(dy)>4)d.moved=true;const h=Math.max(120,Math.min(innerHeight*0.92,d.h+dy));$("sheet").style.setProperty("--sheet-h",h+"px");dirty=true});
 hd.addEventListener("pointerup",e=>{if(!d)return;$("sheet").classList.remove("dragging");const h=$("sheet").getBoundingClientRect().height;
   setSheet(!d.moved?(sheetState==="compact"?"expanded":"compact"):(h>innerHeight*0.45?"expanded":"compact"));d=null});
 hd.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSheet(sheetState==="compact"?"expanded":"compact")}})}
addEventListener("resize",()=>{if(isMobile())setSheet(sheetState)});

/* ---------- local comparison for the Compare tab (same dataset; the agent uses compareSeatOptions) ---------- */
function localCompare(a,b){const A=SEATS[a],B=SEATS[b],gains=[],loss=[];const dk=B.kneeCm-A.kneeCm,dp=B.pitch-A.pitch,pr=B.price-A.price;
  if(dk>0)gains.push(`${dk} cm more knee space (estimated; pitch ${dp>=0?"+":""}${dp}″)`);if(dk<0)loss.push(`${-dk} cm less knee space (estimated)`);
  if(B.access.pass<A.access.pass)gains.push("easier aisle access");if(B.access.pass>A.access.pass)loss.push("harder aisle access");
  const ar=s=>s.align?s.align.rank+1:0;if(ar(B)>ar(A))gains.push(B.align?`window ${B.align.t.toLowerCase()}`:"");if(ar(B)<ar(A))loss.push(A.align?"window position":"");
  if(A.recline!==B.recline)(B.recline==="full"?gains:loss).push("full recline");if(A.underSeatStorage!==B.underSeatStorage)(B.underSeatStorage?gains:loss).push("bag under the seat in front");
  if(pr>0)loss.push(`£${pr} more (sample price)`);if(pr<0)gains.push(`£${-pr} saving (sample price)`);return {gains:gains.filter(Boolean),gives_up:loss.filter(Boolean)}}

/* =====================================================================
   CONCIERGE + ENGINEERING VIEW — talks to SeatAPI (server or in-browser preview)
   ===================================================================== */
const logEl=$("log"),qEl=$("q"),sendBtn=$("send"),chipsEl=$("chips"),traceEl=$("trace");
const STARTERS=["We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.","1 adult, aisle near the front, total £25","نحن شخصين بالغين، ميزانية ٢٠ جنيه، شباك"];
const FOLLOWUPS=["Actually, £25 maximum.","Keep the window preference.","Why not row 6?","Compare that with the cheapest valid option.","One person is no longer travelling."];
function renderChips(list){chipsEl.innerHTML="";list.forEach(t=>{const b=document.createElement("button");b.textContent=t.length>60?t.slice(0,58)+"…":t;b.title=t;b.onclick=()=>{qEl.value=t;send()};chipsEl.append(b)})}
renderChips(STARTERS);
let busy=false,turnNo=0,lastResult=null;
function addMsg(cls,text){const d=document.createElement("div");d.className="msg "+cls;if(text)d.textContent=text;logEl.append(d);logEl.scrollTop=logEl.scrollHeight;return d}
const KIND={fact:"Fact",calculated:"Calculated",judgement:"Preference",estimate:"Estimate"};
function groupCard(g,i){const c=document.createElement("div");c.className="rec";const s0=SEATS[g.seats[0]];
  c.innerHTML=`<div class="rh"><b>${g.seats.join(" + ")}</b><span>£${g.totalGBP} <small>${g.seats.length>1?"total, ":""}sample prices</small></span></div>
   ${g.strengths.length?`<p>${esc(cap(g.strengths.join(", ")))}.</p>`:""}${g.compromises.length?`<p class="trade">Compromise: ${esc(g.compromises.join(", "))}.</p>`:""}
   <details><summary>Why: ${g.statements.length} evidence statements</summary><div class="kinds">${g.statements.map(st=>`<div class="kind ${st.kind}"><b>${KIND[st.kind]}</b><span>${esc(st.text)}</span></div>`).join("")}</div>
   <div class="metrics" style="margin-top:6px">${Object.entries(g.components).map(([k,v])=>`<span>${esc(k)} ${v>0?"+":""}${v}</span>`).join("")}<span>score ${g.score}</span></div></details>
   <div class="row"><button class="btn" data-a="v">View seat</button><button class="btn" data-a="c">${i===0?"Upgrade check":"Compare"}</button><button class="btn primary" data-a="s">Select (demo)</button></div>`;
  c.querySelector('[data-a="v"]').onclick=()=>{selected=g.seats[0];enterSeat(g.seats[0],view==="AIR"||view==="T"||view==="CMP"?"F":view);ui.sync()};
  c.querySelector('[data-a="c"]').onclick=()=>{let pair=i===0?upgradeFor(g.seats[0]):[recs[0][0],g.seats[0]];if(!pair){ui.toast("Nothing comparable is free");return}
    const [a,b]=SEATS[pair[0]].price<=SEATS[pair[1]].price?pair:[pair[1],pair[0]];setPairDirect(a,b);openTab("x");enterCompare(a,b,"F")};
  c.querySelector('[data-a="s"]').onclick=()=>selectDemo(g.seats);
  return c}
function applyAvailability(r){if(!r||!r.trace)return;for(const e of r.trace)if(e.kind==="snapshot"&&e.seats)for(const id of e.seats){if(SEATS[id]){SEATS[id].taken=true}}}
function showResult(bubble,r){lastResult=r;applyAvailability(r);bubble.textContent=r.message;
  if(r.groups.length){r.groups.forEach((g,i)=>bubble.append(groupCard(g,i)));recs=r.groups.map(g=>g.seats);const s=SEATS[recs[0][0]];selected=s.id;
    if(view==="AIR"){airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.dist=Math.max(26,airGoal.dist);aimSelLight(s.id)}else if(view!=="T"&&view!=="CMP")enterSeat(s.id,view);
    renderChips(FOLLOWUPS)}
  else if(r.outcome==="no_feasible"||r.outcome==="clarify")recs=[];
  const m=document.createElement("span");m.className="meta";m.textContent=`${r.mode} · ${r.outcome} · ${r.metrics.latencyMs} ms · snapshot v${r.snapshotVersion} · ${r.dataNotice}`;bubble.append(m);
  focus={seats:[],tone:null};renderTrace(r);ui.sync();applyHighlights();logEl.scrollTop=logEl.scrollHeight}
const KLABEL={request:"Request",parsed:"Parsed",state:"Constraints",model_call:"Model",tool_call:"Tool call",tool_result:"Tool result",tool_error:"Tool error",candidates:"Candidates",exclusions:"Exclusions",scores:"Scores",validation:"Validation",snapshot:"Snapshot",fallback:"Fallback",final:"Final",note:"Note"};
function renderTrace(r){turnNo++;if(turnNo===1)traceEl.innerHTML="";const wrap=document.createElement("div");
  const mm=r.metrics;const parts=[`${mm.latencyMs} ms`,`${mm.toolCalls} tool calls`];if(mm.model)parts.push(mm.model);if(mm.modelCalls)parts.push(`${mm.modelCalls} model call${mm.modelCalls>1?"s":""}`);
  if(mm.inputTokens)parts.push(`${mm.inputTokens} in / ${mm.outputTokens} out tokens`);parts.push(mm.costUSD!=null?`$${mm.costUSD.toFixed(4)}`:"cost n/a");
  wrap.innerHTML=`<div class="turnhead">Turn ${turnNo} · ${esc(r.mode)}<span>${esc(r.outcome)}</span></div><div class="metrics">${parts.map(p=>`<span>${esc(p)}</span>`).join("")}</div>`;
  for(const e of r.trace){const d=document.createElement("details");d.className="ev "+(e.status||"");
    const tone=e.kind==="exclusions"?"excl":"rec";
    d.innerHTML=`<summary><span class="k">${KLABEL[e.kind]||e.kind}</span><span>${esc(e.title)}</span><span class="t">+${e.t}ms</span></summary>${e.data!==undefined?`<pre>${esc(JSON.stringify(e.data,null,1))}</pre>`:""}`;
    if(e.seats&&e.seats.length){const b=document.createElement("button");b.className="seatlink";b.textContent=`Show ${new Set(e.seats).size} seat${e.seats.length>1?"s":""} in the aircraft`;
      b.onclick=()=>{focus={seats:[...new Set(e.seats)],tone};if(view!=="AIR")backToAircraft();applyHighlights();ui.toast(tone==="excl"?"Red: excluded seats for this step":"Blue: seats from this step")};d.append(b)}
    wrap.append(d)}
  traceEl.prepend(wrap)}
async function call(fn,label){if(busy)return;busy=true;sendBtn.disabled=true;if(label)addMsg("user",label);if(isMobile()&&sheetState==="compact")setSheet("expanded");const bubble=addMsg("bot","Working…");
  try{const r=await fn();showResult(bubble,r)}catch(e){bubble.textContent=e.status===429?"Too many requests: wait a moment and retry.":`Something failed: ${e.message}. Your trip details are kept; you can retry.`;
    const b=document.createElement("button");b.className="btn";b.style.marginTop="8px";b.textContent="Retry";b.onclick=()=>{bubble.remove();busy=false;call(fn,null)};bubble.append(b)}
  finally{busy=false;sendBtn.disabled=false}}
function send(){const q=qEl.value.trim();if(!q)return;qEl.value="";call(()=>API.chat(q),q)}
async function selectDemo(seats){await call(()=>API.select(seats),`Select ${seats.join(" + ")}`);if(lastResult&&lastResult.outcome==="selected"){mineGroup=seats;$("mine").classList.add("on");$("mineId").textContent=seats.join("+");ui.sync()}}
sendBtn.onclick=send;qEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
$("dTaken").onclick=()=>call(()=>API.seatTaken(),"Demo: a recommended seat is taken by someone else");
$("dImpossible").onclick=()=>call(()=>API.impossible(),"Demo: Make the total budget £1.");
$("dTimeout").onclick=()=>call(()=>API.toolTimeout(),"Demo: next seat search times out");

/* ---------- Explore the engineering ---------- */
const XP={};
function xpTab(k){document.querySelectorAll(".xp nav button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.x===k)));$("xpBody").innerHTML=XP[k]?XP[k]():""}
document.querySelectorAll(".xp nav button").forEach(b=>b.onclick=()=>{xpTab(b.dataset.x);if(b.dataset.x==="eval")loadEval()});
$("exploreBtn").onclick=()=>{$("explore").showModal();xpTab("arch")};$("xpClose").onclick=()=>$("explore").close();
XP.arch=()=>`<svg class="diagram" viewBox="0 0 900 360" role="img" aria-label="Architecture: browser, server agent, deterministic core, data">
<style>.b{fill:#111b33;stroke:#3a4a6e}.t{fill:#f3efe6;font:600 14px Figtree,sans-serif}.s{fill:#a9b0c0;font:12px Figtree,sans-serif}.l{stroke:#a6d4ff;stroke-width:1.6;fill:none;marker-end:url(#ar)}.tb{stroke:#f0a640;stroke-dasharray:6 5;fill:none}</style>
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#a6d4ff"/></marker></defs>
<rect class="b" x="20" y="40" width="220" height="280" rx="14"/><text class="t" x="36" y="68">Browser</text><text class="s" x="36" y="92">3D cabin + seat map</text><text class="s" x="36" y="112">Concierge chat</text><text class="s" x="36" y="132">Engineering view (trace)</text><text class="s" x="36" y="152">No keys, no model calls*</text>
<rect class="tb" x="270" y="20" width="610" height="320" rx="16"/><text class="s" x="284" y="40" fill="#f0a640">Trust boundary: server (API key, sessions, validation)</text>
<rect class="b" x="290" y="60" width="250" height="120" rx="14"/><text class="t" x="306" y="88">Agent loop (bounded)</text><text class="s" x="306" y="110">≤8 steps · model 30 s · tools 3 s</text><text class="s" x="306" y="130">Claude: interpret, choose tools,</text><text class="s" x="306" y="148">explain. Fallback: rule parser</text>
<rect class="b" x="290" y="200" width="250" height="120" rx="14"/><text class="t" x="306" y="228">Tools (zod-validated)</text><text class="s" x="306" y="250">updateTripPreferences · findAdjacent…</text><text class="s" x="306" y="268">getSeatEvidence · compareSeatOptions</text><text class="s" x="306" y="286">validateRecommendation · submit</text>
<rect class="b" x="590" y="60" width="270" height="120" rx="14"/><text class="t" x="606" y="88">Deterministic core</text><text class="s" x="606" y="110">constraints · adjacency · policy</text><text class="s" x="606" y="130">arithmetic · scoring components</text><text class="s" x="606" y="148">independent validation</text>
<rect class="b" x="590" y="200" width="270" height="120" rx="14"/><text class="t" x="606" y="228">Canonical data (synthetic)</text><text class="s" x="606" y="250">cabin config + provenance</text><text class="s" x="606" y="268">demo policy · snapshots v1, v2…</text><text class="s" x="606" y="286">per-session trip state</text>
<path class="l" d="M240,150 C265,150 265,120 290,120"/><path class="l" d="M415,180 L415,200"/><path class="l" d="M540,260 C565,260 565,120 590,120"/><path class="l" d="M725,180 L725,200"/><path class="l" d="M290,270 C260,270 262,220 240,220"/></svg>
<p>The model never computes prices, eligibility or adjacency. It interprets the request into a structured state patch, calls tools, and writes the explanation. Every proposed group is re-validated by code against the latest availability snapshot; cards are built from the dataset, not from model text.</p>
<p class="fine">* In the claude.ai preview the same core runs in the page and Claude is reached through the viewer's own account (artifact capability), still with no key in the page. In the repository, the model runs server-side.</p>
<h3>Trust boundaries</h3><ul><li>API key only in the server environment; never sent to the client or written to traces (trace redaction).</li><li>Sessions: random HttpOnly cookie, per-session state and availability, per-session rate limit, body size limits, zod-validated inputs.</li><li>Untrusted text: passenger tips are returned as <code>untrusted</code> data; user messages cannot change the demo policy or validation.</li></ul>`;
XP.trace=()=>{const t=(lastResult&&lastResult.trace)||SAMPLE_TRACE;return `<p>${lastResult?"Your most recent turn":"A recorded deterministic run of the core demo request"} (application events, not model reasoning).</p>`+(t||[]).map(e=>`<details class="ev ${e.status||""}"><summary><span class="k">${KLABEL[e.kind]||e.kind}</span><span>${esc(e.title)}</span><span class="t">+${e.t}ms</span></summary>${e.data!==undefined?`<pre>${esc(JSON.stringify(e.data,null,1))}</pre>`:""}</details>`).join("")};
let EVAL=null;async function loadEval(){if(!EVAL){try{EVAL=await API.evalLatest()}catch(e){EVAL={error:String(e)}}}xpTab("eval")}
XP.eval=()=>{if(!EVAL)return "<p>Loading…</p>";if(EVAL.error)return `<p>${esc(EVAL.error)}</p>`;
  const m=s=>s.metrics;const row=s=>`<tr><td>${esc(s.system)}</td><td>${s.passed}/${s.cases}</td><td>${m(s).hardConstraintSatisfactionPct}%</td><td>${m(s).adjacencyAndPriceCorrectPct}%</td><td>${m(s).impossibleHandledPct}%</td><td>${m(s).multiTurnStatePct}%</td><td>${m(s).unsupportedNumericClaims}</td></tr>`;
  return `<p><b>${esc(EVAL.mode)}</b> run · ${esc(EVAL.startedAt)} · ${EVAL.cases} cases · data <code>${esc(EVAL.dataConfig)}</code> · policy <code>${esc(EVAL.policy)}</code></p><p>${esc(EVAL.description||"")}</p>
  <table><thead><tr><th>System</th><th>Cases</th><th>Hard constraints</th><th>Adjacency & price</th><th>Impossible handled</th><th>Multi-turn state</th><th>Unsupported claims</th></tr></thead><tbody>${EVAL.systems.map(row).join("")}</tbody></table>
  <h3>Failures (reported, not hidden)</h3><ul>${EVAL.systems[0].failures.map(f=>`<li><code>${esc(f.id)}</code>: ${esc(f.problems.join("; "))}</li>`).join("")||"<li>none</li>"}</ul>
  <p class="fine">Live-model evaluation: not run (no API key was available). The runner (<code>npm run eval:live</code>) compares the tool-grounded agent with a no-tools baseline using the same model and settings.</p>`};
XP.limits=()=>`<ul><li>All data is synthetic: an illustrative A320neo-style layout, sample prices and generated availability. No airline, inventory or booking is connected.</li><li>Knee space and window alignment are measured in a procedural 3D model; noise is a coarse zone label. Height-based clearance uses a population average; height alone doesn't predict comfort.</li><li>The demo eligibility policy is explicit and invented for this prototype; real rules differ by airline and route.</li><li>The rule-based fallback parser handles common English and Arabic phrasings only; the deterministic eval measures it, not a model.</li><li>No live-model evaluation numbers yet (no key available during development).</li><li>Groups larger than 3 or split seating are not supported.</li><li>All 3D assets are procedural; no licensed cabin or human models.</li></ul>`;
XP.tradeoffs=()=>`<ul><li><b>Model interprets, code decides.</b> Costs some flexibility (the model can't "bend" a rule), buys verifiable correctness for budget, adjacency and eligibility.</li><li><b>One agent, not many.</b> Fewer moving parts; the bounded loop plus validation gives predictable latency and failure modes.</li><li><b>Structured state separate from chat.</b> Follow-ups patch only named fields, so "make it £25" can't silently drop the window preference.</li><li><b>Re-validate at the end.</b> Even accepted tool results are re-checked against the latest snapshot before display or selection, which handles races like a seat being taken mid-conversation.</li><li><b>Deterministic fallback.</b> Answers stay available when the model fails, clearly labelled, at the cost of narrower language understanding.</li><li><b>Procedural 3D.</b> Lightweight and license-free, but not photoreal.</li></ul>`;

/* ================= start ================= */
function setModePill(){const m=window.MODEINFO||{};$("modeText").textContent=m.modeLabel||"";$("modePill").classList.toggle("live",m.mode==="live");const b=$("badge");b.textContent=m.modeLabel||"";b.classList.toggle("live",m.mode==="live")}
window.setModePill=setModePill;setModePill();
selected="14A";aimSelLight(selected);applyFades({ext:1,studio:1,upper:0});placeSun(new THREE.Vector3(0,1,ZC));selGlow=1;
airGoal.target.set(seatX("A")*0.3,0.4,backZ[14]);air.target.copy(airGoal.target);air.dist=airGoal.dist=38;
addMsg("bot","Hi! Tell me who's travelling, your total budget and what matters most. I'll search the cabin with tools, light up the options in the aircraft and show you exactly why. Prices and availability are demo data.");
if(isMobile())setSheet("compact");ui.sync();applyHighlights();requestAnimationFrame(loop);
