/* Interface: one 3D viewer, one panel (seat details + assistant + seat map), and an "About this project" dialog.
   Flow: choose a seat → see its view and key details → ask the assistant for help. Uses globals from cabin3d.js. */

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const money=p=>p?`£${p}`:"Free";
const isMobile=()=>innerWidth<=700;
let mineGroup=null,cmpArm=false,cmpPair=null;

const ui={
  height(){const v=Number($("height").value);return v>=140&&v<=210?v:178},
  toast(t){const el=$("toast");el.textContent=t;el.classList.add("on");clearTimeout(ui._t);ui._t=setTimeout(()=>el.classList.remove("on"),2600)},
  select(id){if(SEATS[id].taken){ui.toast(`${id} is taken in this demo`);return}
    if(cmpArm){cmpArm=false;if(id!==selected){cmpPair=[selected,id];renderCompare()}else renderCard();return}
    if(view==="AIR"){selected=id;const s=SEATS[id];airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.zoom=Math.min(airGoal.zoom,0.62);aimSelLight(id);applyHighlights();ui.sync()}
    else enterSeat(id,view==="T"?"F":view)},
  sync(){renderCard();renderPlan();renderViews();refreshGuides();dirty=true},
  offset(){return isMobile()?{x:0,y:Math.round($("panel").getBoundingClientRect().height*0.85)}:{x:0,y:0}}
};

/* ---------- seat details ---------- */
const inch=p=>`${p} in / ${Math.round(p*2.54)} cm`;
const NUM=["no","one","two","three"];
function aisleText(s){return s.access.pass?`You would pass ${NUM[s.access.pass]} seat${s.access.pass>1?"s":""} to reach the aisle.`:"Direct: this is an aisle seat."}
function windowText(s){if(s.position!=="window")return "No window";const v=s.view==="clear"?"clear view":s.view==="wing"?"looks onto the wing":"partly over the wing";return `${s.align.t} · ${v}`}
function groupOf(id){const i=recs.findIndex(r=>r.includes(id));return i<0?null:recs[i]}
function renderCard(){const s=SEATS[selected];$("cId").textContent=s.id;$("cPrice").textContent=money(s.price);
  $("cPos").textContent=`${cap(s.position)} seat · row ${s.row}${s.exitRow?" · exit row":""}`;
  const mine=$("cMine"),g=groupOf(s.id);
  if(mineGroup&&mineGroup.includes(s.id)){mine.hidden=false;mine.textContent=`Selected for this demo: ${mineGroup.join(" + ")}`}
  else if(g&&g.length>1){mine.hidden=false;mine.textContent=`Recommended group: ${g.join(" + ")} · ${money(g.reduce((a,id)=>a+SEATS[id].price,0))} total`}
  else mine.hidden=true;
  const row=(t,v,f)=>`<div><dt>${esc(t)}</dt><dd>${esc(v)}${f?`<span class="fine">${esc(f)}</span>`:""}</dd></div>`;
  $("cFacts").innerHTML=row("Seat pitch",inch(s.pitch))+row("Space at knee height",`${s.kneeCm} cm`,"modelled in the 3D cabin")+row("Window",windowText(s))+row("Aisle access",aisleText(s));
  $("cNote").textContent=s.notes.filter(n=>!/looks onto the wing/.test(n))[0]||"";
  const go=$("cGo");go.textContent=view==="AIR"||view==="T"?"View from this seat":"Back to aircraft";go.disabled=view==="T";
  $("cSelect").textContent=mineGroup&&mineGroup.includes(s.id)?"Selected ✓":"Select seat (demo)";
  $("space").hidden=view!=="L";
  if(view==="L"){const h=ui.height(),c=clearanceCm(s,h);$("spaceSum").textContent=`Estimated body clearance at ${h} cm: ${c>=0?"+":""}${c} cm (estimate)`}
  $("cCompare").textContent=cmpArm?"Choose a seat to compare… (cancel)":"Compare with another seat";
  if(isMobile())setSheet(sheetState,true)}
$("cGo").onclick=()=>{if(view==="AIR")enterSeat(selected,"F");else backToAircraft()};
$("cSelect").onclick=()=>selectDemo(groupOf(selected)||[selected]);
$("cCompare").onclick=()=>{cmpArm=!cmpArm;if(cmpArm){ui.toast(`Choose another seat to compare with ${selected}`);if(isMobile())setSheet("compact")}renderCard()};
$("height").addEventListener("input",()=>{renderCard();refreshGuides()});

/* ---------- comparison: one small table, nothing else ---------- */
function renderCompare(){const el=$("cmp");if(!cmpPair){el.hidden=true;renderCard();return}const [A,B]=cmpPair.map(id=>SEATS[id]);el.hidden=false;
  const rows=[["Price per seat",money(A.price),money(B.price)],["Seat pitch",`${A.pitch} in`,`${B.pitch} in`],["Space at knee height",`${A.kneeCm} cm`,`${B.kneeCm} cm`],["Window",A.position==="window"?A.align.t:"None",B.position==="window"?B.align.t:"None"],["Seats to pass to the aisle",String(A.access.pass),String(B.access.pass)],["Recline",cap(A.recline),cap(B.recline)]];
  el.innerHTML=`<div class="cmp-h"><b>Compare</b><button class="link" id="cmpClose">Close</button></div><table><thead><tr><th></th><th>${A.id}</th><th>${B.id}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("")}</tbody></table><p class="mode">Sample prices; space is modelled, not measured on a real aircraft.</p>`;
  $("cmpClose").onclick=()=>{cmpPair=null;renderCompare()};renderCard();if(isMobile())setSheet("expanded")}

/* ---------- views ---------- */
function renderViews(){document.querySelectorAll(".views button").forEach(b=>{b.setAttribute("aria-pressed",String(b.dataset.v===view));b.disabled=view==="T"});$("skip").hidden=view!=="T"}
document.querySelectorAll(".views button").forEach(b=>b.onclick=()=>{const v=b.dataset.v;if(v==="AIR"){if(view!=="AIR")backToAircraft();return}if(view==="AIR")enterSeat(selected,v);else rotateTo(v)});
$("skip").onclick=skipTransition;

/* ---------- tabs ---------- */
function openTab(t){document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.t===t)));$("pC").classList.toggle("on",t==="c");$("pM").classList.toggle("on",t==="m");if(isMobile()&&sheetState==="compact")setSheet("expanded");dirty=true}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>openTab(b.dataset.t));

/* ---------- seat map (same dataset) ---------- */
function renderPlan(){const el=$("plan");let h=`<div></div>${["A","B","C"].map(l=>`<div class="h">${l}</div>`).join("")}<div></div>${["D","E","F"].map(l=>`<div class="h">${l}</div>`).join("")}`;
  for(let r=1;r<=30;r++){h+=`<div class="rn">${r}</div>`;LETTERS.forEach((L,i)=>{if(i===3)h+="<div></div>";const s=SEATS[r+L],rec=recs.some(x=>x.includes(s.id)),sel=s.id===selected;
    const c="s"+(s.taken?" taken":"")+(rec?" rec":"")+(sel?" sel":"");
    const state=[s.taken?"taken":"available",sel?"selected":"",rec?"recommended":""].filter(Boolean).join(", ");
    h+=`<button class="${c}" data-id="${s.id}" ${s.taken?"disabled":""} aria-label="${s.id}, ${state}${s.taken?"":`, ${s.position}, ${money(s.price)}`}">${s.taken?"×":(s.price||"0")}</button>`})}
  el.innerHTML=h}
$("plan").addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(b)ui.select(b.dataset.id)});

/* ---------- mobile bottom sheet: compact until needed ---------- */
let sheetState="compact";
function setSheet(st,quiet){const p=$("panel");if(!isMobile()){p.classList.remove("compact");p.style.removeProperty("--sheet-h");return}sheetState=st;p.classList.toggle("compact",st==="compact");
  const h=st==="expanded"?Math.round(innerHeight*0.84):Math.min(Math.round(innerHeight*0.42),$("card").scrollHeight+66);
  p.style.setProperty("--sheet-h",h+"px");document.documentElement.style.setProperty("--sheet-h",h+"px");$("handle").setAttribute("aria-expanded",String(st==="expanded"));if(!quiet)setTimeout(()=>{dirty=true},380);dirty=true}
$("handle").onclick=()=>setSheet(sheetState==="compact"?"expanded":"compact");
addEventListener("resize",()=>setSheet(sheetState,true));

/* =====================================================================
   ASSISTANT — talks to SeatAPI (server or in-browser preview)
   ===================================================================== */
const logEl=$("log"),qEl=$("q"),sendBtn=$("send"),chipsEl=$("chips");
const STARTERS=["Two adults and a 5-year-old, £45 total, sitting together, window if possible","Just me, aisle seat, under £10","نحن شخصين بالغين، ميزانية ٢٠ جنيه، شباك"];
const FOLLOWUPS=["Actually, £25 maximum.","I care more about getting out easily.","Why not row 6?"];
function renderChips(list){chipsEl.innerHTML="";list.forEach(t=>{const b=document.createElement("button");b.textContent=t.length>48?t.slice(0,46)+"…":t;b.title=t;b.onclick=()=>{if(busy)return;qEl.value=t;send()};chipsEl.append(b)})}
renderChips(STARTERS);
let busy=false,lastResult=null;
function addMsg(cls,text){const d=document.createElement("div");d.className="msg "+cls;if(text)d.textContent=text;logEl.append(d);logEl.scrollTop=logEl.scrollHeight;return d}
const KIND={fact:"Fact",calculated:"Calculated",judgement:"Preference",estimate:"Estimate"};
function viewSeats(seats){const id=seats.find(x=>SEATS[x].position==="window")||seats[0];if(view==="AIR"){ui.select(id);enterSeat(id,"F")}else enterSeat(id,view==="T"?"F":view);if(isMobile())setSheet("compact")}
/* the requirement summary is the first clause of the engine's message ("Best fit for …:") */
function reqLine(msg){const s=msg||"";const m=/^Best fit for (.*?): (?:row|seats?) /.exec(s)||/^Updated your requirements \((.*?)\)\.\s/.exec(s);return m?m[1]:null}
function notesOf(msg){return [...(msg||"").matchAll(/\(([^()]{20,})\)\s*$/g)].map(m=>m[1])}
/* Older recommendations are marked outdated once the requirements or the availability snapshot change. */
function markOutdated(r){for(const c of logEl.querySelectorAll(".best:not(.outdated)")){if(Number(c.dataset.rev)!==r.state.revision||Number(c.dataset.snap)!==r.snapshotVersion){c.classList.add("outdated");
  const f=document.createElement("div");f.className="flag";f.textContent="Outdated: your requirements or availability changed";c.prepend(f);c.querySelectorAll("[data-a=s]").forEach(b=>{b.disabled=true})}}}
function bestCard(r){const g=r.groups[0],c=document.createElement("div");c.className="best";c.dataset.rev=r.state.revision;c.dataset.snap=r.snapshotVersion;const n=g.seats.length;
  const why=cap(g.strengths.join(", "))||"Meets your requirements";const trade=g.compromises.length?`Trade-off: ${g.compromises.join(", ")}.`:"";
  const req=reqLine(r.message),notes=notesOf(r.message),alts=r.groups.slice(1);
  /* when the message isn't the standard summary (availability changed, or a live-AI answer), show its opening */
  const lead=req?"":(r.message||"").split(/\s(?=Updated best option)/)[0].slice(0,280);
  c.innerHTML=`${req?`<p class="reqs">For ${esc(req)}</p>`:lead?`<p class="lead">${esc(lead)}</p>`:""}
   <div class="best-h"><b>${g.seats.join(" + ")}</b><span>£${g.totalGBP} <small>${n>1?"total":"per seat"}</small></span></div>
   ${n>1?`<p class="mode">${g.seats.map(id=>`${id} ${money(SEATS[id].price)}`).join(" · ")}</p>`:""}
   <p>${esc(why)}.</p>${trade?`<p class="trade">${esc(trade)}</p>`:""}${notes.map(t=>`<p class="mode">${esc(t)}</p>`).join("")}
   <div class="btns"><button class="btn small primary" data-a="v">View seat</button><button class="btn small" data-a="s">Select (demo)</button></div>
   ${alts.length?`<details><summary>${alts.length} other option${alts.length>1?"s":""}</summary>${alts.map((a,i)=>`<div class="alt"><span>${a.seats.join(" + ")} · £${a.totalGBP}${a.compromises.length?` · ${esc(a.compromises[0])}`:""}</span><button class="btn small" data-alt="${i+1}">View</button></div>`).join("")}</details>`:""}
   <details><summary>Why this recommendation</summary>${g.statements.map(st=>`<div class="kind"><b>${KIND[st.kind]}</b><span>${esc(st.text)}</span></div>`).join("")}<p class="mode">The ranking score orders valid options by your preferences; it is not a comfort rating.</p></details>`;
  c.querySelector('[data-a="v"]').onclick=()=>viewSeats(g.seats);
  c.querySelector('[data-a="s"]').onclick=()=>selectDemo(g.seats);
  c.querySelectorAll("[data-alt]").forEach(b=>b.onclick=()=>viewSeats(r.groups[Number(b.dataset.alt)].seats));
  return c}
function applyAvailability(r){if(!r||!r.trace)return;for(const e of r.trace)if(e.kind==="snapshot"&&e.seats)for(const id of e.seats){if(SEATS[id])SEATS[id].taken=true}}
function showResult(bubble,r){lastResult=r;applyAvailability(r);markOutdated(r);bubble.classList.remove("failed");bubble.textContent="";
  if(r.outcome==="recommend"&&r.groups.length){bubble.append(bestCard(r));recs=r.groups.map(g=>g.seats);const s=SEATS[recs[0][0]];selected=s.id;
    if(view==="AIR"){airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.zoom=Math.min(airGoal.zoom,0.78);aimSelLight(s.id)}
    renderChips(FOLLOWUPS)}
  else{bubble.textContent=r.message;if(r.groups.length&&r.outcome!=="selected"){const d=document.createElement("div");d.className="best";d.dataset.rev=r.state.revision;d.dataset.snap=r.snapshotVersion;
      d.innerHTML=r.groups.map((g,i)=>`<div class="alt"><span>${g.seats.join(" + ")} · £${g.totalGBP}</span><button class="btn small" data-i="${i}">View</button></div>`).join("");
      d.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>viewSeats(r.groups[Number(b.dataset.i)].seats));bubble.append(d)}
    if(r.outcome==="no_feasible"||r.outcome==="clarify")recs=[]}
  focus={seats:[],tone:null};ui.sync();applyHighlights();logEl.scrollTop=logEl.scrollHeight}
const newId=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
/* One request at a time; a failed message keeps a Retry that reuses its request id (the server then returns the
   stored answer instead of applying the turn twice). Progress lines are real execution events. */
async function call(fn,label,id=newId(),retryOf=null){if(busy){ui.toast("Still working on your last request");return}busy=true;sendBtn.disabled=true;
  if(label)addMsg("user",label);const bubble=retryOf||addMsg("bot","");bubble.classList.remove("failed");bubble.textContent="Working…";
  const prog=document.createElement("span");prog.className="progress";bubble.append(prog);
  const onEvent=e=>{prog.textContent=e.title;logEl.scrollTop=logEl.scrollHeight};
  try{const r=await fn({onEvent,clientId:id});showResult(bubble,r)}
  catch(e){bubble.classList.add("failed");bubble.textContent=e.status===429?"Too many requests. Wait a moment, then retry.":e.status===409?"Your previous request is still running. Retry in a moment.":`Something went wrong (${e.message}). Your trip details are kept.`;
    const b=document.createElement("button");b.className="btn small";b.style.marginTop="8px";b.style.display="block";b.textContent="Retry";b.onclick=()=>{b.remove();call(fn,null,id,bubble)};bubble.append(b)}
  finally{busy=false;sendBtn.disabled=false}}
function send(){const q=qEl.value.trim();if(!q||busy)return;qEl.value="";if(isMobile())setSheet("expanded");call(o=>API.chat(q,o),q)}
async function selectDemo(seats){await call(()=>API.select(seats),`Select ${seats.join(" + ")}`);if(lastResult&&lastResult.outcome==="selected"){mineGroup=seats;ui.sync()}}
sendBtn.onclick=send;qEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});

/* ---------- mobile: keep the composer above the on-screen keyboard ---------- */
if(window.visualViewport){const vv=window.visualViewport;const onVV=()=>{const kb=innerHeight-vv.height>120&&document.activeElement===qEl;document.body.classList.toggle("kb",kb&&isMobile());document.documentElement.style.setProperty("--vvh",vv.height+"px");if(kb&&isMobile())qEl.scrollIntoView({block:"nearest"})};
  vv.addEventListener("resize",onVV);qEl.addEventListener("focus",()=>{if(isMobile()){setSheet("expanded");setTimeout(onVV,300)}});qEl.addEventListener("blur",()=>setTimeout(onVV,100))}

/* ---------- a transition that somehow stalls is finished, so controls never stay disabled ---------- */
let tStart=0;setInterval(()=>{if(view==="T"){if(!tStart)tStart=performance.now();else if(performance.now()-tStart>8000&&trans){trans.finish();tStart=0}}else tStart=0},1000);

/* =====================================================================
   ABOUT THIS PROJECT (secondary): purpose, architecture, traces, evaluation, recovery demos, limitations
   ===================================================================== */
const AB={};
function abTab(k){document.querySelectorAll(".ab nav button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.x===k)));$("abBody").innerHTML=AB[k]?AB[k]():"";if(k==="recovery")wireRecovery()}
document.querySelectorAll(".ab nav button").forEach(b=>b.onclick=()=>{abTab(b.dataset.x);if(b.dataset.x==="eval")loadEval()});
$("aboutBtn").onclick=()=>{$("about").showModal();abTab("overview")};$("abClose").onclick=()=>$("about").close();
function modeLabel(){const m=window.MODEINFO||{};return m.mode==="live"?(API.kind==="preview"?"Live AI: Claude, through the viewer's own claude.ai account; tools run in this page":`Live AI: ${m.model||"Claude"}, called from the server`):"Deterministic fallback: rule-based parser, no AI model connected"}
AB.overview=()=>`<p><b>Seat Scout is an independent concept demo exploring how airlines could improve customer service with AI-assisted seat selection and interactive cabin previews.</b> It helps passengers understand seat options and trade-offs before choosing.</p>
 <ul><li>A personal portfolio prototype by Mohammed Banabilh, built with AI assistance. Not a real airline service and not affiliated with any airline.</li><li>The cabin layout, prices and availability are illustrative demo data. Nothing is booked and no airline system is connected.</li><li>The assistant is currently running as: <b>${esc(modeLabel())}</b>.</li></ul>
 <p>In either mode, budgets, availability, sitting together and the demo eligibility rules are checked by ordinary code, and every recommendation is re-validated before it is shown or selected.</p>`;
const BACKEND_SVG=()=>`<svg class="diagram" viewBox="0 0 900 360" role="img" aria-label="Architecture: browser, server agent, deterministic core, data">
<style>.b{fill:#111b33;stroke:#3a4a6e}.t{fill:#f3efe6;font:600 14px Inter,sans-serif}.s{fill:#a9b0c0;font:12px Inter,sans-serif}.l{stroke:#a6d4ff;stroke-width:1.6;fill:none;marker-end:url(#ar)}.tb{stroke:#f0a640;stroke-dasharray:6 5;fill:none}</style>
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#a6d4ff"/></marker></defs>
<rect class="b" x="20" y="40" width="220" height="280" rx="14"/><text class="t" x="36" y="68">Browser</text><text class="s" x="36" y="92">3D cabin + seat map</text><text class="s" x="36" y="112">Assistant chat</text><text class="s" x="36" y="132">About: trace + evaluation</text><text class="s" x="36" y="152">No keys, no model calls*</text>
<rect class="tb" x="270" y="20" width="610" height="320" rx="16"/><text class="s" x="284" y="40" fill="#f0a640">Trust boundary: server (API key, sessions, validation)</text>
<rect class="b" x="290" y="60" width="250" height="120" rx="14"/><text class="t" x="306" y="88">Agent loop (bounded)</text><text class="s" x="306" y="110">≤8 steps · model 30 s · tools 3 s</text><text class="s" x="306" y="130">Claude: interpret, choose tools,</text><text class="s" x="306" y="148">explain. Fallback: rule parser</text>
<rect class="b" x="290" y="200" width="250" height="120" rx="14"/><text class="t" x="306" y="228">Tools (zod-validated)</text><text class="s" x="306" y="250">updateTripPreferences · findAdjacent…</text><text class="s" x="306" y="268">getSeatEvidence · compareSeatOptions</text><text class="s" x="306" y="286">validateRecommendation · submit</text>
<rect class="b" x="590" y="60" width="270" height="120" rx="14"/><text class="t" x="606" y="88">Deterministic core</text><text class="s" x="606" y="110">constraints · adjacency · policy</text><text class="s" x="606" y="130">arithmetic · scoring components</text><text class="s" x="606" y="148">independent validation</text>
<rect class="b" x="590" y="200" width="270" height="120" rx="14"/><text class="t" x="606" y="228">Canonical data (synthetic)</text><text class="s" x="606" y="250">cabin config + provenance</text><text class="s" x="606" y="268">demo policy · snapshots v1, v2…</text><text class="s" x="606" y="286">per-session trip state</text>
<path class="l" d="M240,150 C265,150 265,120 290,120"/><path class="l" d="M415,180 L415,200"/><path class="l" d="M540,260 C565,260 565,120 590,120"/><path class="l" d="M725,180 L725,200"/><path class="l" d="M290,270 C260,270 262,220 240,220"/></svg>
<p>The model never computes prices, eligibility or adjacency. It interprets the request into a structured state patch, calls tools, and writes the explanation. Every proposed group is re-validated by code against the latest availability snapshot; cards are built from the dataset, not from model text.</p>
<p class="fine">* In the claude.ai preview the same core runs in the page and Claude is reached through the viewer's own account (artifact capability), still with no key in the page. In the repository, the model runs server-side.</p>
<h3>Trust boundaries</h3><ul><li>API key only in the server environment; never sent to the client or written to traces (trace redaction).</li><li>Sessions: random HttpOnly cookie, per-session state and availability, per-session rate limit, body size limits, zod-validated inputs.</li><li>Untrusted text: passenger tips are returned as <code>untrusted</code> data; user messages cannot change the demo policy or validation.</li></ul>`;
AB.how=()=>`<p>The language model (when connected) reads the request, updates a structured trip state and calls tools. Deterministic code does the arithmetic, availability, adjacency, eligibility and final validation. Cards are built from the dataset, never from model text.</p>${BACKEND_SVG()}
 <h3>This preview vs the repository</h3><p>The claude.ai preview runs the same core in the page; Claude is reached through the viewer's own account when allowed, otherwise the rule-based mode answers. The repository version runs the core on a Node server with the API key kept server-side. Neither is deployed as a production service.</p>`;
const KL={request:"Request",parsed:"Parsed",state:"Constraints",model_call:"Model",tool_call:"Tool call",tool_result:"Tool result",tool_error:"Tool error",candidates:"Candidates",exclusions:"Exclusions",scores:"Scores",validation:"Validation",snapshot:"Snapshot",fallback:"Fallback",final:"Final",note:"Note"};
function traceHTML(ev){return (ev||[]).map(e=>`<details class="ev ${e.status||""}"><summary><span class="k">${KL[e.kind]||e.kind}</span><span>${esc(e.title)}</span><span class="t">+${e.t} ms</span></summary>${e.data!==undefined?`<pre>${esc(JSON.stringify(e.data,null,1))}</pre>`:""}</details>`).join("")}
AB.trace=()=>`<p>Application events recorded while answering (not hidden model reasoning). Exclusion counts can overlap, because one group can fail several rules.</p>
 <h3>Your most recent request</h3>${lastResult?`<p class="mode">${esc(lastResult.mode)} · ${esc(lastResult.outcome)} · ${lastResult.metrics.latencyMs} ms · ${lastResult.metrics.toolCalls} tool calls · availability v${lastResult.snapshotVersion}</p>${traceHTML(lastResult.trace)}`:"<p>Ask the assistant something first.</p>"}
 <h3>Sample run (recorded at build time)</h3>${traceHTML(window.SAMPLE_TRACE)}`;
let EVAL=null;async function loadEval(){if(!EVAL){try{EVAL=await API.evalLatest()}catch(e){EVAL={error:String(e)}}}abTab("eval")}
const evalDet=()=>{if(!EVAL)return "<p>Loading…</p>";if(EVAL.error)return `<p>${esc(EVAL.error)}</p>`;
  const F=f=>f&&f.den?`<b>${f.num}/${f.den}</b> <span class="fine">${f.pct}%</span>`:"n/a";
  const KEYS=[["casesPassed","Cases passed","cases"],["requestUnderstanding","Request understanding","stated requirements recorded in the structured state"],["parsedConstraintSatisfaction","Parsed-constraint satisfaction","shown groups meeting the parsed constraints"],["actualRequirementSatisfaction","Actual-requirement satisfaction","shown groups meeting what was asked"],["impossibleRecognised","Impossible requests recognised","impossible cases"],["adjacencyAndPrice","Adjacency & price correct","shown groups"],["multiTurnState","Multi-turn state","state fields"]];
  const sys=EVAL.systems||[];
  return `<h3>Deterministic evaluation <span class="fine">(no model involved)</span></h3>
  <p>${esc(EVAL.startedAt)} · ${EVAL.cases} cases · data <code>${esc(EVAL.dataConfig)}</code> · policy <code>${esc(EVAL.policy)}</code></p><p class="fine">${esc(EVAL.description||"")}</p>
  <table class="evt"><thead><tr><th>Metric (denominator)</th>${sys.map(s=>`<th>${esc(s.system)}</th>`).join("")}</tr></thead><tbody>${KEYS.map(([k,l,u])=>`<tr><td>${l}<br><span class="fine">${u}</span></td>${sys.map(s=>`<td>${F(s.fractions&&s.fractions[k])}</td>`).join("")}</tr>`).join("")}<tr><td>Unsupported numeric claims</td>${sys.map(s=>`<td><b>${s.metrics.unsupportedNumericClaims}</b></td>`).join("")}</tr></tbody></table>
  <details class="why"><summary>Why an earlier run showed “100% hard constraints” while two cases failed</summary>
  <p>That figure measured <i>shown seat groups</i> against the constraints the parser recorded. In <code>nofeas-05</code> (“1 adult, window, total £2”) and <code>ar-03</code> (Arabic, “alone, window seat, £3”) the parser stored “window” as a preference, so free middle seats satisfied every recorded constraint and the solver was right about the wrong question. The failure sat in request understanding, which the panel did not measure.</p>
  <p>Re-running that earlier parser against today's checks (<code>eval/results/2026-10-14-deterministic-before-parser-fix.json</code>): request understanding <b>20/27</b>, parsed-constraint satisfaction <b>101/101</b>, actual-requirement satisfaction <b>95/101</b>, impossible requests recognised <b>4/6</b>.</p>
  <p>Fix: a seat position the passenger names is a requirement unless that clause softens it (“prefer”, “ideally”, “if possible”, “نفضل”). The cases were strengthened with an explicit <code>requires</code> field, not loosened.</p></details>
  <h3>Failures (reported, not hidden)</h3><ul>${(sys[0]?.failures||[]).map(f=>`<li><code>${esc(f.id)}</code>: ${esc(f.problems.join("; "))}</li>`).join("")||"<li>none in this run</li>"}</ul>
  `};
const evalLive=()=>`<h3>Live-model evaluation</h3><p><b>Not run.</b> No Anthropic API key was available while this was built, so there are no live-model numbers, and none are shown or implied anywhere in the app or the repository.</p><p>What it would measure: <code>npm run eval:live</code> runs the same ${EVAL&&EVAL.cases?EVAL.cases:47} cases through the tool-grounded Claude agent and through a no-tools Claude baseline with the same model and settings (temperature 0, at most 8 steps), using the same independent checks, and records latency and token usage.</p>`;
AB.eval=()=>evalDet()+evalLive();
AB.recovery=()=>`<p>These run the real recovery paths against the demo data. Results appear in the assistant.</p><div class="btns"><button class="btn" id="rTaken">A recommended seat is taken</button><button class="btn" id="rImpossible">Impossible budget</button><button class="btn" id="rTimeout">A tool times out</button></div>`;
function wireRecovery(){const go=f=>()=>{$("about").close();openTab("c");f()};
  $("rTaken").onclick=go(()=>call(()=>API.seatTaken(),"Demo: a recommended seat is taken by someone else"));
  $("rImpossible").onclick=go(()=>call(o=>API.impossible(o),"Demo: Make the total budget £1."));
  $("rTimeout").onclick=go(()=>call(o=>API.toolTimeout(o),"Demo: the next seat search times out"))}
AB.limits=()=>`<ul><li>Illustrative A320neo-style layout, sample prices and generated availability. Real cabins differ by airline.</li><li>Space at knee height and window position come from a simplified 3D model; body clearance is an estimate, and height alone doesn't predict comfort.</li><li>The exit-row rules are an explicit demo policy, not any airline's.</li><li>The rule-based fallback understands common English and Arabic phrasings only. Groups larger than three, or split seating, are not supported.</li><li>No live-model evaluation has been run (no API key was available), so no live-model accuracy is claimed.</li><li>The 3D cabin and scenery are simplified procedural models, not photorealistic.</li><li>Frame rates were only observed with software rendering in a test container; no performance figure is claimed.</li></ul>`;

/* ================= start ================= */
function setModePill(){const m=window.MODEINFO||{};$("modeText").textContent=m.mode==="live"?"Assistant: Claude (live AI). Prices, availability and rules are checked by code.":"Assistant: rule-based mode, no AI model connected. Prices, availability and rules are checked by code."}
window.setModePill=setModePill;setModePill();
selected="14A";if(!window.NO3D){aimSelLight(selected);applyFades({ext:1,studio:1,upper:0});placeSun(new THREE.Vector3(0,1,ZC));selGlow=1}
addMsg("bot","Hi! Tell me who's travelling, your budget and what matters most, and I'll suggest seats that fit.");
setSheet("compact",true);ui.sync();applyHighlights();if(!window.NO3D)requestAnimationFrame(loop);
