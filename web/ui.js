/* Interface: one cabin preview, one boarding-pass panel (the seat, then the adviser), and "About this project".
   Journey: tell us what makes a good seat → see the recommended seat in the cabin → check details or compare → select (demo).
   Facts and arithmetic come from the shared dataset (SEATS) and the engine's results; nothing here invents availability. */

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const money=p=>p?`£${p}`:"£0";
const isMobile=()=>innerWidth<=700;
const list=a=>a.length<2?a.join(""):a.slice(0,-1).join(", ")+" and "+a[a.length-1];
const span=seats=>seats.length>1?`${seats[0]}–${seats[seats.length-1]}`:seats[0];
const NUM=["no","one","two","three"];
let mineGroup=null,cmpArm=false,cmpPair=null;

const ui={
  height(){const v=Number($("height").value);return v>=140&&v<=210?v:178},
  toast(t){const el=$("toast");el.textContent=t;el.classList.add("on");clearTimeout(ui._t);ui._t=setTimeout(()=>el.classList.remove("on"),2800)},
  select(id){if(SEATS[id].taken){ui.toast(`${id} is taken in this sample`);return}
    if(cmpArm){cmpArm=false;if(id!==selected){cmpPair=[selected,id];renderCompare();return}renderCard();return}
    if(view==="AIR"){selected=id;const s=SEATS[id];airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.zoom=Math.min(airGoal.zoom,0.78);aimSelLight(id);applyHighlights();ui.sync()}
    else if(view==="R")ui.toast("Finish the recline preview first");
    else enterSeat(id,view==="T"?"F":view)},
  sync(){renderCard();renderPlan();renderViews();refreshGuides();ui.syncExplore();dirty=true},
  syncExplore(){renderExplore()},
  offset(){return isMobile()?{x:0,y:Math.round($("panel").getBoundingClientRect().height*0.85)}:{x:0,y:0}}
};

/* ---------- the seat (boarding pass) ---------- */
const inch=p=>`${p}″ (${Math.round(p*2.54)} cm)`;
const prefs=()=>(lastResult&&lastResult.state&&lastResult.state.prefs)||{};
function aisleText(s){return s.access.pass?`Pass ${NUM[s.access.pass]} seat${s.access.pass>1?"s":""} to reach the aisle`:"Direct: this is an aisle seat"}
function windowText(s){if(s.position!=="window")return "No window";return `${s.align.t} (estimate); ${s.view==="clear"?"clear of the wing":s.view==="wing"?"view onto the wing":"partly over the wing"}`}
const posName=s=>`${cap(s.position)} seat, row ${s.row}${s.exitRow?", exit row":""}`;
/* two advantages and one trade-off, chosen by what the passenger has said matters, all derived from the seat data */
function seatPoints(s){const p=prefs(),pros=[],cons=[];const P=(w,t)=>pros.push([w,t]),C=(w,t)=>cons.push([w,t]);
  if(s.position==="window")P(3+(p.window||0)*3+(p.quiet?2:0),s.view==="clear"?"Window seat, clear of the wing":"Window seat to lean against");
  if(s.position==="aisle")P(3+(p.aisle||0)*3+(p.front?1:0),"Direct access to the aisle");
  if(s.pitch>29)P(4+(p.legroom||0)*4,`${s.pitch}″ seat pitch, more than the standard 29″`);
  if(s.row<=10&&!s.exitRow)P(1+(p.front||0)*4,"Near the front, quicker to leave");
  if(s.noise==="quiet")P(1+(p.quiet||0)*4,"Quieter part of the cabin (estimate)");
  if(!s.price)P(2+(p.cheap||0)*3,"No seat-selection charge in this sample");
  else if(s.price<=6)P(1+(p.cheap||0)*3,"Among the lower sample prices");
  if(s.underSeatStorage)P(0.5,"Room for a bag under the seat in front");
  if(s.access.pass)C(2+(p.aisle||0)*3+(p.front||0),`Pass ${NUM[s.access.pass]} seat${s.access.pass>1?"s":""} to reach the aisle`);
  if(s.position==="aisle")C(1+(p.window||0)*3+(p.quiet?1:0),"No window, and people pass you to their seats");
  if(s.recline==="limited")C(3+(p.quiet?2:0),"Limited recline in this row");
  if(s.nearToilets)C(3+(p.quiet||0)*2,"Next to the rear toilets and galley");
  if(s.exitRow)C(2,"Exit row: no children, and bags go overhead");
  else if(!s.underSeatStorage)C(1.5,"Bags must go in the overhead locker");
  if(s.position==="window"&&s.view!=="clear")C(1+(p.clearView||0)*4,"View partly onto the wing");
  if(s.noise!=="quiet")C(1+(p.quiet||0)*4,`Busier zone (estimate: ${s.noise})`);
  if(s.position==="window"&&s.align&&s.align.rank===0)C(1+(p.window||0),"The window falls between seats (estimate)");
  pros.sort((a,b)=>b[0]-a[0]);cons.sort((a,b)=>b[0]-a[0]);return {pros:pros.slice(0,2).map(x=>x[1]),con:cons[0]?cons[0][1]:null}}
function groupOf(id){const i=recs.findIndex(r=>r.includes(id));return i<0?null:recs[i]}
function renderCard(){const s=SEATS[selected];$("cId").textContent=s.id;$("cPrice").textContent=money(s.price);$("cPos").textContent=posName(s);
  const pt=seatPoints(s);$("cPoints").innerHTML=pt.pros.map(t=>`<li class="pro">${esc(t)}</li>`).join("")+(pt.con?`<li class="con">${esc(pt.con)}</li>`:"");
  const mine=$("cMine");
  if(mineGroup){mine.hidden=false;const tot=mineGroup.reduce((a,id)=>a+SEATS[id].price,0);mine.innerHTML=`<span>Selected for this demo: <b>${mineGroup.join(" + ")}</b> · <b>${money(tot)}</b>. Nothing has been booked.</span><button class="btn small" id="cChange">Change</button>`;
    $("cChange").onclick=()=>{mineGroup=null;ui.toast("Selection cleared. Choose another seat.");renderCard();renderPlan()}}
  else mine.hidden=true;
  const g=groupOf(s.id),sel=$("cSelect");
  sel.textContent=mineGroup&&mineGroup.includes(s.id)?"Selected":g&&g.length>1?`Select ${span(g)} (demo)`:"Select seat (demo)";sel.disabled=!!(mineGroup&&mineGroup.includes(s.id))||busy;
  const go=$("cGo");go.hidden=!(view==="AIR"||view==="T")||!!window.NO3D;go.disabled=view==="T";
  $("cCompare").textContent=cmpArm?"Cancel compare":"Compare with another seat";
  $("cFacts").innerHTML=[["Seat pitch",`<span class="num">${inch(s.pitch)}</span><span class="fine">Row spacing, not the room your knees get</span>`],
    ["Space at knee height",`<span class="num">${s.kneeCm} cm</span><span class="fine">Modelled estimate from the 3D cabin</span>`],
    ["Window",esc(windowText(s))],["Aisle access",esc(aisleText(s))],["Recline",s.recline==="limited"?"Limited in this row":"Standard for this layout"],
    ["Under-seat storage",s.underSeatStorage?"Yes":"No, bags go overhead"],["Noise",`${cap(s.noise)} <span class="fine">Zone estimate, not measured</span>`]]
    .map(([t,v])=>`<div><dt>${t}</dt><dd>${v}</dd></div>`).join("")+(s.notes.length?`<div><dt>Notes</dt><dd>${s.notes.map(esc).join(" ")}</dd></div>`:"");
  const h=ui.height(),c=clearanceCm(s,h);$("spaceSum").textContent=`At ${h} cm tall, estimated knee clearance is ${c>=0?"+":""}${c} cm (population-average proportions; an estimate only).`;
  if(isMobile())setSheet(sheetState,true)}
$("cFind").onclick=()=>{openTab("c");setSheet("expanded");setTimeout(()=>{const b=document.querySelector("#chips button:not([hidden])");($("intro").hidden?qEl:b||qEl).focus({preventScroll:false})},50)};
$("cGo").onclick=()=>{if(view==="AIR")enterSeat(selected,"F");else backToAircraft()};
$("cSelect").onclick=()=>selectDemo(groupOf(selected)||[selected]);
$("cCompare").onclick=()=>{cmpArm=!cmpArm;if(cmpArm){ui.toast(`Choose a second seat to compare with ${selected}`);openTab("m")}renderCard()};
$("height").addEventListener("input",()=>{renderCard();refreshGuides()});

/* ---------- comparison: at most two seats ---------- */
function keyDifference(A,B){const p=prefs();
  if(p.aisle||p.front)return A.access.pass===B.access.pass?`Both mean: ${aisleText(A).toLowerCase()}.`:`For getting out: ${A.id} ${A.access.pass?`means passing ${NUM[A.access.pass]} seat${A.access.pass>1?"s":""}`:"is on the aisle"}; ${B.id} ${B.access.pass?`means passing ${NUM[B.access.pass]} seat${B.access.pass>1?"s":""}`:"is on the aisle"}.`;
  if(p.legroom)return A.kneeCm===B.kneeCm?`Both have about ${A.kneeCm} cm at knee height (modelled).`:`For space: ${A.kneeCm>B.kneeCm?A.id:B.id} has ${Math.abs(A.kneeCm-B.kneeCm)} cm more at knee height (modelled estimate).`;
  if(p.window||p.quiet){const w=x=>x.position==="window";return w(A)===w(B)?(w(A)?`Both are window seats; ${A.id}: ${windowText(A).toLowerCase()}, ${B.id}: ${windowText(B).toLowerCase()}.`:"Neither is a window seat."):`Only ${w(A)?A.id:B.id} is a window seat.`}
  const d=B.price-A.price;return d?`${B.id} costs £${Math.abs(d)} ${d>0?"more":"less"} than ${A.id}.`:`Same sample price; the difference is ${A.position===B.position?"the row":`${A.position} vs ${B.position}`}.`}
function renderCompare(){const el=$("cmp");if(!cmpPair){el.hidden=true;renderCard();renderPlan();return}const [A,B]=cmpPair.map(id=>SEATS[id]);el.hidden=false;
  const d=B.price-A.price,rec=x=>x.recline==="limited"?"Limited":"Standard",key=keyDifference(A,B);
  const rows=[["Price",money(A.price),money(B.price),1],["Seat pitch",`${A.pitch}″`,`${B.pitch}″`,1],["Knee space (est.)",`${A.kneeCm} cm`,`${B.kneeCm} cm`,1],
    ["Window",A.position==="window"?A.align.t:"None",B.position==="window"?B.align.t:"None"],["To the aisle",A.access.pass?`Pass ${A.access.pass}`:"Direct",B.access.pass?`Pass ${B.access.pass}`:"Direct"],["Recline",rec(A),rec(B)]];
  el.innerHTML=`<div class="cmp-h"><span>Compare two seats</span><button class="link" id="cmpClose">Close</button></div>
   <table><thead><tr><th scope="col"><span class="sr">Attribute</span></th>${[A,B].map(x=>`<th scope="col"><button data-id="${x.id}" aria-current="${x.id===selected}" title="Show ${x.id} in the cabin">${x.id}</button></th>`).join("")}</tr></thead>
   <tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td class="${r[3]?"num":""}">${esc(r[1])}</td><td class="${r[3]?"num":""}">${esc(r[2])}</td></tr>`).join("")}</tbody></table>
   <p class="key">${esc(key)}${/costs|Same sample price/.test(key)?"":d?` ${B.id} is £${Math.abs(d)} ${d>0?"more":"less"}.`:" Same sample price."}</p>
   <p class="fine">Sample prices. Knee space is modelled, not measured on a real aircraft.</p>`;
  $("cmpClose").onclick=()=>{cmpPair=null;renderCompare()};
  el.querySelectorAll("th button").forEach(b=>b.onclick=()=>{const id=b.dataset.id;if(view==="AIR"){ui.select(id)}else enterSeat(id,view==="T"||view==="R"?"F":view);setTimeout(renderCompare,0)});
  renderCard();renderPlan();if(isMobile())setSheet("expanded")}

/* ---------- Explore this seat ---------- */
function renderExplore(){const d=$("dExplore"),body=$("exploreBody");if(window.NO3D||!window.EXPLORE){d.hidden=true;return}
  const E=EXPLORE.state();
  if(view==="R"&&E.recline){const m=E.recline.m;body.innerHTML=`<div class="recl"><b>Recline preview, ${esc(E.id)}</b>${E.recline.behind?`<span>Effect on ${esc(E.recline.behind)} behind, in this model:</span><span>Space at knee height <span class="num">${m.knee} → ${m.kneeAfter} cm</span></span><span>Their tray table moves <span class="num">${m.trayMove} cm</span> closer.</span>`:"<span>Last row: there is no seat behind.</span>"}<span class="fine">${m.limited?"Limited recline in this row.":"Standard recline for this layout."} Illustrative geometry, not a measured seat.</span><div><button class="btn small primary" id="reclDone">Done</button></div></div>`;
    $("reclDone").onclick=()=>EXPLORE.finishRecline();d.open=true;return}
  if(!E.id||view==="AIR"||view==="T"){body.innerHTML=`<p class="fine">Sit in this seat to try the window shade, tray table, reading light and a recline preview.</p><div><button class="btn small" id="exSit">Sit in ${esc(selected)}</button></div>`;$("exSit").onclick=()=>enterSeat(selected,"F");return}
  const C=[["shade","Window shade",E.st.shade==="down"?"Closed":"Open",E.st.shade==="down"],["tray","Tray table",E.st.tray?"Down":"Stowed",E.st.tray],["light","Reading light",E.st.light?"On":"Off",E.st.light],["recline","Recline preview","See the effect behind",false]];
  body.innerHTML=`<div class="ctrls">${C.map(([k,t,st,on])=>`<button class="ctrl" data-k="${k}" aria-pressed="${on}" ${E.sup[k]?"":`disabled title="${esc(E.why[k]||"")}"`}><b>${t}</b><span>${E.sup[k]?st:"Not on this seat"}</span></button>`).join("")}</div>${["shade","tray"].filter(k=>!E.sup[k]).map(k=>`<p class="fine">${esc(E.why[k])}</p>`).join("")}`;
  body.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>EXPLORE.act(b.dataset.k))}

/* ---------- camera presets ---------- */
function renderViews(){document.querySelectorAll(".views button").forEach(b=>{b.setAttribute("aria-pressed",String(b.dataset.v===view||(view==="R"&&b.dataset.v===seatView)));b.disabled=view==="T"});$("skip").hidden=view!=="T";$("resetView").disabled=view==="T"}
document.querySelectorAll(".views button").forEach(b=>b.onclick=()=>{const v=b.dataset.v;if(view==="R"){EXPLORE.finishRecline();return}if(v==="AIR"){if(view!=="AIR")backToAircraft();return}if(view==="AIR")enterSeat(selected,v);else rotateTo(v)});
$("skip").onclick=skipTransition;$("resetView").onclick=()=>resetView();

/* ---------- tabs ---------- */
function openTab(t){document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.t===t)));$("pC").classList.toggle("on",t==="c");$("pM").classList.toggle("on",t==="m");if(isMobile()&&sheetState==="compact")setSheet("expanded");dirty=true}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>openTab(b.dataset.t));

/* ---------- seat chart (same dataset) ---------- */
function renderPlan(){const el=$("plan");let h=`<div></div>${["A","B","C"].map(l=>`<div class="h">${l}</div>`).join("")}<div></div>${["D","E","F"].map(l=>`<div class="h">${l}</div>`).join("")}`;
  for(let r=1;r<=30;r++){h+=`<div class="rn">${r}</div>`;LETTERS.forEach((L,i)=>{if(i===3)h+="<div></div>";const s=SEATS[r+L],rec=recs.some(x=>x.includes(s.id)),sel=s.id===selected,cb=cmpPair&&cmpPair.includes(s.id)&&!sel;
    const c="s"+(s.taken?" taken":"")+(rec?" rec":"")+(sel?" sel":"")+(cb?" cmpb":"");
    const state=[s.taken?"taken":"available",sel?"selected":"",rec?"recommended":""].filter(Boolean).join(", ");
    h+=`<button class="${c}" data-id="${s.id}" ${s.taken?"disabled":""} aria-label="${s.id}, ${state}${s.taken?"":`, ${s.position}, ${money(s.price)}`}">${s.taken?"×":s.price}</button>`})}
  el.innerHTML=h}
$("plan").addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(b)ui.select(b.dataset.id)});

/* ---------- mobile bottom sheet: compact until needed ---------- */
let sheetState="compact";
function setSheet(st,quiet){const p=$("panel");if(!isMobile()){p.classList.remove("compact");p.style.removeProperty("--sheet-h");return}sheetState=st;p.classList.toggle("compact",st==="compact");
  const h=st==="expanded"?Math.round(innerHeight*0.82):Math.min(Math.round(innerHeight*0.4),$("card").offsetHeight+30);
  p.style.setProperty("--sheet-h",h+"px");document.documentElement.style.setProperty("--sheet-h",h+"px");$("handle").setAttribute("aria-expanded",String(st==="expanded"));if(!quiet)setTimeout(()=>{dirty=true},380);dirty=true}
$("handle").onclick=()=>setSheet(sheetState==="compact"?"expanded":"compact");
addEventListener("resize",()=>setSheet(sheetState,true));

/* =====================================================================
   ADVISER — talks to SeatAPI (server or in-browser preview)
   ===================================================================== */
const logEl=$("log"),qEl=$("q"),sendBtn=$("send");
const STARTERS=["I want to sleep.","I need more space.","I want to leave quickly."];
const FOLLOWUPS=["Make it £10 or less.","I care more about getting out easily.","Why not row 6?"];
function chipRow(el,items){el.innerHTML="";items.forEach(t=>{const b=document.createElement("button");b.textContent=t;b.onclick=()=>{if(busy)return;qEl.value=t;send()};el.append(b)})}
chipRow($("chips"),STARTERS);chipRow($("followups"),FOLLOWUPS);
let busy=false,lastResult=null;
function addMsg(cls,text){const d=document.createElement("div");d.className="msg "+cls;if(text)d.textContent=text;logEl.append(d);const fd=$("feed");if(isMobile())d.scrollIntoView({block:"nearest"});else fd.scrollTop=fd.scrollHeight;return d}
const KIND={fact:"Fact",calculated:"Calculated",judgement:"Your preference",estimate:"Estimate"};
function viewSeats(seats){const id=seats.find(x=>SEATS[x].position==="window")||seats[0];if(view==="AIR"){ui.select(id);enterSeat(id,"F")}else enterSeat(id,view==="T"||view==="R"?"F":view);if(isMobile())setSheet("compact")}
function partyLine(st){const t=st.travellers||[],n=k=>t.filter(x=>x.type===k).length,parts=[];if(n("adult"))parts.push(`${n("adult")} adult${n("adult")>1?"s":""}`);if(n("child"))parts.push(`${n("child")} child${n("child")>1?"ren":""}`);if(n("infant"))parts.push(`${n("infant")} infant${n("infant")>1?"s":""}`);return parts.join(", ")}
/* "You asked for … This seat matches both. The trade-off is …" — built from the engine's structured fit, not model prose */
function fitSentences(g){const f=g.fit,one=g.seats.length===1,who=one?"This seat":"These seats",v=(s1,pl)=>one?s1:pl;
  if(!f||!f.asked.length)return {ask:"",match:`${who} ${v("is","are")} the best overall match in the sample data.`,trade:f&&f.tradeOff?`The trade-off is ${f.tradeOff}.`:""};
  const ask=`You asked for ${list(f.asked)}.`;
  if(!f.missed.length)return {ask,match:`${who} ${v("matches","match")} ${f.asked.length===1?"it":f.asked.length===2?"both":"all of them"}.`,trade:f.tradeOff?`The trade-off is ${f.tradeOff}.`:""};
  return {ask,match:f.met.length?`${who} ${v("matches","match")} ${list(f.met)}, but not ${list(f.missed)}: no available option does both.`:`No available option gives you ${list(f.missed)}.`,trade:""}}
function diffText(a,best){const d=a.totalGBP-best.totalGBP;return d===0?"same price":d>0?`£${d} more`:`£${-d} less`}
/* Older recommendations are marked outdated once the requirements or the availability snapshot change. */
function markOutdated(r){for(const c of logEl.querySelectorAll(".best:not(.outdated)")){if(Number(c.dataset.rev)!==r.state.revision||Number(c.dataset.snap)!==r.snapshotVersion){c.classList.add("outdated");
  const f=document.createElement("p");f.className="flag";f.textContent="Outdated: your requirements or availability changed since this suggestion";c.prepend(f);c.querySelectorAll("[data-a=s]").forEach(b=>{b.disabled=true})}}}
function bestCard(r){const g=r.groups[0],c=document.createElement("div");c.className="best";c.dataset.rev=r.state.revision;c.dataset.snap=r.snapshotVersion;
  const fs=fitSentences(g),alts=r.groups.slice(1),party=partyLine(r.state);
  const lead=/was just taken/.test(r.message||"")?r.message.split(/\s(?=(?:Your requirements|Updated best option))/)[0]:"";
  const why=g.statements.filter(st=>st.kind!=="judgement").slice(2);
  c.innerHTML=`${lead?`<p class="flag">${esc(lead)}</p>`:""}${party?`<p class="party">${esc(party)}</p>`:""}
   ${fs.ask?`<p class="ask">${esc(fs.ask)}</p>`:""}
   <div class="best-h"><b>${g.seats.join(" + ")}</b><span>£${g.totalGBP} <small>${g.seats.length>1?"total":"seat price"}</small></span></div>
   ${g.seats.length>1?`<p class="per">${g.seats.map(id=>`${id} ${money(SEATS[id].price)}`).join("  ·  ")}</p>`:""}
   <p class="match">${esc(fs.match)}${fs.trade?" "+esc(fs.trade):""}</p>
   <div class="btns"><button class="btn small primary" data-a="v">View seat</button><button class="btn small" data-a="s">Select (demo)</button></div>
   <details><summary>Why this seat?</summary>${why.map(st=>`<div class="kind"><b>${KIND[st.kind]}</b><span>${esc(st.text)}</span></div>`).join("")}<p class="fine">Options are ranked by your stated preferences after every requirement is checked. The ranking is not a comfort rating.</p></details>
   ${alts.length?`<details><summary>${alts.length} other option${alts.length>1?"s":""}</summary>${alts.map((a,i)=>`<div class="alt"><span><b>${span(a.seats)}</b> · £${a.totalGBP} (${diffText(a,g)})${a.fit&&(a.fit.missed.length||a.fit.tradeOff)?`. Compromise: ${esc(a.fit.missed.length?`no ${a.fit.missed[0].replace(/^an? /,"").replace(/ if possible$/,"")}`:a.fit.tradeOff)}`:""}</span><button class="btn small" data-alt="${i+1}">View</button></div>`).join("")}</details>`:""}`;
  c.querySelector('[data-a="v"]').onclick=()=>viewSeats(g.seats);
  c.querySelector('[data-a="s"]').onclick=()=>selectDemo(g.seats);
  c.querySelectorAll("[data-alt]").forEach(b=>b.onclick=()=>viewSeats(r.groups[Number(b.dataset.alt)].seats));
  return c}
/* nothing fits: say which requirements conflict and ask before relaxing any of them */
function noFitCard(r,bubble){const m=/^Nothing in the current snapshot satisfies all of: (.*?)\.(?: Options: (.*?)\.)?( No single change makes this feasible\.)? /.exec(r.message||"");
  if(!m){bubble.textContent=r.message;return}
  const opts=[];if(m[2]){let d=0,cur="";for(const ch of m[2]){if(ch==="(")d++;if(ch===")")d--;if(ch===";"&&d===0){opts.push(cur.trim());cur="";continue}cur+=ch}if(cur.trim())opts.push(cur.trim())}
  bubble.innerHTML=`<div class="best nofit"><p><b>No seat in this sample matches all of your requirements.</b></p><p class="party">${esc(m[1])}</p>
   ${opts.length?`<p>Any one of these changes would give you options:</p><ul>${opts.map(o=>`<li>${esc(o)}</li>`).join("")}</ul>`:"<p>No single change makes this possible with the seats available.</p>"}
   <p>I won't go over your budget or split your group unless you say so. Which would you like to change?</p></div>`}
function applyAvailability(r){if(!r||!r.trace)return;for(const e of r.trace)if(e.kind==="snapshot"&&e.seats)for(const id of e.seats){if(SEATS[id])SEATS[id].taken=true}}
function showResult(bubble,r){lastResult=r;applyAvailability(r);markOutdated(r);bubble.classList.remove("failed");bubble.textContent="";
  if(r.outcome==="recommend"&&r.groups.length){bubble.append(bestCard(r));recs=r.groups.map(g=>g.seats);const s=SEATS[recs[0][0]];selected=s.id;cmpPair=null;
    if(view==="AIR"){airGoal.target.set(seatX(s.letter)*0.3,0.4,backZ[s.row]);airGoal.zoom=Math.min(airGoal.zoom,0.78);aimSelLight(s.id)}
    $("followups").hidden=false}
  else if(r.outcome==="no_feasible"){noFitCard(r,bubble);recs=[]}
  else{bubble.textContent=r.message;if(r.groups.length&&r.outcome!=="selected"){const d=document.createElement("div");d.className="best";d.dataset.rev=r.state.revision;d.dataset.snap=r.snapshotVersion;
      d.innerHTML=r.groups.map((g,i)=>`<div class="alt"><span><b>${g.seats.join(" + ")}</b> · £${g.totalGBP}</span><button class="btn small" data-i="${i}">View</button></div>`).join("");
      d.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>viewSeats(r.groups[Number(b.dataset.i)].seats));bubble.append(d)}
    if(r.outcome==="clarify")recs=[]}
  $("intro").hidden=true;
  focus={seats:[],tone:null};ui.sync();applyHighlights();if(isMobile())bubble.scrollIntoView({block:"start"});else{const fd=$("feed");fd.scrollTop=Math.max(0,bubble.offsetTop-fd.offsetTop-8)}}
const newId=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
/* One request at a time; a failed message keeps a Retry that reuses its request id (the server then returns the
   stored answer instead of applying the turn twice). Progress lines are real execution events. */
async function call(fn,label,id=newId(),retryOf=null){if(busy){ui.toast("Still working on your last request");return}busy=true;sendBtn.disabled=true;renderCard();
  if(label)addMsg("user",label);const bubble=retryOf||addMsg("bot","");bubble.classList.remove("failed");bubble.textContent="Working…";
  const prog=document.createElement("span");prog.className="progress";bubble.append(prog);
  const onEvent=e=>{prog.textContent=e.title};
  try{const r=await fn({onEvent,clientId:id});showResult(bubble,r)}
  catch(e){bubble.classList.add("failed");bubble.textContent=e.status===429?"Too many requests. Wait a moment, then retry.":e.status===409?"Your previous request is still running. Retry in a moment.":`The request didn't reach the adviser (${e.message}). Your trip details are kept.`;
    const b=document.createElement("button");b.className="btn small";b.style.marginTop="8px";b.style.display="block";b.textContent="Retry";b.onclick=()=>{b.remove();call(fn,null,id,bubble)};bubble.append(b)}
  finally{busy=false;sendBtn.disabled=false;renderCard()}}
function send(){const q=qEl.value.trim();if(!q){qEl.focus();return}if(busy)return;qEl.value="";openTab("c");if(isMobile())setSheet("expanded");call(o=>API.chat(q,o),q)}
async function selectDemo(seats){await call(()=>API.select(seats),`Select ${seats.join(" + ")}`);if(lastResult&&lastResult.outcome==="selected"){mineGroup=seats;ui.sync();ui.toast(`Selected ${span(seats)} for this demo. Nothing has been booked.`)}}
sendBtn.onclick=send;qEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});

/* ---------- mobile: keep the composer above the on-screen keyboard ---------- */
if(window.visualViewport){const vv=window.visualViewport;const onVV=()=>{const kb=innerHeight-vv.height>120&&document.activeElement===qEl;document.body.classList.toggle("kb",kb&&isMobile());document.documentElement.style.setProperty("--vvh",vv.height+"px");if(kb&&isMobile())qEl.scrollIntoView({block:"nearest"})};
  vv.addEventListener("resize",onVV);qEl.addEventListener("focus",()=>{if(isMobile()){setSheet("expanded");setTimeout(onVV,300)}});qEl.addEventListener("blur",()=>setTimeout(onVV,100))}

/* ---------- a transition that somehow stalls is finished, so controls never stay disabled ---------- */
let tStart=0;setInterval(()=>{if(view==="T"){if(!tStart)tStart=performance.now();else if(performance.now()-tStart>8000&&trans){trans.finish();tStart=0}}else tStart=0},1000);

/* =====================================================================
   ABOUT THIS PROJECT (secondary): problem, what works, architecture, AI vs code, traces, evaluation, limitations
   ===================================================================== */
const AB={};
function abTab(k){document.querySelectorAll(".ab nav button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.x===k)));$("abBody").innerHTML=AB[k]?AB[k]():"";if(k==="recovery")wireRecovery()}
document.querySelectorAll(".ab nav button").forEach(b=>b.onclick=()=>{abTab(b.dataset.x);if(b.dataset.x==="eval")loadEval()});
$("aboutBtn").onclick=()=>{$("about").showModal();abTab("overview")};$("abClose").onclick=()=>$("about").close();
function modeLabel(){const m=window.MODEINFO||{};return m.mode==="live"?(API.kind==="preview"?"Live AI: Claude, through the viewer's own claude.ai account; tools run in this page":`Live AI: ${m.model||"Claude"}, called from the server`):"Rule-based demo: a deterministic parser, no AI model connected"}
AB.overview=()=>`<p><b>Seat Scout is a personal prototype exploring AI-assisted seat selection and interactive cabin previews for airline customer service.</b> Created by Mohammed Banabilh, with AI assistance. Code: <a href="https://github.com/Mohammed-890/seat-scout" target="_blank" rel="noopener">github.com/Mohammed-890/seat-scout</a>.</p>
 <h3>The problem</h3><p>Seat maps show numbers and colours, but passengers want to know what a seat is like: how much room there is, whether the window lines up, how hard it is to get out, and what they give up for a lower price. Those questions often end up with customer-service staff.</p>
 <h3>What works today</h3><ul><li>A 3D cabin preview with seated, window and legroom views, plus a seat map and a 2D chart.</li><li>Seat details from one dataset: sample price, pitch, modelled knee space, window position, aisle access, recline and storage.</li><li>An adviser that turns a request into requirements and preferences, checks every requirement in code, and explains the best match and its trade-off.</li><li>Comparison of two seats, a few seat controls (shade, tray, reading light, recline preview) and a demo selection that re-checks availability.</li></ul>
 <h3>What it isn't</h3><ul><li>Not a real airline service and not affiliated with any airline. Nothing is booked and no airline system is connected.</li><li>The layout, prices and availability are illustrative demo data. The outside view is illustrative and doesn't predict a real flight's view.</li></ul>
 <p>The adviser is currently running as: <b>${esc(modeLabel())}</b>.</p>`;
const BACKEND_SVG=()=>`<svg class="diagram" viewBox="0 0 900 360" role="img" aria-label="Architecture: browser, server agent, deterministic core, data">
<style>.b{fill:#fbf8f1;stroke:#c4c9d0}.t{fill:#1b2438;font:600 14px 'Instrument Sans',sans-serif}.s{fill:#4c5568;font:12px 'Instrument Sans',sans-serif}.l{stroke:#1b2438;stroke-width:1.4;fill:none;marker-end:url(#ar)}.tb{stroke:#d4912a;stroke-dasharray:6 5;fill:none}</style>
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1b2438"/></marker></defs>
<rect class="b" x="20" y="40" width="220" height="280" rx="12"/><text class="t" x="36" y="68">Browser</text><text class="s" x="36" y="92">3D cabin + seat chart</text><text class="s" x="36" y="112">Adviser chat</text><text class="s" x="36" y="132">About: trace + evaluation</text><text class="s" x="36" y="152">No keys, no model calls*</text>
<rect class="tb" x="270" y="20" width="610" height="320" rx="14"/><text class="s" x="284" y="40" fill="#8a5208">Trust boundary: server (API key, sessions, validation)</text>
<rect class="b" x="290" y="60" width="250" height="120" rx="12"/><text class="t" x="306" y="88">Agent loop (bounded)</text><text class="s" x="306" y="110">≤8 steps · model 30 s · tools 3 s</text><text class="s" x="306" y="130">Claude: interpret, choose tools,</text><text class="s" x="306" y="148">explain. Fallback: rule parser</text>
<rect class="b" x="290" y="200" width="250" height="120" rx="12"/><text class="t" x="306" y="228">Tools (zod-validated)</text><text class="s" x="306" y="250">updateTripPreferences · findAdjacent…</text><text class="s" x="306" y="268">getSeatEvidence · compareSeatOptions</text><text class="s" x="306" y="286">validateRecommendation · submit</text>
<rect class="b" x="590" y="60" width="270" height="120" rx="12"/><text class="t" x="606" y="88">Deterministic core</text><text class="s" x="606" y="110">constraints · adjacency · policy</text><text class="s" x="606" y="130">arithmetic · scoring · fit summary</text><text class="s" x="606" y="148">independent validation</text>
<rect class="b" x="590" y="200" width="270" height="120" rx="12"/><text class="t" x="606" y="228">Demo data (synthetic)</text><text class="s" x="606" y="250">cabin config + provenance</text><text class="s" x="606" y="268">demo policy · snapshots v1, v2…</text><text class="s" x="606" y="286">per-session trip state</text>
<path class="l" d="M240,150 C265,150 265,120 290,120"/><path class="l" d="M415,180 L415,200"/><path class="l" d="M540,260 C565,260 565,120 590,120"/><path class="l" d="M725,180 L725,200"/><path class="l" d="M290,270 C260,270 262,220 240,220"/></svg>
<p class="fine">* In the claude.ai preview the same core runs in the page and Claude is reached through the viewer's own account (artifact capability), still with no key in the page. In the repository, the model runs server-side.</p>`;
AB.how=()=>`<h3>Which parts use AI, and which use code</h3><ul><li><b>AI (only when a model is connected):</b> reading a free-text request into a structured trip state, choosing which tools to call, and writing the explanation.</li><li><b>Deterministic code (always):</b> prices and totals, availability, sitting together, the demo exit-row policy, ranking, the “You asked for …” summary and trade-off, comparison figures, and final validation before anything is shown or selected.</li><li><b>Rule-based demo mode:</b> without a model, a parser for common English and Arabic phrasings produces the same structured state and the same tools answer.</li></ul>
 ${BACKEND_SVG()}
 <h3>Requirements vs preferences</h3><p>A budget, party size, sitting together and any seat position you name are requirements; a group that misses one is never shown. Softened wishes (“I'd prefer a window”, “I want to sleep”) are preferences that rank the valid options. Follow-ups change only what you mention. If nothing fits, the adviser lists the changes that would work and asks which one you accept; it never relaxes a requirement on its own.</p>
 <h3>Trust boundaries</h3><ul><li>The API key lives only in the server environment and is never sent to the browser or written to traces.</li><li>Random HttpOnly session cookie, per-session state and availability, rate limits, body size limits and zod-validated inputs.</li><li>Passenger tips are returned as untrusted data; messages cannot change the demo policy or validation.</li></ul>`;
const KL={request:"Request",parsed:"Parsed",state:"Constraints",model_call:"Model",tool_call:"Tool call",tool_result:"Tool result",tool_error:"Tool error",candidates:"Candidates",exclusions:"Exclusions",scores:"Scores",validation:"Validation",snapshot:"Snapshot",fallback:"Fallback",final:"Final",note:"Note"};
function traceHTML(ev){return (ev||[]).map(e=>`<details class="ev ${e.status||""}"><summary><span class="k">${KL[e.kind]||e.kind}</span><span>${esc(e.title)}</span><span class="t">+${e.t} ms</span></summary>${e.data!==undefined?`<pre>${esc(JSON.stringify(e.data,null,1))}</pre>`:""}</details>`).join("")}
AB.trace=()=>`<p>Application events recorded while answering (not hidden model reasoning). Exclusion counts can overlap, because one group can fail several rules.</p>
 <h3>Your most recent request</h3>${lastResult?`<p class="fine">${esc(lastResult.mode)} · ${esc(lastResult.outcome)} · ${lastResult.metrics.latencyMs} ms · ${lastResult.metrics.toolCalls} tool calls · availability v${lastResult.snapshotVersion}</p>${traceHTML(lastResult.trace)}`:"<p>Ask the adviser something first.</p>"}
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
  <p>That figure measured <i>shown seat groups</i> against the constraints the parser recorded. In <code>nofeas-05</code> (“1 adult, window, total £2”) and <code>ar-03</code> (Arabic, “alone, window seat, £3”) the parser stored “window” as a preference, so free middle seats satisfied every recorded constraint and the solver was right about the wrong question.</p>
  <p>Re-running that earlier parser against today's checks (<code>eval/results/2026-10-14-deterministic-before-parser-fix.json</code>): request understanding <b>20/27</b>, parsed-constraint satisfaction <b>101/101</b>, actual-requirement satisfaction <b>95/101</b>, impossible requests recognised <b>4/6</b>. The fix: a named seat position is a requirement unless its clause softens it.</p></details>
  <h3>Failures (reported, not hidden)</h3><ul>${(sys[0]?.failures||[]).map(f=>`<li><code>${esc(f.id)}</code>: ${esc(f.problems.join("; "))}</li>`).join("")||"<li>none in this run</li>"}</ul>`};
const evalLive=()=>`<h3>Live-model evaluation</h3><p><b>Not run.</b> No Anthropic API key was available while this was built, so there are no live-model numbers, and none are shown or implied anywhere in the app or the repository.</p><p><code>npm run eval:live</code> would run the same ${EVAL&&EVAL.cases?EVAL.cases:47} cases through the tool-grounded Claude agent and a no-tools Claude baseline with the same model and settings, using the same independent checks.</p>`;
AB.eval=()=>evalDet()+evalLive();
AB.recovery=()=>`<p>These run the real recovery paths against the demo data. Results appear in the adviser.</p><div class="btns"><button class="btn" id="rTaken">A recommended seat is taken</button><button class="btn" id="rImpossible">Impossible budget</button><button class="btn" id="rTimeout">A tool times out</button></div>`;
function wireRecovery(){const go=f=>()=>{$("about").close();openTab("c");f()};
  $("rTaken").onclick=go(()=>call(()=>API.seatTaken(),"Demo: a recommended seat is taken by someone else"));
  $("rImpossible").onclick=go(()=>call(o=>API.impossible(o),"Demo: Make the total budget £1."));
  $("rTimeout").onclick=go(()=>call(o=>API.toolTimeout(o),"Demo: the next seat search times out"))}
AB.limits=()=>`<h3>Known limitations</h3><ul><li>Illustrative A320-style layout, sample prices and generated availability. Real cabins differ by airline and aircraft.</li><li>Knee space and window position come from a simplified 3D model; body clearance is an estimate, and height alone doesn't predict comfort. Noise is a coarse zone label.</li><li>The exit-row rules are an explicit demo policy, not any airline's.</li><li>The rule-based mode understands common English and Arabic phrasings only. Groups larger than three, or split seating, are not supported.</li><li>No live-model evaluation has been run (no API key was available).</li><li>The cabin, seats and scenery are simplified procedural models with a stylised finish, not photorealistic.</li><li>Rendering was only checked with software graphics in a test container; no frame-rate figure is claimed.</li></ul>
 <h3>Future improvements</h3><ul><li>Real seat maps and fares through an airline's own systems, with its permission.</li><li>A live-model evaluation with the same checks.</li><li>Accessibility needs (for example, seats near an accessible toilet) as explicit requirements.</li><li>Testing with real passengers and customer-service staff.</li></ul>`;

/* ================= start ================= */
function setModePill(){const m=window.MODEINFO||{};$("modeText").textContent=m.mode==="live"?"Adviser: Claude (live AI). Prices, availability and rules are checked by code.":"Rule-based demo: no AI model connected. Prices, availability and rules are checked by code."}
window.setModePill=setModePill;setModePill();
selected="14A";if(!window.NO3D){aimSelLight(selected);applyFades({ext:1,studio:1,upper:0});placeSun(new THREE.Vector3(0,1,ZC));selGlow=1}
setSheet("compact",true);ui.sync();applyHighlights();if(!window.NO3D)requestAnimationFrame(loop);
