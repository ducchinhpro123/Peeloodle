#!/usr/bin/env node
// Generates tasks.html (static, dependency-free board) from the plan document.
//   node scripts/build-task-board.mjs        # regenerate
//   node scripts/build-task-board.mjs --check # regenerate + assertions only
// The plan stays the source of truth: "done" comes from its [x] checkboxes,
// so the board cannot claim progress the document does not.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = resolve(root, "docs/slides-implementation-plan.md");
const OUT = resolve(root, "tasks.html");

const lines = readFileSync(PLAN, "utf8").split("\n");

const milestones = [];
const tasks = [];
let milestone = null;
let inChecklist = false;
let checklistIndex = 0;

for (const line of lines) {
  const heading = /^## (.+)$/.exec(line);
  if (heading) {
    inChecklist = /setup and migration checklist/i.test(heading[1]);
    const m = /^Milestone (\d+) — (.+)$/.exec(heading[1]);
    milestone = m ? { key: `M${m[1]}`, title: `Milestone ${m[1]} — ${m[2]}` } : null;
    if (milestone) milestones.push(milestone);
    continue;
  }

  if (inChecklist) {
    const item = /^- \[([ x])\] (.+)$/.exec(line);
    if (item) {
      if (!milestones.some((m) => m.key === "SETUP")) {
        milestones.push({ key: "SETUP", title: "Setup and migration checklist" });
      }
      tasks.push({
        id: `C${String(++checklistIndex).padStart(2, "0")}`,
        milestone: "SETUP",
        title: item[2].trim(),
        deps: [],
        evidence: "",
        done: item[1] === "x",
      });
    }
    continue;
  }

  if (!line.startsWith("|") || !milestone) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length !== 5 || !/^\[[ x]\]$/.test(cells[0]) || !/^P\d+$/.test(cells[1])) continue;
  tasks.push({
    id: cells[1],
    milestone: milestone.key,
    title: cells[2],
    deps: cells[3] === "—" ? [] : cells[3].split(",").map((d) => d.trim()),
    evidence: cells[4],
    done: cells[0] === "[x]",
  });
}

// Self-check: every P-task row in the document must survive parsing, and the
// dashboard's "done" count must equal the document's checkbox count.
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: parsed ${a}, document has ${b}`);
};
eq(tasks.length, lines.filter((l) => /^\| \[[ x]\] \| P\d+ \|/.test(l)).length + checklistIndex, "task count");
eq(
  tasks.filter((t) => t.done).length,
  lines.filter((l) => /^\| \[x\] \| P\d+ \|/.test(l) || /^- \[x\] /.test(l)).length,
  "done count",
);
eq(new Set(tasks.map((t) => t.id)).size, tasks.length, "unique IDs");
if (tasks.length < 20 || milestones.length < 3) throw new Error("parse produced suspiciously little");

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: "docs/slides-implementation-plan.md",
  milestones,
  tasks,
};

writeFileSync(OUT, render(payload));

const done = tasks.filter((t) => t.done).length;
console.log(`${OUT}: ${tasks.length} tasks (${done} done, ${tasks.length - done} open) across ${milestones.length} groups`);

function render(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StickerLab task board</title>
<style>
/* Tokens copied from src/styles.css (a static file cannot import the app stylesheet). */
:root{
  --ink:#08152f; --muted:#66758f; --mint:#08b879; --pale:#ddf7ed; --line:#e6ecf3;
  --cream:#fff5d8; --lav:#f0eafe; --sky:#e8f4ff; --blush:#fceaf3; --surface:#fff;
  --canvas:#fafbf8; --paper:#fff9ed; --radius:20px; --radius-sm:12px;
  --shadow:0 4px 16px #08152f08; --shadow-hover:0 8px 24px #08152f12;
  --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px;
  color:var(--ink); background:var(--canvas);
  font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif; font-weight:500;
}
*{box-sizing:border-box}
body{margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}
h1,h2,h3,p,ul{margin:0}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:3px solid var(--mint);outline-offset:2px}

header.top{padding:var(--space-6) var(--space-6) var(--space-4);background:linear-gradient(180deg,var(--pale),var(--canvas));border-bottom:1px solid var(--line)}
.top h1{font-size:clamp(22px,3vw,32px);font-weight:800;letter-spacing:-.02em}
.top .sub{color:var(--muted);font-size:14px;margin-top:6px}
.top .sub code{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.stats{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;margin-top:var(--space-5)}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px 14px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:20px;font-weight:800}
.stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.progress{flex:1 1 220px;min-width:180px}
.bar{height:10px;border-radius:99px;background:#fff;border:1px solid var(--line);overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--mint),#4fd6a4)}
.progress small{display:block;margin-top:6px;color:var(--muted);font-size:12px}

.toolbar{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;padding:var(--space-4) var(--space-6);position:sticky;top:0;background:rgba(250,251,248,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);z-index:5}
input[type=search],select{border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-sm);padding:9px 12px;min-width:0}
input[type=search]{flex:1 1 240px}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-sm);padding:9px 14px;cursor:pointer;font-weight:600;box-shadow:var(--shadow)}
.btn:hover{box-shadow:var(--shadow-hover)}
.hint{color:var(--muted);font-size:13px}

.board{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(260px,1fr));gap:var(--space-4);padding:var(--space-5) var(--space-6) var(--space-7);align-items:stretch}
@media (max-width:1100px){body{height:auto;overflow:visible}.board{flex:none;grid-template-columns:repeat(2,minmax(240px,1fr));align-items:start}.column{max-height:none}.cards{flex:none;max-height:calc(100vh - 300px)}}
@media (max-width:640px){.board{grid-template-columns:1fr;padding:var(--space-4)}header.top,.toolbar{padding-left:var(--space-4);padding-right:var(--space-4)}}
.column{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:var(--space-4);box-shadow:var(--shadow);min-height:120px;display:flex;flex-direction:column}
.column.over{border-color:var(--mint);background:var(--pale)}
.column h2{font-size:14px;font-weight:800;display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2)}
.column .count{color:var(--muted);font-weight:600;font-size:12px}
.column .note{color:var(--muted);font-size:12px;margin-top:4px}
.cards{display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-3);flex:1;min-height:0;overflow-y:auto;padding-right:2px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-sm);padding:var(--space-3);box-shadow:var(--shadow);cursor:grab;text-align:left;display:block;width:100%}
.card:hover{box-shadow:var(--shadow-hover)}
.card:active{cursor:grabbing}
.card[data-done="true"]{background:var(--pale);cursor:default}
.card.dragging{opacity:.5}
.card .id{font-size:11px;font-weight:800;letter-spacing:.08em;color:#0a7a56;background:var(--pale);border:1px solid #bff0dd;border-radius:6px;padding:1px 6px}
.card .mile{font-size:11px;color:var(--muted);float:right}
.card .title{font-size:14px;line-height:1.35;margin-top:var(--space-2);font-weight:600}
.card .deps{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--space-2)}
.card .dep{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;background:#fff}
.card .dep.unmet{color:#9a3412;border-color:#fed7aa;background:#fff7ed}
.card .ev{font-size:12px;color:var(--muted);margin-top:var(--space-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{color:var(--muted);font-size:13px;padding:var(--space-3) 0}

dialog{border:1px solid var(--line);border-radius:var(--radius);padding:0;max-width:620px;width:calc(100% - 32px);box-shadow:0 24px 60px #08152f2e}
dialog::backdrop{background:#08152f66}
dialog .body{padding:var(--space-5)}
dialog h3{font-size:18px;font-weight:800;margin-top:var(--space-2)}
dialog dl{margin:var(--space-4) 0 0;display:grid;grid-template-columns:120px 1fr;gap:10px var(--space-3);font-size:13px}
dialog dt{color:var(--muted);font-weight:700}
dialog dd{margin:0;line-height:1.5}
dialog footer{display:flex;justify-content:flex-end;gap:var(--space-3);padding:var(--space-4) var(--space-5);border-top:1px solid var(--line);background:var(--canvas)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>
</head>
<body>
<header class="top">
  <h1>StickerLab task board</h1>
  <p class="sub">Generated from <code>${escapeHtml(data.source)}</code> on ${data.generated}. "Done" comes from the plan's checkboxes; the other columns are your own browser state.</p>
  <div class="stats">
    <div class="progress">
      <div class="bar"><i id="bar" style="width:0%"></i></div>
      <small id="progressText"></small>
    </div>
    <div class="stat"><b id="statDone">0</b><span>done</span></div>
    <div class="stat"><b id="statOpen">0</b><span>open</span></div>
    <div class="stat"><b id="statDoing">0</b><span>in progress</span></div>
    <div class="stat"><b id="statBlocked">0</b><span>blocked</span></div>
  </div>
</header>

<div class="toolbar">
  <label class="sr" for="q">Search tasks</label>
  <input id="q" type="search" placeholder="Search by ID, task or evidence…">
  <label class="sr" for="mile">Filter by group</label>
  <select id="mile"><option value="">All groups</option></select>
  <button class="btn" id="reset" type="button">Reset my columns</button>
  <span class="hint">Drag a card, or focus it and press ← / → to move it.</span>
</div>

<main class="board" id="board"></main>

<dialog id="detail">
  <div class="body">
    <span class="id" id="dId"></span>
    <h3 id="dTitle"></h3>
    <dl>
      <dt>Group</dt><dd id="dMile"></dd>
      <dt>Depends on</dt><dd id="dDeps"></dd>
      <dt>Evidence</dt><dd id="dEv"></dd>
      <dt>Status</dt><dd id="dStatus"></dd>
    </dl>
  </div>
  <footer><button class="btn" id="dClose" type="button">Close</button></footer>
</dialog>

<div class="sr" id="live" role="status" aria-live="polite"></div>

<script>
const DATA = ${json};
const COLUMNS = [
  { key: "backlog", title: "Backlog" },
  { key: "doing", title: "In Progress" },
  { key: "blocked", title: "Blocked" },
  { key: "done", title: "Done", note: "Set by the plan's checkboxes — not draggable." }
];
const KEY = "stickerlab.board.v1";
const byId = Object.fromEntries(DATA.tasks.map(t => [t.id, t]));
const mileName = Object.fromEntries(DATA.milestones.map(m => [m.key, m.title]));

let manual = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(manual)); }
  catch { announce("This browser blocks local storage; column moves last until you reload."); }
}
const column = t => t.done ? "done" : (manual[t.id] || "backlog");
const announce = msg => { document.getElementById("live").textContent = msg; };

function visible() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const m = document.getElementById("mile").value;
  return DATA.tasks.filter(t =>
    (!m || t.milestone === m) &&
    (!q || (t.id + " " + t.title + " " + t.evidence + " " + t.deps.join(" ")).toLowerCase().includes(q)));
}

function render() {
  const tasks = visible();
  const board = document.getElementById("board");
  board.innerHTML = "";
  for (const col of COLUMNS) {
    const items = tasks.filter(t => column(t) === col.key);
    const el = document.createElement("section");
    el.className = "column";
    el.dataset.col = col.key;
    el.innerHTML = '<h2><span>' + col.title + '</span><span class="count"></span></h2>' +
      (col.note ? '<p class="note">' + col.note + '</p>' : "");
    el.querySelector(".count").textContent = items.length;
    const list = document.createElement("div");
    list.className = "cards";
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = tasks.length ? "Nothing here." : "No matching tasks.";
      list.append(p);
    }
    for (const t of items) list.append(card(t, col));
    el.append(list);
    if (col.key !== "done") {
      el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", e => {
        e.preventDefault();
        el.classList.remove("over");
        move(e.dataTransfer.getData("text/plain"), col.key);
      });
    }
    board.append(el);
  }
  const done = DATA.tasks.filter(t => t.done).length;
  const doing = DATA.tasks.filter(t => !t.done && manual[t.id] === "doing").length;
  const blocked = DATA.tasks.filter(t => !t.done && manual[t.id] === "blocked").length;
  document.getElementById("statDone").textContent = done;
  document.getElementById("statOpen").textContent = DATA.tasks.length - done;
  document.getElementById("statDoing").textContent = doing;
  document.getElementById("statBlocked").textContent = blocked;
  const pct = DATA.tasks.length ? Math.round(done / DATA.tasks.length * 100) : 0;
  document.getElementById("bar").style.width = pct + "%";
  document.getElementById("progressText").textContent =
    pct + "% of " + DATA.tasks.length + " tasks complete (" + done + " done, " + (DATA.tasks.length - done) + " open)";
}

function card(t, col) {
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;
  el.dataset.id = t.id;
  el.dataset.done = String(t.done);
  if (!t.done) el.draggable = true;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", t.id + ": " + t.title + " (" + col.title + ")");

  const head = document.createElement("div");
  head.innerHTML = '<span class="id"></span><span class="mile"></span>';
  head.querySelector(".id").textContent = t.id;
  head.querySelector(".mile").textContent = mileName[t.milestone] || t.milestone;
  el.append(head);

  const h = document.createElement("p");
  h.className = "title";
  h.textContent = t.title;
  el.append(h);

  const unmet = t.deps.filter(d => byId[d] && !byId[d].done);
  if (t.deps.length) {
    const deps = document.createElement("div");
    deps.className = "deps";
    for (const d of t.deps) {
      const s = document.createElement("span");
      s.className = "dep" + (unmet.includes(d) ? " unmet" : "");
      s.textContent = unmet.includes(d) ? d + " (open)" : d;
      deps.append(s);
    }
    el.append(deps);
  }

  if (t.evidence) {
    const ev = document.createElement("p");
    ev.className = "ev";
    ev.textContent = t.evidence;
    el.append(ev);
  }

  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", t.id);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  el.addEventListener("click", () => openDetail(t));
  el.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(t); return; }
    if (t.done || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const order = ["backlog", "doing", "blocked"];
    const i = order.indexOf(column(t));
    const next = order[Math.min(order.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)))];
    if (next !== column(t)) move(t.id, next);
  });
  return el;
}

function move(id, to) {
  const t = byId[id];
  if (!t || t.done) return;
  manual[id] = to;
  save();
  render();
  const label = COLUMNS.find(c => c.key === to).title;
  announce(id + " moved to " + label);
  const next = document.querySelector('.card[data-id="' + id + '"]');
  if (next) next.focus();
}

function openDetail(t) {
  document.getElementById("dId").textContent = t.id;
  document.getElementById("dTitle").textContent = t.title;
  document.getElementById("dMile").textContent = mileName[t.milestone] || t.milestone;
  document.getElementById("dDeps").textContent = t.deps.length ? t.deps.join(", ") : "None";
  document.getElementById("dEv").textContent = t.evidence || "None recorded in the plan.";
  const col = COLUMNS.find(c => c.key === column(t));
  document.getElementById("dStatus").textContent = t.done ? "Done (per the plan)" : "Manual: " + col.title;
  const dlg = document.getElementById("detail");
  dlg.showModal();
  dlg.addEventListener("close", () => {
    const back = document.querySelector('.card[data-id="' + t.id + '"]');
    if (back) back.focus();
  }, { once: true });
}

document.getElementById("q").addEventListener("input", render);
document.getElementById("reset").addEventListener("click", () => {
  manual = {};
  save();
  render();
  announce("Manual columns reset.");
});
document.getElementById("dClose").addEventListener("click", () => document.getElementById("detail").close());
document.getElementById("detail").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

const sel = document.getElementById("mile");
for (const m of DATA.milestones) {
  const o = document.createElement("option");
  o.value = m.key;
  o.textContent = m.title;
  sel.append(o);
}
sel.addEventListener("change", render);
render();
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
