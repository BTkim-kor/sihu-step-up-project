/* 시후의 하루 계획표 — 온라인 공유판 (Firestore) */
'use strict';

const SNAP = 10;            // 최소 입력 단위(분)
const DAY = 1440;
const SLOTS = DAY / SNAP;   // 144
const ERASER = '__erase';

// 원 그래프 좌표계 (viewBox 360x360)
const CX = 180, CY = 180;
const R_OUT = 142;   // 파이 바깥 반지름
const R_HOLE = 58;   // 가운데 라벨 원
const R_RING_IN = 96; // 실행 도넛 안쪽
const R_TICK = 150, R_TICK_MAJOR = 155, R_LABEL = 167;

const $ = (id) => document.getElementById(id);

const DEFAULT_ACTIVITIES = [
  { id: 'math', name: '수학', color: '#4C6FFF', group: '공부' },
  { id: 'english', name: '영어', color: '#8B5CF6', group: '공부' },
  { id: 'korean', name: '국어', color: '#14B8A6', group: '공부' },
  { id: 'biology', name: '생물', color: '#22A559', group: '공부' },
  { id: 'physics', name: '물리', color: '#0EA5E9', group: '공부' },
  { id: 'chemistry', name: '화학', color: '#D6409F', group: '공부' },
  { id: 'meal', name: '식사', color: '#F2B134', group: '생활' },
  { id: 'hobby', name: '취미', color: '#F2994A', group: '생활' },
  { id: 'rest', name: '휴식', color: '#9AA5B1', group: '생활' },
  { id: 'move', name: '이동', color: '#C7CDD6', group: '생활' },
];

/* ---------------------------------------------------------------- utils */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const snap = (m) => Math.round(m / SNAP) * SNAP;

function minToStr(m) {
  m = clamp(Math.round(m), 0, DAY);
  const h = Math.floor(m / 60), mi = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
function strToMin(s) {
  const p = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!p) return null;
  return clamp(+p[1] * 60 + +p[2], 0, DAY);
}
function fmtDur(m) {
  m = Math.round(m);
  if (m <= 0) return '0분';
  const h = Math.floor(m / 60), mi = m % 60;
  if (h && mi) return `${h}시간 ${mi}분`;
  if (h) return `${h}시간`;
  return `${mi}분`;
}
function fmtDelta(m) {
  const s = m > 0 ? '+' : m < 0 ? '−' : '±';
  return s + fmtDur(Math.abs(m));
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function todayStr(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayStr(dt);
}
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 단축키 표기: macOS 는 ⌘, 그 외(Windows/Linux)는 Ctrl+
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** 그 주의 월요일. */
function weekStart(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return shiftDate(s, -((dt.getDay() + 6) % 7));
}

/** 받침 유무에 따라 조사를 붙인다. josa('수학','은','는') → '수학은' */
function josa(name, withBatchim, without) {
  const c = name.charCodeAt(name.length - 1);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : true;
  return esc(name) + (has ? withBatchim : without);
}

function emptyDay(d) {
  return { date: d, plan: [], actual: [], memo: '', updated_at: null };
}

async function copyText(text, btn, label) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* noop */ }
    ta.remove();
  }
  btn.textContent = label || '복사됨';
  setTimeout(() => { btn.textContent = original; }, 1400);
}

/* --------------------------------------------------------------- 클라우드 */
// 가족 하나 = 무작위로 만든 긴 코드(familyId) 하나. 그 코드를 아는 사람만
// 같은 Firestore 문서를 읽고 씁니다. 로그인 화면 없이 익명 인증만 사용합니다.

let FID = null;
let db = null;

function randomFamilyId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

function familyLink(fid) {
  const u = new URL(location.href);
  u.hash = '';
  u.search = '';
  u.searchParams.set('f', fid);
  return u.toString();
}

/** 링크나 코드를 붙여넣어도 코드만 뽑아낸다. */
function extractFamilyId(text) {
  const v = (text || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.searchParams.get('f') || null;
  } catch (_) {
    return v;
  }
}

/** true 를 돌려주면 방금 새 가족 공간을 만든 것 — 온보딩 화면을 보여준다. */
async function initCloud() {
  firebase.initializeApp(firebaseConfig);
  await firebase.auth().signInAnonymously();

  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('f');
  const stored = localStorage.getItem('sp_family_id');

  let isNew = false;
  let fid = fromUrl || stored;
  if (!fid) {
    fid = randomFamilyId();
    isNew = true;
  }

  localStorage.setItem('sp_family_id', fid);
  if (fromUrl) {
    url.searchParams.delete('f');
    history.replaceState(null, '', url);
  }

  FID = fid;
  db = firebase.firestore();
  return isNew;
}

function switchFamily(idOrLink) {
  const fid = extractFamilyId(idOrLink);
  if (!fid) return;
  localStorage.setItem('sp_family_id', fid);
  location.href = location.pathname;
}

/* ----------------------------------------------------------------- API */

async function apiGetActivities() {
  const snap = await db.doc(`families/${FID}/meta/activities`).get();
  const items = snap.exists ? snap.data().items : null;
  if (Array.isArray(items) && items.length) return items;
  await db.doc(`families/${FID}/meta/activities`).set({ items: DEFAULT_ACTIVITIES });
  return DEFAULT_ACTIVITIES.slice();
}

async function apiSaveActivities(list) {
  await db.doc(`families/${FID}/meta/activities`).set({ items: list });
}

async function apiGetDay(date) {
  const snap = await db.doc(`families/${FID}/days/${date}`).get();
  return snap.exists ? snap.data() : emptyDay(date);
}

async function apiSaveDay(payload) {
  await db.doc(`families/${FID}/days/${payload.date}`).set(payload);
}

async function apiGetRange(startStr, endStr) {
  const dates = [];
  for (let d = startStr; d <= endStr; d = shiftDate(d, 1)) dates.push(d);
  const snaps = await Promise.all(dates.map((d) => db.doc(`families/${FID}/days/${d}`).get()));
  return dates.map((d, i) => (snaps[i].exists ? snaps[i].data() : emptyDay(d)));
}

async function apiGetRecent(dateStr, n) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(shiftDate(dateStr, -i));
  const snaps = await Promise.all(dates.map((d) => db.doc(`families/${FID}/days/${d}`).get()));
  return snaps.filter((s) => s.exists).map((s) => s.data());
}

/* ---------------------------------------------------------------- state */

const state = {
  date: todayStr(),
  activities: [],
  byId: {},
  plan: [],
  actual: [],
  memo: '',
  sel: { plan: null, actual: null },
  recent: [],
  undo: [],
  loading: true,
};

const act = (id) => state.byId[id] || { id, name: id, color: '#c0c7d0', group: '생활' };

/* ------------------------------------------------------------ block ops */

function subtractRange(blocks, s, e) {
  const out = [];
  for (const b of blocks) {
    if (b.end <= s || b.start >= e) { out.push(b); continue; }
    if (b.start < s) out.push({ ...b, end: s });
    if (b.end > e) out.push({ ...b, start: e });
  }
  return out;
}

function normalize(blocks) {
  const sorted = blocks.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && last.activity === b.activity && last.end >= b.start) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

function addBlock(blocks, s, e, activity) {
  const out = subtractRange(blocks, s, e);
  out.push({ start: s, end: e, activity });
  return normalize(out);
}

function minutesOf(blocks, id) {
  let t = 0;
  for (const b of blocks) if (b.activity === id) t += b.end - b.start;
  return t;
}

function toSlots(blocks) {
  const a = new Array(SLOTS).fill(null);
  for (const b of blocks) {
    for (let i = Math.floor(b.start / SNAP); i < Math.ceil(b.end / SNAP); i++) {
      if (i >= 0 && i < SLOTS) a[i] = b.activity;
    }
  }
  return a;
}

function groupMinutes(blocks, group) {
  let t = 0;
  for (const b of blocks) if (act(b.activity).group === group) t += b.end - b.start;
  return t;
}

/* ------------------------------------------------------------- geometry */

function polar(r, deg) {
  const t = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)];
}
const minToDeg = (m) => (m / DAY) * 360;

function sector(r0, r1, a0, a1) {
  const span = a1 - a0;
  if (span <= 0.0001) return '';
  const large = span > 180 ? 1 : 0;
  const [x1, y1] = polar(r1, a0), [x2, y2] = polar(r1, a1);
  if (r0 <= 0) {
    return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r1} ${r1} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }
  const [x3, y3] = polar(r0, a1), [x4, y4] = polar(r0, a0);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r1} ${r1} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}` +
         ` L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r0} ${r0} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/** 하루 전체를 덮는 블록은 arc로 못 그리므로 circle로 대체한다. */
function segShape(b, r0, r1, fill, opacity) {
  const full = b.end - b.start >= DAY - 0.5;
  const op = opacity == null ? 1 : opacity;
  if (full) {
    if (r0 <= 0) return `<circle class="seg" cx="${CX}" cy="${CY}" r="${r1}" fill="${fill}" fill-opacity="${op}"/>`;
    const rm = (r0 + r1) / 2;
    return `<circle class="seg" cx="${CX}" cy="${CY}" r="${rm}" fill="none" stroke="${fill}" stroke-opacity="${op}" stroke-width="${r1 - r0}"/>`;
  }
  const d = sector(r0, r1, minToDeg(b.start), minToDeg(b.end));
  return d ? `<path class="seg" d="${d}" fill="${fill}" fill-opacity="${op}"/>` : '';
}

const MIN_LABEL_MIN = 50; // 이보다 짧은 블록엔 글자가 겹쳐서 이름을 안 그린다

/** 배경색 밝기에 따라 검정/흰색 글자 중 더 잘 보이는 쪽을 고른다. */
function pickTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? '#1b2330' : '#ffffff';
}

/** 블록이 채워진 자리에 활동 이름을 그린다. 클릭하면 이름·색을 고칠 수 있다. */
function segLabel(b, r0, r1) {
  if (b.end - b.start < MIN_LABEL_MIN) return '';
  const mid = (b.start + b.end) / 2;
  const [x, y] = polar((r0 + r1) / 2, minToDeg(mid));
  const a = act(b.activity);
  return `<text class="seg-label" data-activity="${esc(b.activity)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"` +
         ` text-anchor="middle" dominant-baseline="central" fill="${pickTextColor(a.color)}">${esc(a.name)}</text>`;
}

/* --------------------------------------------------------------- render */

function wheelChrome() {
  let s = '';
  for (let h = 0; h < 24; h++) {
    const deg = h * 15;
    const major = h % 3 === 0;
    const [x1, y1] = polar(R_OUT + 2, deg);
    const [x2, y2] = polar(major ? R_TICK_MAJOR : R_TICK, deg);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--${major ? 'line-strong' : 'line'})" stroke-width="${major ? 1.6 : 1}" stroke-linecap="round"/>`;
    if (major) {
      const [lx, ly] = polar(R_LABEL, deg);
      s += `<text class="lbl lbl-major" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${h}</text>`;
    }
  }
  return s;
}

/** 시각 안내선. under=true 면 빈 영역용 회색 선, false 면 색칠 위에 얹는 흰 선. */
function spokes(under) {
  let s = '';
  for (let h = 0; h < 24; h++) {
    const [x1, y1] = polar(R_HOLE, h * 15);
    const [x2, y2] = polar(R_OUT, h * 15);
    const major = h % 3 === 0;
    const stroke = under ? 'var(--line)' : '#fff';
    const op = under ? (major ? 1 : 0.7) : (major ? 0.42 : 0.24);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-opacity="${op}" stroke-width="${major ? 1.2 : 0.8}"/>`;
  }
  return s;
}

function nowMarker() {
  if (state.date !== todayStr()) return '';
  const d = new Date();
  const deg = minToDeg(d.getHours() * 60 + d.getMinutes());
  const [x1, y1] = polar(R_HOLE - 4, deg), [x2, y2] = polar(R_OUT + 8, deg);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#eb5757" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>` +
         `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.6" fill="#eb5757"/>`;
}

let drag = null; // {side, startMin, acc, prevAng, activity}

function renderWheel(side) {
  const svg = side === 'plan' ? $('wheelPlan') : $('wheelActual');
  const blocks = state[side];
  let s = '';

  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="var(--card-soft)"/>`;
  s += spokes(true);

  if (side === 'plan') {
    for (const b of blocks) s += segShape(b, 0, R_OUT, act(b.activity).color, 1);
  } else {
    // 계획이 안쪽에 옅게 깔리고, 실행이 바깥 링으로 겹쳐진다
    for (const b of state.plan) s += segShape(b, 0, R_OUT, act(b.activity).color, 0.42);
    for (const b of blocks) s += segShape(b, R_RING_IN, R_OUT, act(b.activity).color, 1);
    s += `<circle cx="${CX}" cy="${CY}" r="${R_RING_IN}" fill="none" stroke="var(--card)" stroke-width="2"/>`;
  }

  s += spokes(false);

  // 활동 이름 — 눈금선 위에 그려서 글자가 잘리지 않게 한다
  if (side === 'plan') {
    for (const b of blocks) s += segLabel(b, 0, R_OUT);
  } else {
    for (const b of blocks) s += segLabel(b, R_RING_IN, R_OUT);
  }

  // 드래그 미리보기
  if (drag && drag.side === side && drag.range) {
    const [ds, de] = drag.range;
    const color = drag.activity === ERASER ? '#8b95a5' : act(drag.activity).color;
    const r0 = side === 'actual' ? R_RING_IN : 0;
    for (const seg of splitRange(ds, de)) {
      s += segShape({ start: seg[0], end: seg[1] }, r0, R_OUT, color, drag.activity === ERASER ? 0.35 : 0.55);
      const d = sector(r0, R_OUT, minToDeg(seg[0]), minToDeg(seg[1]));
      if (d) s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    }
  }

  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="none" stroke="var(--line-strong)" stroke-width="1.2"/>`;
  s += wheelChrome();
  if (side === 'actual') s += nowMarker();

  const study = groupMinutes(blocks, '공부');
  s += `<circle cx="${CX}" cy="${CY}" r="${R_HOLE}" fill="var(--card)" stroke="var(--line)" stroke-width="1"/>`;
  s += `<text class="center-sub" x="${CX}" y="${CY - 12}" text-anchor="middle" dominant-baseline="central">공부 시간</text>`;
  s += `<text class="center-main" x="${CX}" y="${CY + 8}" text-anchor="middle" dominant-baseline="central">${study ? esc(fmtDur(study)) : '—'}</text>`;

  svg.innerHTML = s;
}

/* ------------------------------------------------------------ dragging */

/** 자정을 넘긴 범위를 0~1440 안의 구간들로 쪼갠다. */
function splitRange(s, e) {
  const out = [];
  if (e <= s) return out;
  if (s < 0) { out.push([s + DAY, DAY]); s = 0; }
  if (e > DAY) { out.push([0, e - DAY]); e = DAY; }
  if (e > s) out.push([s, e]);
  return out.filter(([a, b]) => b > a);
}

function pointOf(svg, ev) {
  const r = svg.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * 360;
  const y = ((ev.clientY - r.top) / r.height) * 360;
  const dx = x - CX, dy = y - CY;
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { deg, dist: Math.hypot(dx, dy) };
}

function attachWheel(side) {
  const svg = side === 'plan' ? $('wheelPlan') : $('wheelActual');
  const tip = $('tooltip');

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.seg-label')) return; // 이름 클릭은 편집용 — 칠하기 시작하지 않는다
    const p = pointOf(svg, ev);
    if (p.dist > R_OUT + 14 || p.dist < 14) return;
    const activity = state.sel[side];
    if (!activity) return;
    try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
    drag = { side, activity, startDeg: p.deg, prevAng: p.deg, acc: 0, range: null, moved: false };
    ev.preventDefault();
  });

  svg.addEventListener('click', (ev) => {
    const label = ev.target.closest('.seg-label');
    if (label) openActivityEditor(label.dataset.activity);
  });

  svg.addEventListener('pointermove', (ev) => {
    const p = pointOf(svg, ev);

    if (!drag || drag.side !== side) {
      if (p.dist <= R_OUT + 14) showTip(tip, ev, minToStr(snap((p.deg / 360) * DAY)));
      else tip.classList.remove('on');
      return;
    }

    let d = p.deg - drag.prevAng;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.prevAng = p.deg;
    drag.acc = clamp(drag.acc + d, -360, 360);

    const start = snap((drag.startDeg / 360) * DAY);
    const delta = snap((drag.acc / 360) * DAY);
    if (Math.abs(delta) >= SNAP) drag.moved = true;
    drag.range = delta >= 0 ? [start, start + delta] : [start + delta, start];

    const [a, b] = drag.range;
    showTip(tip, ev, `${minToStr((a + DAY) % DAY)} → ${minToStr(b === DAY ? DAY : ((b % DAY) + DAY) % DAY)} · ${fmtDur(b - a)}`);
    renderWheel(side);
  });

  const finish = (ev) => {
    if (!drag || drag.side !== side) return;
    const d = drag;
    drag = null;
    tip.classList.remove('on');
    try { svg.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }

    if (!d.moved || !d.range) { renderWheel(side); return; }
    pushUndo();
    let arr = state[side];
    for (const [s, e] of splitRange(d.range[0], d.range[1])) {
      arr = d.activity === ERASER ? normalize(subtractRange(arr, s, e)) : addBlock(arr, s, e, d.activity);
    }
    state[side] = arr;
    changed();
  };

  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('pointerleave', () => { if (!drag) $('tooltip').classList.remove('on'); });
}

function showTip(tip, ev, text) {
  tip.textContent = text;
  tip.style.left = ev.clientX + 'px';
  tip.style.top = ev.clientY + 'px';
  tip.classList.add('on');
}

/* -------------------------------------------------------------- palette */

function renderPalette(side) {
  const el = side === 'plan' ? $('palettePlan') : $('paletteActual');
  let s = '';
  for (const a of state.activities) {
    const on = state.sel[side] === a.id;
    s += `<button class="pal" data-act="${esc(a.id)}" aria-pressed="${on}" style="--pal-color:${esc(a.color)}">` +
         `<span class="sw" style="background:${esc(a.color)}"></span>${esc(a.name)}</button>`;
  }
  s += `<button class="pal eraser" data-act="${ERASER}" aria-pressed="${state.sel[side] === ERASER}" style="--pal-color:var(--ink-3)"><span class="sw"></span>지우개</button>`;
  s += `<button class="pal pal-add" data-add="1">＋ 활동</button>`;
  s += `<button class="pal pal-manage" data-manage="1">⚙ 관리</button>`;
  el.innerHTML = s;

  el.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => { state.sel[side] = b.dataset.act; renderPalette(side); updateNowBtn(); };
  });
  el.querySelector('[data-add]').onclick = () => showAddForm(el, side);
  el.querySelector('[data-manage]').onclick = openActivityManager;
}

function showAddForm(el, side) {
  if (el.querySelector('.addform')) return;
  const f = document.createElement('form');
  f.className = 'addform';
  f.innerHTML = `<input type="text" placeholder="활동 이름" maxlength="20" required>
    <input type="color" value="#6b7cff">
    <button class="sm" type="submit">추가</button>
    <button class="sm ghost" type="button" data-cancel>취소</button>`;
  el.appendChild(f);
  f.querySelector('input').focus();
  f.querySelector('[data-cancel]').onclick = () => f.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.querySelector('input[type=text]').value.trim();
    if (!name) return;
    const id = 'c' + Date.now().toString(36);
    state.activities.push({ id, name, color: f.querySelector('input[type=color]').value, group: '공부' });
    indexActivities();
    await apiSaveActivities(state.activities);
    state.sel[side] = id;
    renderPalette('plan'); renderPalette('actual'); updateNowBtn();
  };
}

function updateNowBtn() {
  const id = state.sel.actual;
  $('nowActName').textContent = !id || id === ERASER ? '(활동 선택)' : act(id).name;
}

/* -------------------------------------------------------- 활동 이름·색 편집 */

let editingActivityId = null;

function openActivityEditor(id) {
  const a = act(id);
  editingActivityId = id;
  $('editActName').value = a.name;
  $('editActColor').value = a.color;
  $('editAct').hidden = false;
  $('editActName').focus();
  $('editActName').select();
}

function closeActivityEditor() {
  $('editAct').hidden = true;
  editingActivityId = null;
}

async function saveActivityEdit() {
  if (!editingActivityId) return;
  const name = $('editActName').value.trim();
  const color = $('editActColor').value;
  if (!name) return;
  const idx = state.activities.findIndex((a) => a.id === editingActivityId);
  if (idx === -1) return;
  state.activities[idx] = { ...state.activities[idx], name, color };
  indexActivities();
  await apiSaveActivities(state.activities);
  closeActivityEditor();
  renderPalette('plan'); renderPalette('actual'); updateNowBtn();
  renderAll();
}

function wireActivityEditor() {
  $('editActSave').onclick = saveActivityEdit;
  $('editActCancel').onclick = closeActivityEditor;
  $('editActName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveActivityEdit(); });
  $('editAct').addEventListener('click', (e) => { if (e.target.id === 'editAct') closeActivityEditor(); });
}

/* --------------------------------------------------------- 활동 목록 관리 */
// 블록을 먼저 그리지 않아도, 활동을 통째로 추가·이름변경·삭제할 수 있는 목록.

function renderActivityManager() {
  const el = $('manageActList');
  el.innerHTML = state.activities.map((a) => `
    <div class="ma-row" data-id="${esc(a.id)}">
      <input type="color" class="ma-color" value="${esc(a.color)}">
      <input type="text" class="ma-name" value="${esc(a.name)}" maxlength="20">
      <button class="ma-del" title="삭제">×</button>
    </div>`).join('');

  el.querySelectorAll('.ma-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.ma-name').addEventListener('change', (e) => {
      const name = e.target.value.trim();
      if (!name) { renderActivityManager(); return; }
      updateActivityField(id, 'name', name);
    });
    row.querySelector('.ma-color').addEventListener('change', (e) => updateActivityField(id, 'color', e.target.value));
    row.querySelector('.ma-del').onclick = () => deleteActivity(id);
  });
}

async function updateActivityField(id, field, value) {
  const idx = state.activities.findIndex((a) => a.id === id);
  if (idx === -1) return;
  state.activities[idx] = { ...state.activities[idx], [field]: value };
  indexActivities();
  await apiSaveActivities(state.activities);
  renderPalette('plan'); renderPalette('actual'); updateNowBtn(); renderAll();
}

async function deleteActivity(id) {
  const a = act(id);
  if (!confirm(`"${a.name}" 활동을 목록에서 지울까요? 이미 그려둔 블록은 남지만, 이름이 "${id}"처럼 어색하게 보일 수 있습니다.`)) return;
  state.activities = state.activities.filter((x) => x.id !== id);
  indexActivities();
  await apiSaveActivities(state.activities);
  if (state.sel.plan === id) state.sel.plan = state.activities[0]?.id || null;
  if (state.sel.actual === id) state.sel.actual = state.activities[0]?.id || null;
  renderActivityManager();
  renderPalette('plan'); renderPalette('actual'); updateNowBtn(); renderAll();
}

function openActivityManager() {
  renderActivityManager();
  $('manageAct').hidden = false;
}

function closeActivityManager() {
  $('manageAct').hidden = true;
}

function wireActivityManager() {
  $('manageActClose').onclick = closeActivityManager;
  $('manageAct').addEventListener('click', (e) => { if (e.target.id === 'manageAct') closeActivityManager(); });
  $('manageActAddForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('manageActAddName').value.trim();
    if (!name) return;
    const id = 'c' + Date.now().toString(36);
    state.activities.push({ id, name, color: $('manageActAddColor').value, group: '공부' });
    indexActivities();
    await apiSaveActivities(state.activities);
    e.target.reset();
    $('manageActAddColor').value = '#6b7cff';
    renderActivityManager();
    renderPalette('plan'); renderPalette('actual'); updateNowBtn();
  };
}

/* ----------------------------------------------------------- block list */

function renderBlocks(side) {
  const el = side === 'plan' ? $('blocksPlan') : $('blocksActual');
  const arr = state[side];
  el.innerHTML = arr.map((b, i) => {
    const a = act(b.activity);
    return `<div class="brow" data-i="${i}">
      <span class="sw" style="background:${esc(a.color)}"></span>
      <span class="nm" title="${esc(a.name)}">${esc(a.name)}</span>
      <input type="time" step="600" value="${minToStr(b.start)}" data-f="start">
      <span class="sep">→</span>
      <input type="time" step="600" value="${minToStr(b.end % DAY)}" data-f="end">
      <span class="dur">${fmtDur(b.end - b.start)}</span>
      <button class="del" title="삭제">×</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.brow').forEach((row) => {
    const i = +row.dataset.i;
    row.querySelector('.del').onclick = () => {
      pushUndo();
      state[side] = state[side].filter((_, k) => k !== i);
      changed();
    };
    row.querySelectorAll('input[type=time]').forEach((inp) => {
      inp.onchange = () => {
        const b = state[side][i];
        if (!b) return;
        let s = strToMin(row.querySelector('[data-f=start]').value);
        let e = strToMin(row.querySelector('[data-f=end]').value);
        if (s === null || e === null) { renderBlocks(side); return; }
        if (e === 0) e = DAY;                      // 종료 00:00 은 24:00 으로 본다
        if (e <= s) { renderBlocks(side); return; }
        pushUndo();
        const rest = state[side].filter((_, k) => k !== i);
        state[side] = addBlock(rest, s, e, b.activity);
        changed();
      };
    });
  });
}

/* -------------------------------------------------------------- 분석 */

function recentWithToday() {
  const days = state.recent.filter((d) => d.date !== state.date).slice();
  days.push({ date: state.date, plan: state.plan, actual: state.actual });
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

function matchScore(plan, actual) {
  const p = toSlots(plan), a = toSlots(actual);
  let denom = 0, hit = 0;
  for (let i = 0; i < SLOTS; i++) {
    if (!p[i] && !a[i]) continue;
    denom++;
    if (p[i] === a[i]) hit++;
  }
  return { denom, hit, pct: denom ? Math.round((hit / denom) * 100) : 0 };
}

function renderAnalysis() {
  const { denom, pct } = matchScore(state.plan, state.actual);

  $('scoreNum').textContent = denom ? pct : '–';
  $('scoreRing').classList.toggle('empty', !denom);
  $('scoreRing').style.setProperty('--p', denom ? pct : 0);

  const ps = groupMinutes(state.plan, '공부'), as = groupMinutes(state.actual, '공부');
  const pFilled = state.plan.reduce((t, b) => t + b.end - b.start, 0);
  const aFilled = state.actual.reduce((t, b) => t + b.end - b.start, 0);
  const dcls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

  $('kpis').innerHTML = `
    <div class="kpi"><div class="k">공부 시간 (계획 → 실제)</div>
      <div class="v"><span>${fmtDur(ps)} → ${fmtDur(as)}</span><span class="delta ${dcls(as - ps)}">${fmtDelta(as - ps)}</span></div></div>
    <div class="kpi"><div class="k">기록된 시간</div>
      <div class="v">${fmtDur(pFilled)} → ${fmtDur(aFilled)}</div></div>`;

  // 활동별 막대
  const rows = [];
  for (const a of state.activities) {
    const p = minutesOf(state.plan, a.id), ac = minutesOf(state.actual, a.id);
    if (!p && !ac) continue;
    rows.push({ a, p, ac });
  }
  rows.sort((x, y) => Math.max(y.p, y.ac) - Math.max(x.p, x.ac));
  const max = rows.reduce((m, r) => Math.max(m, r.p, r.ac), 1);
  $('bars').innerHTML = rows.length ? rows.map((r) => {
    const d = r.ac - r.p;
    return `<div class="bar-row">
      <span class="nm" title="${esc(r.a.name)}">${esc(r.a.name)}</span>
      <span class="bar-pair">
        <span class="bar plan"><i style="width:${(r.p / max) * 100}%;background:${esc(r.a.color)}"></i></span>
        <span class="bar"><i style="width:${(r.ac / max) * 100}%;background:${esc(r.a.color)}"></i></span>
      </span>
      <span class="dl delta ${dcls(d)}">${d === 0 ? '동일' : fmtDelta(d)}</span>
    </div>`;
  }).join('') : `<div class="sub" style="margin:0;font-weight:400">아직 비교할 데이터가 없습니다.</div>`;

  // 어긋난 시간대 Top 3
  const p = toSlots(state.plan), ac = toSlots(state.actual);
  const hours = [];
  for (let h = 0; h < 24; h++) {
    let miss = 0;
    const pc = {}, acc2 = {};
    for (let i = h * 6; i < h * 6 + 6; i++) {
      if (!(p[i] || ac[i]) || p[i] === ac[i]) continue;   // 어긋난 슬롯만 집계
      miss++;
      if (p[i]) pc[p[i]] = (pc[p[i]] || 0) + 1;
      if (ac[i]) acc2[ac[i]] = (acc2[ac[i]] || 0) + 1;
    }
    if (miss) hours.push({ h, miss, p: topKey(pc), a: topKey(acc2) });
  }
  hours.sort((x, y) => y.miss - x.miss);
  const nm = (id) => (id ? esc(act(id).name) : '비어 있음');
  $('gaps').innerHTML = hours.length
    ? hours.slice(0, 3).map((g) => `<li><b>${String(g.h).padStart(2, '0')}:00–${String(g.h + 1).padStart(2, '0')}:00</b> 계획 “${nm(g.p)}” → 실제 “${nm(g.a)}” <span style="color:var(--ink-3)">(${g.miss * SNAP}분 차이)</span></li>`).join('')
    : `<li class="empty">${denom ? '계획과 실행이 일치합니다 👏' : '계획과 실행을 모두 입력하면 표시됩니다.'}</li>`;

  $('tips').innerHTML = buildTips(pct, denom).map((t) => `<li>${t}</li>`).join('');
  const n = recentWithToday().filter((d) => d.plan.length || d.actual.length).length;
  $('daysStat').textContent = `최근 기록 ${n}일 기준`;
}

function topKey(counts) {
  let best = null, n = 0;
  for (const k in counts) if (counts[k] > n) { n = counts[k]; best = k; }
  return best;
}

function buildTips(pct, denom) {
  const days = recentWithToday().filter((d) => d.plan.length || d.actual.length);
  const tips = [];

  if (!state.plan.length) {
    tips.push('왼쪽 <b>계획</b> 원에 하루를 먼저 그려보세요. 활동을 고르고 원 위를 드래그하면 됩니다.');
    return tips;
  }
  if (!state.actual.length) {
    tips.push('오른쪽에서 <b>⧉ 계획 복사</b>를 누른 뒤, 실제로 달라진 부분만 고쳐 그리면 가장 빠릅니다.');
  }

  // 1) 반복적으로 계획보다 짧은 공부 활동 / 길어지는 비공부 활동
  const shortAgg = [], overAgg = [];
  for (const a of state.activities) {
    let short = 0, over = 0, sum = 0;
    for (const d of days) {
      const p = minutesOf(d.plan, a.id), ac = minutesOf(d.actual, a.id);
      if (!p && !ac) continue;
      sum += ac - p;
      if (p > 0 && ac <= p - 20) short++;
      if (p > 0 && ac >= p + 20) over++;
    }
    if (short >= 2 && a.group === '공부') shortAgg.push({ a, short, sum });
    if (over >= 2 && a.group !== '공부') overAgg.push({ a, over, sum });
  }
  shortAgg.sort((x, y) => y.short - x.short || x.sum - y.sum);
  overAgg.sort((x, y) => y.sum - x.sum);
  for (const s of shortAgg.slice(0, 2)) {
    tips.push(`<b>${josa(s.a.name, '은', '는')}</b> 최근 ${s.short}일간 계획보다 20분 이상 짧았습니다. 한 블록을 40분으로 줄이고 사이에 10분 휴식을 넣어보세요.`);
  }

  // 2) 반복적으로 어긋나는 시간대
  const hourMiss = new Array(24).fill(0);
  for (const d of days) {
    const p = toSlots(d.plan), a = toSlots(d.actual);
    if (!d.plan.length || !d.actual.length) continue;
    for (let h = 0; h < 24; h++) {
      let m = 0;
      for (let i = h * 6; i < h * 6 + 6; i++) if ((p[i] || a[i]) && p[i] !== a[i]) m++;
      if (m >= 4) hourMiss[h]++;
    }
  }
  const worst = hourMiss.map((v, h) => ({ v, h })).filter((x) => x.v >= 2).sort((x, y) => y.v - x.v)[0];
  if (worst) {
    tips.push(`<b>${String(worst.h).padStart(2, '0')}시대</b>는 ${worst.v}일 연속 계획대로 되지 않았습니다. 이 시간엔 가벼운 활동을 배치하고, 집중이 필요한 과목은 잘 지켜지는 시간대로 옮겨보세요.`);
  }

  // 3) 계획에 없는데 반복되는 활동
  for (const a of state.activities) {
    let c = 0;
    for (const d of days) if (!minutesOf(d.plan, a.id) && minutesOf(d.actual, a.id) >= 30) c++;
    if (c >= 2) {
      tips.push(`계획에 없던 <b>${josa(a.name, '이', '가')}</b> ${c}일 나타났습니다. 실제로 쓰는 시간이라면 계획에 넣어 두는 편이 낫습니다.`);
      break;
    }
  }

  // 4) 계획보다 길어지는 비공부 활동
  for (const o of overAgg.slice(0, 1)) {
    tips.push(`<b>${josa(o.a.name, '은', '는')}</b> ${o.over}일간 계획보다 길었습니다(누적 ${fmtDelta(o.sum)}). 계획에 그만큼 시간을 잡아두거나, 다음 활동 시작 시각에 알람을 걸어보세요.`);
  }

  // 5) 오늘 요약
  if (denom) {
    if (pct >= 85) tips.push(`오늘 일치율 <b>${pct}%</b>. 계획이 잘 맞습니다. 공부 블록을 10~20분 늘려볼 여유가 있습니다.`);
    else if (pct < 55) tips.push(`오늘 일치율 <b>${pct}%</b>. 계획이 실제보다 촘촘한 편입니다. 블록 수를 줄이고 여유 시간을 넣어보세요.`);
  }

  if (!tips.length) tips.push('며칠 더 기록하면 패턴을 기반으로 한 가이드가 여기에 나타납니다.');
  return tips.slice(0, 5);
}

/* -------------------------------------------------------------- 주간 요약 */

const week = { start: null, days: [] };

function dayStats(d) {
  const plan = d.plan || [], actual = d.actual || [];
  return {
    plan, actual,
    hasData: plan.length > 0 || actual.length > 0,
    planStudy: groupMinutes(plan, '공부'),
    actualStudy: groupMinutes(actual, '공부'),
    score: matchScore(plan, actual),
  };
}

async function openWeek(startStr) {
  week.start = startStr || weekStart(state.date);
  const end = shiftDate(week.start, 6);
  $('weekView').hidden = false;
  document.body.style.overflow = 'hidden';
  const days = await apiGetRange(week.start, end);
  // 화면에 떠 있는 오늘치는 아직 저장 전일 수 있으니 현재 상태로 바꿔 끼운다
  week.days = days.map((d) => (d.date === state.date
    ? { ...d, plan: state.plan, actual: state.actual, memo: state.memo } : d));
  renderWeek();
}

function closeWeek() {
  $('weekView').hidden = true;
  document.body.style.overflow = '';
}

function miniWheel(d) {
  let s = '<svg viewBox="0 0 360 360">';
  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="var(--card-soft)"/>`;
  for (const b of d.plan) s += segShape(b, 0, R_OUT, act(b.activity).color, 0.42);
  for (const b of d.actual) s += segShape(b, R_RING_IN, R_OUT, act(b.activity).color, 1);
  s += `<circle cx="${CX}" cy="${CY}" r="${R_RING_IN}" fill="none" stroke="var(--card)" stroke-width="2.5"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="44" fill="var(--card)"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="none" stroke="var(--line-strong)" stroke-width="1.4"/>`;
  return s + '</svg>';
}

function renderWeek() {
  const days = week.days;
  const stats = days.map(dayStats);
  const recorded = stats.filter((s) => s.hasData);
  const scored = stats.filter((s) => s.score.denom > 0);

  const [sy, sm, sd] = week.start.split('-').map(Number);
  const endS = shiftDate(week.start, 6).split('-').map(Number);
  $('weekLabel').textContent =
    `${sy}. ${sm}. ${sd}. – ${endS[1]}. ${endS[2]}.`;

  // KPI
  const pStudy = stats.reduce((t, s) => t + s.planStudy, 0);
  const aStudy = stats.reduce((t, s) => t + s.actualStudy, 0);
  const avg = scored.length ? Math.round(scored.reduce((t, s) => t + s.score.pct, 0) / scored.length) : null;
  const dcls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

  let best = null;   // days[0] 이 월요일이므로 요일은 DOW[(i + 1) % 7]
  stats.forEach((s, i) => {
    if (s.score.denom && (!best || s.score.pct > best.pct)) {
      best = { pct: s.score.pct, dow: DOW[(i + 1) % 7] };
    }
  });

  $('wkKpis').innerHTML = `
    <div class="wkpi"><div class="k">주간 공부 시간</div>
      <div class="v">${fmtDur(aStudy)}</div>
      <div class="s">계획 ${fmtDur(pStudy)} <span class="delta ${dcls(aStudy - pStudy)}">${fmtDelta(aStudy - pStudy)}</span></div></div>
    <div class="wkpi"><div class="k">평균 일치율</div>
      <div class="v">${avg === null ? '–' : avg + '%'}</div>
      <div class="s">${scored.length}일 평균</div></div>
    <div class="wkpi"><div class="k">기록한 날</div>
      <div class="v">${recorded.length} / 7</div>
      <div class="s">${recorded.length === 7 ? '한 주를 다 채웠습니다' : '빠진 날을 채우면 더 정확해집니다'}</div></div>
    <div class="wkpi"><div class="k">가장 잘 지킨 요일</div>
      <div class="v">${best ? best.dow + '요일' : '–'}</div>
      <div class="s">${best ? '일치율 ' + best.pct + '%' : '기록이 필요합니다'}</div></div>`;

  // 요일별 미니 원그래프
  $('wkMinis').innerHTML = days.map((d, i) => {
    const st = stats[i];
    const dow = DOW[(i + 1) % 7];
    const dd = d.date.slice(8);
    return `<button class="mini ${st.hasData ? '' : 'blank'} ${d.date === todayStr() ? 'today' : ''}" data-date="${d.date}">
      ${miniWheel(d)}
      <span class="d">${dow}<small>${+dd}일</small></span>
      <span class="m">${st.score.denom ? '일치 ' + st.score.pct + '%' : '기록 없음'}</span>
    </button>`;
  }).join('');
  $('wkMinis').querySelectorAll('.mini').forEach((b) => {
    b.onclick = () => { closeWeek(); load(b.dataset.date); };
  });

  // 요일별 일치율
  $('wkMatch').innerHTML = days.map((d, i) => {
    const st = stats[i];
    const on = st.score.denom > 0;
    return `<div class="daybar ${on ? '' : 'none'}">
      <span class="d">${DOW[(i + 1) % 7]} ${+d.date.slice(8)}일</span>
      <span class="t"><i style="width:${on ? st.score.pct : 0}%"></i></span>
      <span class="p">${on ? st.score.pct + '%' : '–'}</span>
    </div>`;
  }).join('');

  // 활동별 주간 합계
  const rows = [];
  for (const a of state.activities) {
    let p = 0, ac = 0;
    for (const d of days) { p += minutesOf(d.plan, a.id); ac += minutesOf(d.actual, a.id); }
    if (p || ac) rows.push({ a, p, ac });
  }
  rows.sort((x, y) => Math.max(y.p, y.ac) - Math.max(x.p, x.ac));
  const max = rows.reduce((m, r) => Math.max(m, r.p, r.ac), 1);
  $('wkBars').innerHTML = rows.length ? rows.map((r) => {
    const d = r.ac - r.p;
    return `<div class="bar-row">
      <span class="nm" title="${esc(r.a.name)}">${esc(r.a.name)}</span>
      <span class="bar-pair">
        <span class="bar plan"><i style="width:${(r.p / max) * 100}%;background:${esc(r.a.color)}"></i></span>
        <span class="bar"><i style="width:${(r.ac / max) * 100}%;background:${esc(r.a.color)}"></i></span>
      </span>
      <span class="dl delta ${dcls(d)}">${d === 0 ? '동일' : fmtDelta(d)}</span>
    </div>`;
  }).join('') : '<div class="sub" style="margin:0;font-weight:400">이번 주 기록이 없습니다.</div>';

  // 시간대별 이탈 빈도
  const miss = weekHourMiss(days);
  const mx = Math.max(1, ...miss);
  $('wkHours').innerHTML = miss.map((v, h) => `
    <div class="hourcol ${h % 3 === 0 ? 'q' : ''}" title="${h}시 · ${v}일 어긋남">
      <i style="height:${(v / mx) * 100}%;opacity:${v ? 0.35 + 0.65 * (v / mx) : 0}"></i>
      <span>${h % 3 === 0 ? h : ''}</span>
    </div>`).join('');

  $('wkTips').innerHTML = buildWeekTips(days, stats).map((t) => `<li>${t}</li>`).join('');
}

function weekHourMiss(days) {
  const out = new Array(24).fill(0);
  for (const d of days) {
    if (!d.plan.length || !d.actual.length) continue;
    const p = toSlots(d.plan), a = toSlots(d.actual);
    for (let h = 0; h < 24; h++) {
      let m = 0;
      for (let i = h * 6; i < h * 6 + 6; i++) if ((p[i] || a[i]) && p[i] !== a[i]) m++;
      if (m >= 3) out[h]++;
    }
  }
  return out;
}

function buildWeekTips(days, stats) {
  const tips = [];
  const scored = days.map((d, i) => ({ d, i, s: stats[i] })).filter((x) => x.s.score.denom > 0);

  if (!scored.length) {
    return ['이번 주에 계획과 실행을 모두 입력한 날이 없습니다. 하루만 채워도 비교가 시작됩니다.'];
  }

  // 가장 안 지켜진 요일
  const worstDay = scored.slice().sort((x, y) => x.s.score.pct - y.s.score.pct)[0];
  if (worstDay.s.score.pct < 70) {
    tips.push(`<b>${DOW[(worstDay.i + 1) % 7]}요일</b>이 일치율 ${worstDay.s.score.pct}% 로 가장 낮습니다. 이 요일만 계획을 느슨하게 다시 짜보세요.`);
  }

  // 공부 활동별 주간 누적 차이
  const gaps = [];
  for (const a of state.activities) {
    let p = 0, ac = 0;
    for (const d of days) { p += minutesOf(d.plan, a.id); ac += minutesOf(d.actual, a.id); }
    if (!p && !ac) continue;
    gaps.push({ a, p, ac, d: ac - p });
  }
  const studyShort = gaps.filter((g) => g.a.group === '공부' && g.d <= -30).sort((x, y) => x.d - y.d)[0];
  if (studyShort) {
    tips.push(`<b>${josa(studyShort.a.name, '은', '는')}</b> 이번 주에 계획보다 ${fmtDur(-studyShort.d)} 적었습니다(계획 ${fmtDur(studyShort.p)} → 실제 ${fmtDur(studyShort.ac)}). 하루 분량을 줄이고 요일 수를 늘리는 편이 지키기 쉽습니다.`);
  }
  const overrun = gaps.filter((g) => g.a.group !== '공부' && g.d >= 60).sort((x, y) => y.d - x.d)[0];
  if (overrun) {
    tips.push(`<b>${josa(overrun.a.name, '은', '는')}</b> 계획보다 ${fmtDur(overrun.d)} 더 썼습니다. 이 시간을 계획에 반영하거나, 끝나는 시각에 알람을 걸어보세요.`);
  }

  // 반복적으로 어긋나는 시간대
  const miss = weekHourMiss(days);
  const worstHour = miss.map((v, h) => ({ v, h })).sort((x, y) => y.v - x.v)[0];
  if (worstHour && worstHour.v >= 2) {
    tips.push(`<b>${String(worstHour.h).padStart(2, '0')}시대</b>가 ${worstHour.v}일 어긋났습니다. 이 시간에는 계획을 비워두거나 가벼운 활동을 넣고, 집중 과목은 잘 지켜진 시간대로 옮기세요.`);
  }

  // 주간 공부량 총평
  const pS = stats.reduce((t, s) => t + s.planStudy, 0);
  const aS = stats.reduce((t, s) => t + s.actualStudy, 0);
  const avg = Math.round(scored.reduce((t, x) => t + x.s.score.pct, 0) / scored.length);
  if (avg >= 85) {
    tips.push(`평균 일치율 <b>${avg}%</b>. 계획이 현실에 잘 맞습니다. 다음 주에 공부 시간을 하루 15~20분씩 늘려볼 만합니다.`);
  } else if (avg < 60) {
    tips.push(`평균 일치율 <b>${avg}%</b>. 계획이 실제보다 빡빡합니다. 블록 수를 줄이고 하루에 한두 개의 핵심 블록만 정해보세요.`);
  }
  if (pS && aS < pS * 0.7) {
    tips.push(`주간 공부 시간이 계획의 <b>${Math.round((aS / pS) * 100)}%</b> 에 그쳤습니다. 계획을 실제 달성치에 가깝게 낮춘 뒤 조금씩 올리는 쪽이 오래 갑니다.`);
  }

  const blank = days.length - days.filter((d) => d.plan.length || d.actual.length).length;
  if (blank >= 3) tips.push(`기록이 없는 날이 <b>${blank}일</b> 있습니다. 실행만이라도 남기면 다음 주 계획이 훨씬 정확해집니다.`);

  return tips.length ? tips.slice(0, 6) : ['이번 주는 계획과 실행이 잘 맞았습니다. 지금 방식을 유지하세요.'];
}

/* ------------------------------------------------------------ 저장/로드 */

let saveTimer = null;

function pushUndo() {
  state.undo.push({ plan: JSON.parse(JSON.stringify(state.plan)), actual: JSON.parse(JSON.stringify(state.actual)) });
  if (state.undo.length > 60) state.undo.shift();
}

function undo() {
  const s = state.undo.pop();
  if (!s) return;
  state.plan = s.plan;
  state.actual = s.actual;
  changed(true);
}

function renderAll() {
  renderWheel('plan');
  renderWheel('actual');
  renderBlocks('plan');
  renderBlocks('actual');
  $('planStat').textContent = statText(state.plan);
  $('actualStat').textContent = statText(state.actual);
  renderAnalysis();
}

function statText(arr) {
  const filled = arr.reduce((t, b) => t + b.end - b.start, 0);
  return `${arr.length}블록 · ${fmtDur(filled)}`;
}

function changed(skipUndoNote) {
  renderAll();
  if (state.loading) return;
  setSaveState('저장 중…', 'dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

function setSaveState(text, cls) {
  const el = $('saveState');
  el.textContent = text;
  el.className = 'savestate ' + (cls || '');
}

/** '저장' 버튼 / ⌘S·Ctrl+S — 대기 중인 자동 저장을 취소하고 즉시 저장한다. */
async function saveNow() {
  clearTimeout(saveTimer);
  const btn = $('saveBtn');
  btn.disabled = true;
  setSaveState('저장 중…', 'dirty');
  await save();
  btn.disabled = false;
}

async function save() {
  try {
    await apiSaveDay({
      date: state.date, plan: state.plan, actual: state.actual,
      memo: state.memo, updated_at: new Date().toISOString(),
    });
    setSaveState('저장됨 ' + new Date().toTimeString().slice(0, 5), 'saved');
  } catch (e) {
    console.error(e);
    setSaveState('저장 실패', 'dirty');
  }
}

async function load(dateStr) {
  state.loading = true;
  state.date = dateStr;
  state.undo = [];
  $('dateInput').value = dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  $('dowLabel').textContent = '(' + DOW[new Date(y, m - 1, d).getDay()] + ')';
  setSaveState('불러오는 중…', '');

  const [day, recent] = await Promise.all([
    apiGetDay(dateStr),
    apiGetRecent(dateStr, 7),
  ]);

  state.plan = normalize(day.plan || []);
  state.actual = normalize(day.actual || []);
  state.memo = day.memo || '';
  state.recent = Array.isArray(recent) ? recent : [];
  $('memo').value = state.memo;

  renderAll();
  state.loading = false;
  setSaveState(day.updated_at ? '저장됨' : '새 계획표', day.updated_at ? 'saved' : '');
}

function indexActivities() {
  state.byId = {};
  for (const a of state.activities) state.byId[a.id] = a;
}

/* ----------------------------------------------------------------- 공유 */

function wireShare() {
  $('shareBtn').onclick = () => {
    const pop = $('sharePop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) $('shareLink').value = familyLink(FID);
  };
  $('shareCopy').onclick = () => copyText($('shareLink').value, $('shareCopy'));
  $('joinBtn').onclick = () => {
    const v = $('joinInput').value.trim();
    if (!v) return;
    if (!confirm('다른 가족 코드로 전환하면 지금 화면은 새로고침됩니다. 계속할까요?')) return;
    switchFamily(v);
  };
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.share-wrap');
    if (wrap && !wrap.contains(e.target)) $('sharePop').hidden = true;
  });
}

function showOnboarding() {
  return new Promise((resolve) => {
    $('onboard').hidden = false;
    $('onboardLink').value = familyLink(FID);
    $('onboardCopy').onclick = () => copyText($('onboardLink').value, $('onboardCopy'), '복사됨');
    $('onboardStart').onclick = () => { $('onboard').hidden = true; resolve(); };
  });
}

function showCloudError() {
  document.body.innerHTML = `<div class="onboard">
    <div class="onboard-card">
      <div class="onboard-mark" style="filter:grayscale(1);opacity:.35"></div>
      <h1>연결할 수 없습니다</h1>
      <p><code>firebase-config.js</code> 설정이 비어 있거나 올바르지 않은 것 같습니다.<br>
      <code>docs/README.md</code> 의 설정 방법을 다시 확인해 주세요.</p>
    </div>
  </div>`;
}

/* ----------------------------------------------------------------- init */

async function init() {
  let isNewFamily = false;
  try {
    isNewFamily = await initCloud();
  } catch (e) {
    console.error(e);
    showCloudError();
    return;
  }

  if (isNewFamily) await showOnboarding();

  state.activities = await apiGetActivities();
  indexActivities();
  state.sel.plan = state.activities[0]?.id || null;
  state.sel.actual = state.activities[0]?.id || null;

  renderPalette('plan');
  renderPalette('actual');
  updateNowBtn();
  attachWheel('plan');
  attachWheel('actual');
  wireShare();
  wireActivityEditor();
  wireActivityManager();

  $('dateInput').onchange = (e) => load(e.target.value || todayStr());
  $('prevDay').onclick = () => load(shiftDate(state.date, -1));
  $('nextDay').onclick = () => load(shiftDate(state.date, 1));
  $('todayBtn').onclick = () => load(todayStr());
  $('undoBtn').onclick = undo;

  $('copyPlanBtn').onclick = () => {
    if (!state.plan.length) return;
    pushUndo();
    state.actual = JSON.parse(JSON.stringify(state.plan));
    changed();
  };

  $('nowBtn').onclick = () => {
    const id = state.sel.actual;
    if (!id || id === ERASER) return;
    const now = new Date();
    const end = snap(now.getHours() * 60 + now.getMinutes());
    // 지금 이전에 이미 기록된 마지막 지점부터 채운다 (계획을 복사해 둔 상태에서도 동작)
    const start = state.actual.reduce((m, b) => (b.end <= end ? Math.max(m, b.end) : m), 0);
    if (end <= start) return;
    pushUndo();
    state.actual = addBlock(state.actual, start, end, id);
    changed();
  };

  document.querySelectorAll('[data-clear]').forEach((b) => {
    b.onclick = () => {
      const side = b.dataset.clear;
      if (!state[side].length) return;
      pushUndo();
      state[side] = [];
      changed();
    };
  });

  $('memo').oninput = (e) => { state.memo = e.target.value; changed(); };

  $('saveBtn').onclick = saveNow;

  // 주간 요약
  $('weekBtn').onclick = () => openWeek();
  $('weekClose').onclick = closeWeek;
  $('weekPrev').onclick = () => openWeek(shiftDate(week.start, -7));
  $('weekNext').onclick = () => openWeek(shiftDate(week.start, 7));
  $('weekThis').onclick = () => openWeek(weekStart(todayStr()));

  // 단축키 — ⌘(macOS) / Ctrl(Windows·Linux) 양쪽 모두 동작한다
  $('saveBtn').title = `지금 저장 (${MOD}S)`;
  $('undoBtn').title = `되돌리기 (${MOD}Z)`;
  $('weekBtn').title = `이번 주 7일을 한 화면에서 비교 (${MOD}W)`;
  $('prevDay').title = '어제 (←)';
  $('nextDay').title = '내일 (→)';

  document.addEventListener('keydown', (e) => {
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const weekOpen = !$('weekView').hidden;
    const editOpen = !$('editAct').hidden;
    const manageOpen = !$('manageAct').hidden;
    const mod = e.metaKey || e.ctrlKey;
    const key = (e.key || '').toLowerCase();

    if (key === 'escape' && editOpen) { e.preventDefault(); closeActivityEditor(); return; }
    if (key === 'escape' && manageOpen) { e.preventDefault(); closeActivityManager(); return; }
    if (key === 'escape' && weekOpen) { e.preventDefault(); closeWeek(); return; }
    if (editOpen || manageOpen) return;

    if (mod && key === 's') { e.preventDefault(); saveNow(); return; }
    if (mod && key === 'z' && !typing && !weekOpen) { e.preventDefault(); undo(); return; }
    if (mod && key === 'w') {                        // 브라우저 탭 닫기는 막지 못할 수 있다
      e.preventDefault();
      weekOpen ? closeWeek() : openWeek();
      return;
    }
    if (typing || mod || e.altKey) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      weekOpen ? openWeek(shiftDate(week.start, -7)) : load(shiftDate(state.date, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      weekOpen ? openWeek(shiftDate(week.start, 7)) : load(shiftDate(state.date, 1));
    }
  });

  await load(todayStr());
  setInterval(() => { if (state.date === todayStr()) renderWheel('actual'); }, 60000);
}

init();
