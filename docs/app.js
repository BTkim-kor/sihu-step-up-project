/* 시후의 하루 계획표 — 온라인 공유판 (Firestore) */
'use strict';

const SNAP = 10;            // 최소 입력 단위(분)
const DAY = 1440;
const SLOTS = DAY / SNAP;   // 144
const ERASER = '__erase';

// 원 그래프 좌표계 (viewBox 400x400 — 바깥 여백은 콜아웃 라벨용으로 둔다)
const CX = 200, CY = 200;
const R_OUT = 142;   // 파이 바깥 반지름
const R_HOLE = 58;   // 가운데 라벨 원
// 실행(안쪽 진한 띠)의 바깥 경계 — 눈에 보이는 "면적"이 전체 원의 3/5이 되도록
// 계산한다. 원의 면적은 반지름의 제곱에 비례하므로, 반지름을 그대로 3/5 배
// 하면 면적은 (3/5)² ≈ 36%로 훨씬 작게 보인다. 그래서 √(3/5)를 곱한다.
const R_ACTUAL_OUT = Math.round(R_OUT * Math.sqrt(3 / 5));
const R_TICK = 150, R_TICK_MAJOR = 155, R_LABEL = 167;
const R_CALLOUT_START = R_OUT + 4;    // 콜아웃 점선이 시작하는 지점(파이 가장자리 바로 밖)
const R_CALLOUT_END = R_LABEL + 8;   // 점선이 끝나는 지점(시간 눈금 숫자 밖)
const R_CALLOUT_TEXT = R_CALLOUT_END + 10; // 이름 글자가 놓이는 지점

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

/* ------------------------------------------------------------ 주간 일정표 */
// 매주 새로 만들 때마다 채워지는 고정 시간표(기숙사/학교 일과 기준 기본값).
// 계획·실행 원그래프와는 완전히 별개의 데이터(요일 × 시간 칸 텍스트)다.

const SCHED_DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SCHED_WEEKDAYS = ['월', '화', '수', '목', '금'];
const SCHED_DORM_DAYS = ['월', '화', '수', '목']; // 금요일은 귀가라 기숙사 저녁 일과가 없다

// 시간 칸의 경계(자정 기준 분). 1교시~7교시와 점심시간은 어차피 학교가 정한
// 대로 못 바꾸는 시간이라, 30분씩 두 줄로 쪼개지 않고 한 줄로 묶어 표 높이를
// 줄였다. slot.id 는 이 시작분이라, 남긴 경계는 예전 키를 그대로 이어받는다.
const SCHED_SLOTS = [
  420, 450, 480, 500, 530,
  540, 600, 660, 720,   // 1~4교시 — 한 교시가 한 줄
  770,                  // 점심시간
  840, 900, 960,        // 5~7교시
  1020, 1050, 1070, 1110, 1140, 1170, 1200,
  1220, 1250, 1290, 1320, 1350, 1380, 1430, 1440,
].reduce((acc, m, i, arr) => {
  if (i < arr.length - 1) acc.push({ id: String(m), start: m, end: arr[i + 1] });
  return acc;
}, []).map((s) => ({ ...s, label: `${schedClock(s.start)}~${schedClock(s.end)}` }));

function schedClock(m) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// [적용 요일들, [시작 슬롯 인덱스, 끝 슬롯 인덱스], 칸에 들어갈 글자] — 이미지 그대로 옮김
const SCHED_DEFAULT_FILLS = [
  [SCHED_WEEKDAYS, [0, 0], '기상/샤워'],
  [SCHED_WEEKDAYS, [1, 2], '아침공부'],
  [SCHED_WEEKDAYS, [3, 3], '아침식사'],
  [SCHED_WEEKDAYS, [4, 4], '아침조회'],
  [SCHED_WEEKDAYS, [5, 5], '1교시'],
  [SCHED_WEEKDAYS, [6, 6], '2교시'],
  [SCHED_WEEKDAYS, [7, 7], '3교시'],
  [['월', '수', '금'], [8, 8], '4교시(자습)'],
  [['화', '목'], [8, 8], '4교시'],
  [SCHED_WEEKDAYS, [9, 9], '점심시간'],
  [SCHED_WEEKDAYS, [10, 10], '5교시'],
  [SCHED_WEEKDAYS, [11, 11], '6교시'],
  [['화'], [12, 12], '7교시'],
  [SCHED_WEEKDAYS, [14, 14], '종례'],
  [SCHED_WEEKDAYS, [15, 16], '저녁시간'],
  [['월', '화', '수', '목'], [17, 18], '비교과 활동'],
  [['금'], [17, 18], '귀가'],
  // 금요일 저녁은 귀가라 기숙사 일과(간식~취침)가 없다 — 목요일까지만 채운다
  [SCHED_DORM_DAYS, [20, 20], '간식타임'],
  [SCHED_DORM_DAYS, [25, 25], '샤워 및 하루일과 정리'],
  [SCHED_DORM_DAYS, [26, 26], 'Roll-Call / 취침'],
];

// 학습진도 현황판·수행평가가 함께 쓰는 과목 목록의 초기값.
// 하루 계획표의 활동 목록과는 별개다(색만 같은 계열로 맞춰 뒀다).
const DEFAULT_SUBJECTS = [
  { id: 'sub_kor', name: '국어', color: '#378ADD' },
  { id: 'sub_math', name: '수학', color: '#7F77DD' },
  { id: 'sub_eng', name: '영어', color: '#D85A30' },
  { id: 'sub_bio', name: '생물', color: '#1D9E75' },
  { id: 'sub_phy', name: '물리', color: '#5DCAA5' },
  { id: 'sub_che', name: '화학', color: '#D4537E' },
];

function buildDefaultScheduleCells() {
  const cells = {};
  for (const [days, [s0, s1], text] of SCHED_DEFAULT_FILLS) {
    for (const day of days) {
      for (let i = s0; i <= s1; i++) cells[`${day}_${SCHED_SLOTS[i].id}`] = text;
    }
  }
  return cells;
}

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

/** 최신 주가 먼저 오도록 정렬해서 돌려준다. */
async function apiListScheduleWeeks() {
  const snap = await db.collection(`families/${FID}/scheduleWeeks`).orderBy('weekStart', 'desc').get();
  return snap.docs.map((d) => d.data());
}

/** slots 는 시간 칸을 한 번이라도 고친 주에만 붙는다(안 고쳤으면 기본값을 쓴다). */
/* --- 학습진도 현황판 · 수행평가 (둘이 과목 목록을 함께 쓴다) --- */

async function apiGetSubjects() {
  const snap = await db.doc(`families/${FID}/meta/subjects`).get();
  const items = snap.exists ? snap.data().items : null;
  if (Array.isArray(items)) return items;
  await db.doc(`families/${FID}/meta/subjects`).set({ items: DEFAULT_SUBJECTS });
  return DEFAULT_SUBJECTS.map((s) => ({ ...s }));
}

async function apiSaveSubjects(list) {
  await db.doc(`families/${FID}/meta/subjects`).set({ items: list });
}

async function apiListProgressItems() {
  const snap = await db.collection(`families/${FID}/progressItems`).get();
  return snap.docs.map((d) => d.data());
}

async function apiSaveProgressItem(item) {
  await db.doc(`families/${FID}/progressItems/${item.id}`)
    .set({ ...item, updated_at: new Date().toISOString() });
}

async function apiDeleteProgressItem(id) {
  await db.doc(`families/${FID}/progressItems/${id}`).delete();
}

async function apiListTasks() {
  const snap = await db.collection(`families/${FID}/tasks`).get();
  return snap.docs.map((d) => d.data());
}

async function apiSaveTask(task) {
  await db.doc(`families/${FID}/tasks/${task.id}`)
    .set({ ...task, updated_at: new Date().toISOString() });
}

async function apiDeleteTask(id) {
  await db.doc(`families/${FID}/tasks/${id}`).delete();
}

async function apiDeleteScheduleWeek(weekStartStr) {
  await db.doc(`families/${FID}/scheduleWeeks/${weekStartStr}`).delete();
}

async function apiSaveScheduleWeek(weekStartStr, cells, slots) {
  const doc = { weekStart: weekStartStr, cells, updated_at: new Date().toISOString() };
  if (slots) doc.slots = slots;
  await db.doc(`families/${FID}/scheduleWeeks/${weekStartStr}`).set(doc);
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

const MIN_LABEL_MIN = 50;      // 이 이상이면 이름을 가로로 그린다
const MIN_LABEL_MIN_VERT = 22; // 가로로는 좁지만 이 이상이면 한 글자씩 세로로 쌓아 그린다

/** 배경색 밝기에 따라 검정/흰색 글자 중 더 잘 보이는 쪽을 고른다. */
function pickTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? '#1b2330' : '#ffffff';
}

/**
 * 블록이 채워진 자리에 활동 이름을 그린다. r0/r1 사이 정중앙(안쪽 원과 바깥
 * 원의 가운데)에 놓인다. 클릭하면 이름·색을 고칠 수 있다.
 * 가로로 넣기엔 좁은 블록은 한 글자씩 세로로 쌓아서라도 표시하고,
 * 그마저도 안 되는 아주 짧은 블록은 글자를 그리지 않는다.
 */
/** 가로 또는 반지름 방향 세로로 원 안에 들어가는 이름표. 너무 좁으면 아무것도 안 그린다(콜아웃은 segCallout 몫). */
function segLabel(b, r0, r1) {
  const dur = b.end - b.start;
  if (dur < MIN_LABEL_MIN_VERT) return '';

  const mid = (b.start + b.end) / 2;
  const midDeg = minToDeg(mid);
  const midR = (r0 + r1) / 2;
  const a = act(b.activity);
  const fill = pickTextColor(a.color);

  if (dur >= MIN_LABEL_MIN) {
    const [x, y] = polar(midR, midDeg);
    return `<text class="seg-label" data-activity="${esc(b.activity)}" text-anchor="middle"` +
           ` dominant-baseline="central" fill="${fill}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(a.name)}</text>`;
  }

  // 가로로 넣기엔 좁다 — "세로"의 기준은 화면 상/하가 아니라 그 블록의
  // 안쪽 원(위) → 바깥 원(아래) 방향이다. 글자를 한 자씩 그 방향(반지름)을
  // 따라 쌓는다. 글자 자체는 눕히지 않고 항상 똑바로 서 있는 채로 둔다.
  //
  // 다만 원 위쪽 절반(18시~24시~6시 구간)에서는 반지름이 커질수록 화면상
  // 오히려 위로 올라간다 — 그대로 두면 "수학"이 "학수"처럼 거꾸로 읽힌다.
  // 그 구간에서는 글자 순서를 반대로 배치해, 화면상 항상 첫 글자가 위에
  // 오도록(=위→아래로 읽히도록) 한다.
  const rad = (midDeg * Math.PI) / 180;
  const risesInward = Math.cos(rad) > 0; // true면 바깥으로 갈수록 화면상 위로 향한다
  const chars = Array.from(a.name);
  const radiusStep = 12;
  const tspans = chars.map((ch, i) => {
    const order = risesInward ? chars.length - 1 - i : i;
    const rr = midR + (order - (chars.length - 1) / 2) * radiusStep;
    const [x, y] = polar(rr, midDeg);
    return `<tspan x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(ch)}</tspan>`;
  }).join('');
  return `<text class="seg-label seg-label-v" data-activity="${esc(b.activity)}" text-anchor="middle"` +
         ` dominant-baseline="central" fill="${fill}">${tspans}</text>`;
}

/**
 * 가로도 세로도 들어가지 않을 만큼 좁은 블록의 이름표. 점선을 원 바깥
 * 여백까지 끌어내 그 끝에 이름을 적는다. 점선은 활동 색을 그대로 써서
 * 어느 블록의 이름인지 잇는다. 시간 눈금(wheelChrome) 위에 그려야 하므로
 * segLabel과 달리 renderWheel에서 별도로, 더 나중에 호출한다.
 */
function segCallout(b, r0, r1) {
  const dur = b.end - b.start;
  if (dur <= 0 || dur >= MIN_LABEL_MIN_VERT) return '';

  const mid = (b.start + b.end) / 2;
  const midDeg = minToDeg(mid);
  const a = act(b.activity);
  const [lx1, ly1] = polar(R_CALLOUT_START, midDeg);
  const [lx2, ly2] = polar(R_CALLOUT_END, midDeg);
  const [tx, ty] = polar(R_CALLOUT_TEXT, midDeg);
  const line = `<line class="seg-callout-line" x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}"` +
               ` x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" stroke="${a.color}"/>`;
  const text = `<text class="seg-label seg-label-callout" data-activity="${esc(b.activity)}" text-anchor="middle"` +
               ` dominant-baseline="central" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">${esc(a.name)}</text>`;
  return line + text;
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
    // 계획이 바깥쪽에 옅게 깔리고, 실행이 안쪽 진한 띠로 겹쳐진다
    for (const b of state.plan) s += segShape(b, 0, R_OUT, act(b.activity).color, 0.42);
    for (const b of blocks) s += segShape(b, R_HOLE, R_ACTUAL_OUT, act(b.activity).color, 1);
    s += `<circle cx="${CX}" cy="${CY}" r="${R_ACTUAL_OUT}" fill="none" stroke="var(--card)" stroke-width="2"/>`;
  }

  s += spokes(false);

  // 활동 이름 — 안쪽 원(계획: 가운데 구멍 / 실행: 가운데 구멍)과
  // 바깥 원(계획: 파이 바깥 / 실행: 진한 띠 바깥 경계) 사이 정중앙에 놓는다.
  // 눈금선 위에 그려서 글자가 잘리지 않게 한다.
  if (side === 'plan') {
    for (const b of blocks) s += segLabel(b, R_HOLE, R_OUT);
  } else {
    for (const b of blocks) s += segLabel(b, R_HOLE, R_ACTUAL_OUT);
  }

  // 드래그 미리보기
  if (drag && drag.side === side && drag.range) {
    const [ds, de] = drag.range;
    const color = drag.activity === ERASER ? '#8b95a5' : act(drag.activity).color;
    const r0 = side === 'actual' ? R_HOLE : 0;
    const r1 = side === 'actual' ? R_ACTUAL_OUT : R_OUT;
    for (const seg of splitRange(ds, de)) {
      s += segShape({ start: seg[0], end: seg[1] }, r0, r1, color, drag.activity === ERASER ? 0.35 : 0.55);
      const d = sector(r0, r1, minToDeg(seg[0]), minToDeg(seg[1]));
      if (d) s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    }
  }

  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="none" stroke="var(--line-strong)" stroke-width="1.2"/>`;
  s += wheelChrome();
  if (side === 'actual') s += nowMarker();

  // 콜아웃(점선 이름표)은 시간 눈금 숫자보다 바깥에 있으므로, 눈금을 그린
  // 뒤에 그려야 눈금 숫자에 가리지 않는다.
  if (side === 'plan') {
    for (const b of blocks) s += segCallout(b, R_HOLE, R_OUT);
  } else {
    for (const b of blocks) s += segCallout(b, R_HOLE, R_ACTUAL_OUT);
  }

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

/* -------------------------------------------------------------- 주간 일정표 */
// 원그래프로 계획을 그리는 것과는 별개로, 매주 반복되는 요일×시간 시간표를
// 표 형식으로 세워두는 화면. 새 주를 만들 때마다 학교 일과 기본값을 채워
// 넣고, 지난 주는 지우지 않고 아래로 계속 쌓아 언제든 다시 볼 수 있게 한다.

const schedule = { weeks: [], loaded: false }; // [{weekStart, cells, slots?}], 최신 주부터
const scheduleSaveTimers = {};
const scheduleOpen = new Set();     // 지난 주 중 한 줄 접기를 펼쳐 놓은 주
const scheduleExpanded = new Set(); // 그중 "펼쳐서 편집"까지 들어간 주
const scheduleSplit = new Set();    // 사용자가 "나누기"로 따로 떼어낸 칸 (`주|요일_슬롯id`)
// 다시 그린 뒤 커서를 어디에 놓을지. 표를 새로 그리면 입력칸이 통째로 바뀌어
// 커서가 날아가므로, 옮겨갈 자리를 여기 적어 두고 그리기 끝에 다시 잡는다.
let scheduleFocusTarget = null;     // {week, r, c} 또는 {week, slot}

/** (행,열)을 덮고 있는 칸의 입력칸에 커서를 놓는다. 묶인 칸이면 그 칸 하나. */
function focusScheduleCell(weekStartStr, r, c) {
  const table = document.querySelector(`.sched-table[data-week="${CSS.escape(weekStartStr)}"]`);
  if (!table) return false;
  const td = [...table.querySelectorAll('td[data-r]')].find((t) =>
    +t.dataset.r <= r && r <= +t.dataset.r2 && +t.dataset.c <= c && c <= +t.dataset.c2);
  const inp = td && td.querySelector('input');
  if (!inp) return false;
  inp.focus();
  inp.select();
  return true;
}

function focusScheduleTime(weekStartStr, slot) {
  const table = document.querySelector(`.sched-table[data-week="${CSS.escape(weekStartStr)}"]`);
  const inp = table && table.querySelector(`.sc-time-in[data-slot="${slot}"]`);
  if (!inp) return false;
  inp.focus();
  inp.select();
  return true;
}

function applyScheduleFocus() {
  const t = scheduleFocusTarget;
  if (!t) return;
  scheduleFocusTarget = null;
  if (t.slot !== undefined) focusScheduleTime(t.week, t.slot);
  else focusScheduleCell(t.week, t.r, t.c);
}

/**
 * 그 주가 쓰는 시간 칸 목록. 시간을 한 번도 안 고친 주(그리고 옛 데이터)는
 * 기본 시간표를 그대로 쓴다. slot.id 는 칸 데이터(cells)의 키에 들어가 있어서
 * 시간을 고쳐도 절대 바뀌면 안 된다 — start/end 만 움직인다.
 */
function slotsOf(w) {
  if (Array.isArray(w.slots) && w.slots.length) return w.slots;
  return SCHED_SLOTS.map((s) => ({ id: s.id, start: s.start, end: s.end }));
}

function slotLabel(slot) {
  return `${schedClock(slot.start)}~${schedClock(slot.end)}`;
}

/** "7:00~7:30", "07:00 - 7:30" 같은 걸 분 단위로 읽는다. 못 읽으면 null. */
function parseSchedTime(text) {
  const m = String(text).match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-–—]\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start < 0 || end > 1440 || start >= end) return null;
  return { start, end };
}

/**
 * 요약판용. 7요일 값이 전부 같은 상태로 이어지는 시간 칸들을 한 덩어리로 묶는다.
 * (예: 9:00~9:30 과 9:30~10:00 이 모든 요일에서 "1교시"면 한 줄로 합친다.)
 */
function schedGroups(slots, cells) {
  const valsOf = (i) => SCHED_DAYS.map((d) => (cells[`${d}_${slots[i].id}`] || '').trim());
  const out = [];
  slots.forEach((_, i) => {
    const vals = valsOf(i);
    const last = out[out.length - 1];
    if (last && last.vals.every((v, k) => v === vals[k])) last.to = i;
    else out.push({ from: i, to: i, vals });
  });
  return out;
}

/**
 * 편집판용. 같은 값이 붙어 있는 칸들을 직사각형(rowspan×colspan)으로 묶는다.
 * 기본값이 거의 안 바뀌는 표라, 같은 글자가 세로로 두 줄·가로로 월~금 반복되는
 * 걸 한 칸으로 보여주는 편이 훨씬 읽기 쉽다.
 *
 * - **빈 칸은 묶지 않는다.** 안 그러면 토/일 빈칸이 통째로 한 덩어리가 돼서
 *   특정 요일에만 뭘 적어 넣을 수가 없다.
 * - `isFixed(cellKey)` 가 true 인 칸(= 사용자가 "나누기"로 떼어낸 칸)도 묶지 않는다.
 */
function schedSpans(slots, cells, isFixed) {
  const R = slots.length, C = SCHED_DAYS.length;
  const key = (r, c) => `${SCHED_DAYS[c]}_${slots[r].id}`;
  const val = (r, c) => (cells[key(r, c)] || '').trim();
  const fixed = (r, c) => !!(isFixed && isFixed(key(r, c)));
  const covered = Array.from({ length: R }, () => new Array(C).fill(false));
  const out = [];

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (covered[r][c]) continue;
      const v = val(r, c);
      let cs = 1, rs = 1;
      if (v && !fixed(r, c)) {
        while (c + cs < C && !covered[r][c + cs] && val(r, c + cs) === v && !fixed(r, c + cs)) cs++;
        let ok = true;
        while (ok && r + rs < R) {
          for (let k = 0; k < cs; k++) {
            if (covered[r + rs][c + k] || val(r + rs, c + k) !== v || fixed(r + rs, c + k)) { ok = false; break; }
          }
          if (ok) rs++;
        }
      }
      for (let i = 0; i < rs; i++) for (let k = 0; k < cs; k++) covered[r + i][c + k] = true;
      const keys = [];
      for (let i = 0; i < rs; i++) for (let k = 0; k < cs; k++) keys.push(key(r + i, c + k));
      out.push({ r, c, rs, cs, v, keys });
    }
  }
  return out;
}

/** (r,c)에서 시작해 같은 값으로 상하좌우 이어지는 칸 전부의 키를 모은다. */
function schedSameRegion(slots, cells, r0, c0) {
  const key = (r, c) => `${SCHED_DAYS[c]}_${slots[r].id}`;
  const at = (r, c) => (cells[key(r, c)] || '').trim();
  const target = at(r0, c0);
  if (!target) return [];
  const seen = new Set([`${r0},${c0}`]);
  const stack = [[r0, c0]];
  const out = [];
  while (stack.length) {
    const [r, c] = stack.pop();
    out.push(key(r, c));
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr < 0 || nr >= slots.length || nc < 0 || nc >= SCHED_DAYS.length) continue;
      if (seen.has(`${nr},${nc}`) || at(nr, nc) !== target) continue;
      seen.add(`${nr},${nc}`);
      stack.push([nr, nc]);
    }
  }
  return out;
}

function isPastWeek(weekStartStr) {
  return daysBetween(weekStart(todayStr()), weekStartStr) < 0;
}

/** ISO 8601 주차. 그 주 목요일이 속한 해의 몇 번째 주인지로 센다. */
function isoWeekNo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // 그 주의 목요일로 이동
  const firstThu = new Date(t.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
  return 1 + Math.round((t - firstThu) / (7 * 86400000));
}

/**
 * 칸 색상 분류. 글자마다 색을 따로 주면 표가 무지개가 돼서 오히려 안 읽힌다.
 * "1교시~7교시"는 전부 학교수업 한 덩어리인 것처럼, 성격이 같은 일과를
 * 묶어 같은 색을 준다. 색 자체는 CSS 에서 `td[data-cat]` 으로 정한다.
 */
// 위에서부터 먼저 걸리는 규칙이 이긴다. "4교시(자습)"은 자습이 아니라 수업이고,
// "Roll-Call / 취침"은 점호가 아니라 잠자리라서 순서가 곧 의미다.
const SCHED_CATEGORIES = [
  ['class', /(^|\s)\d+\s*교시|수업/],
  ['study', /자습|공부|독서|스터디/],
  ['meal',  /식사|점심|저녁|아침밥|간식|중식|석식/],
  ['rest',  /기상|취침|샤워|정리|휴식|수면|세면/],
  ['meet',  /조회|종례|롤콜|roll-?call/i],
  ['act',   /비교과|활동|동아리|운동|체육|봉사/],
  ['move',  /귀가|이동|등교|하교|외출/],
];

function schedCategory(text) {
  const t = (text || '').trim();
  if (!t) return '';
  for (const [cat, re] of SCHED_CATEGORIES) if (re.test(t)) return cat;
  return '';
}

/** 분류에 안 걸리는 내용은 글자에서 색상(hue)을 뽑아 옅게 칠한다. */
function schedHue(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** 칸에 붙일 색 관련 속성(분류가 있으면 분류색, 없으면 글자 해시색). */
function schedCellAttrs(v) {
  if (!v) return '';
  const cat = schedCategory(v);
  return cat ? ` data-cat="${cat}"` : ` style="--cell-h:${schedHue(v)}"`;
}

async function loadScheduleWeeks() {
  schedule.weeks = await apiListScheduleWeeks();
  if (!schedule.weeks.length) {
    const ws = weekStart(todayStr());
    const cells = buildDefaultScheduleCells();
    await apiSaveScheduleWeek(ws, cells);
    schedule.weeks = [{ weekStart: ws, cells }];
  }
  schedule.loaded = true;
  renderScheduleWeeks();
}

/** 표 열 너비는 colgroup 으로 고정한다(칸을 묶어도 폭이 흔들리지 않게). */
function schedColGroup() {
  return `<colgroup><col class="sc-c-time">${SCHED_DAYS.map(() => '<col>').join('')}</colgroup>`;
}

/**
 * 편집판 — 같은 값이 붙어 있는 칸은 하나로 묶어서 보여주고, 묶인 칸에 쓴
 * 내용은 묶인 범위 전체에 적용된다. 특정 요일만 다르게 하고 싶으면 칸 안의
 * 나누기(⇹) 버튼으로 떼어낸 뒤 고치면 된다.
 */
function schedEditHtml(w) {
  const slots = slotsOf(w);
  const cells = w.cells;
  const head = `<tr><th class="sc-time">시간</th>${SCHED_DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>`;
  const spans = schedSpans(slots, cells, (k) => scheduleSplit.has(`${w.weekStart}|${k}`));
  const byRow = {};
  for (const s of spans) (byRow[s.r] = byRow[s.r] || []).push(s);

  // 안 묶인 칸이라도 옆/위아래에 같은 값이 있으면 "다시 합치기"를 띄운다
  const at = (r, c) => (cells[`${SCHED_DAYS[c]}_${slots[r].id}`] || '').trim();
  const canRejoin = (s) => {
    if (s.rs > 1 || s.cs > 1 || !s.v) return false;
    return [[s.r - 1, s.c], [s.r + 1, s.c], [s.r, s.c - 1], [s.r, s.c + 1]].some(
      ([r, c]) => r >= 0 && r < slots.length && c >= 0 && c < SCHED_DAYS.length && at(r, c) === s.v);
  };

  const body = slots.map((slot, r) => {
    const cols = (byRow[r] || []).sort((a, b) => a.c - b.c).map((s) => {
      const merged = s.rs > 1 || s.cs > 1;
      const span = (s.rs > 1 ? ` rowspan="${s.rs}"` : '') + (s.cs > 1 ? ` colspan="${s.cs}"` : '');
      const cls = `${s.v ? 'sc-filled' : ''}${merged ? ' sc-merged' : ''}`.trim();
      const hue = schedCellAttrs(s.v);
      const pos = ` data-r="${s.r}" data-c="${s.c}" data-r2="${s.r + s.rs - 1}" data-c2="${s.c + s.cs - 1}"`;
      let btn = '';
      if (merged) {
        btn = `<button class="sc-act sc-split" title="이 묶음을 요일·시간별로 나누기"` +
              ` data-week="${esc(w.weekStart)}" data-keys="${esc(s.keys.join(','))}">⇹</button>`;
      } else if (canRejoin(s)) {
        btn = `<button class="sc-act sc-join" title="옆에 같은 내용인 칸과 다시 합치기"` +
              ` data-week="${esc(w.weekStart)}" data-r="${s.r}" data-c="${s.c}">⇼</button>`;
      }
      // 칸이 좁아 글자가 잘릴 수 있어서, 마우스를 올리면 전체가 보이게 해 둔다
      return `<td${span}${cls ? ` class="${cls}"` : ''}${hue}${pos}>` +
        `<input type="text" maxlength="20" data-week="${esc(w.weekStart)}"` +
        `${s.v ? ` title="${esc(s.v)}"` : ''}` +
        ` data-keys="${esc(s.keys.join(','))}" value="${esc(s.v)}">${btn}</td>`;
    }).join('');
    return `<tr><td class="sc-time"><input type="text" class="sc-time-in" maxlength="13"` +
           ` data-week="${esc(w.weekStart)}" data-slot="${r}" value="${esc(slotLabel(slot))}"></td>${cols}</tr>`;
  }).join('');

  return `<div class="sched-table-wrap"><table class="sched-table" data-week="${esc(w.weekStart)}">${schedColGroup()}` +
         `<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/**
 * 요약판(지난 주 기본값) — 읽기 전용. 같은 내용이 이어지는 구간은 세로로
 * (schedGroups), 같은 내용인 이웃 요일은 가로로(colspan) 묶어서 한 칸으로
 * 보여준다. 아무것도 없는 구간은 얇은 빈 줄로만 남겨 높이를 줄인다.
 */
function schedSummaryHtml(w) {
  const slots = slotsOf(w);
  const head = `<tr><th class="sc-time">시간</th>${SCHED_DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>`;
  const body = schedGroups(slots, w.cells).map((g) => {
    const vals = g.vals;
    const time = `${schedClock(slots[g.from].start)}~${schedClock(slots[g.to].end)}`;
    if (vals.every((v) => !v)) {
      return `<tr class="sc-gap"><td class="sc-time">${time}</td><td colspan="${SCHED_DAYS.length}"></td></tr>`;
    }
    let cols = '';
    for (let i = 0; i < vals.length;) {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1] === vals[i]) j++;
      const span = j - i + 1;
      cols += `<td${span > 1 ? ` colspan="${span}"` : ''}` +
              `${vals[i] ? ` class="sc-filled"${schedCellAttrs(vals[i])}` : ''}>${esc(vals[i])}</td>`;
      i = j + 1;
    }
    return `<tr><td class="sc-time">${time}</td>${cols}</tr>`;
  }).join('');
  return `<div class="sched-table-wrap"><table class="sched-table sched-sum">${schedColGroup()}` +
         `<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** a→b 날짜 차이(일). "YYYY-MM-DD" 문자열을 로컬 자정 기준으로 비교한다. */
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

function scheduleWeekBadge(weekStartStr) {
  const diffWeeks = Math.round(daysBetween(weekStart(todayStr()), weekStartStr) / 7);
  if (diffWeeks === 0) return '이번 주';
  return diffWeeks > 0 ? `${diffWeeks}주 후` : `${-diffWeeks}주 전`;
}

/**
 * 지난 주는 기본적으로 **한 줄로 접어** 둔다. 몇 주만 쌓여도 요약판을 전부
 * 펼쳐 두면 스크롤이 끝없이 길어지는데, 실제로는 어느 주를 볼지 고른 뒤에야
 * 내용이 필요하다. 머리글 줄을 누르면 그 주만 펼쳐지고, 거기서 다시
 * "펼쳐서 편집"을 누르면 고칠 수 있는 표가 된다.
 */
function scheduleWeekCardHtml(w) {
  const end = shiftDate(w.weekStart, 6);
  const [sy, sm, sd] = w.weekStart.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  const past = isPastWeek(w.weekStart);
  const open = !past || scheduleOpen.has(w.weekStart);
  const summary = past && !scheduleExpanded.has(w.weekStart);
  const cls = `sched-week${open ? '' : ' is-fold'}${open && summary ? ' is-sum' : ''}`;
  return `<section class="${cls}">
    <div class="sched-week-head${past ? ' is-foldable' : ''}"${past ? ` data-fold="${esc(w.weekStart)}"` : ''}>
      ${past ? `<span class="sc-chev">${open ? '▾' : '▸'}</span>` : ''}
      <span class="sc-wk">W${isoWeekNo(w.weekStart)}</span>
      <span>${sy}. ${sm}. ${sd}. – ${em}. ${ed}.</span>
      <span class="sub">${scheduleWeekBadge(w.weekStart)}</span>
      ${past && open ? `<button class="ghost sm sc-toggle" data-week="${esc(w.weekStart)}">${summary ? '펼쳐서 편집' : '요약 보기'}</button>` : ''}
      <button class="ghost sm sc-del" data-week="${esc(w.weekStart)}" title="이 주를 통째로 지우기">삭제</button>
    </div>
    ${open ? (summary ? schedSummaryHtml(w) : schedEditHtml(w)) : ''}
  </section>`;
}

function renderScheduleWeeks() {
  const el = $('scheduleWeeksList');

  // 실제로 계획을 세우는 건 이번 주와 다음 주뿐이라, 그 둘만 위에 나란히
  // (왼쪽 이번 주 · 오른쪽 다음 주) 놓고 나머지는 아래로 내린다.
  const thisWk = weekStart(todayStr());
  const nextWk = shiftDate(thisWk, 7);
  const pair = schedule.weeks
    .filter((w) => w.weekStart === thisWk || w.weekStart === nextWk)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const rest = schedule.weeks.filter((w) => w.weekStart !== thisWk && w.weekStart !== nextWk);

  el.innerHTML =
    (pair.length ? `<div class="sched-pair">${pair.map(scheduleWeekCardHtml).join('')}</div>` : '') +
    rest.map(scheduleWeekCardHtml).join('');

  // 머리글 줄 자체가 접기·펼치기 스위치다(줄 안의 버튼을 누른 건 제외).
  el.querySelectorAll('.sched-week-head[data-fold]').forEach((head) => {
    head.onclick = (e) => {
      if (e.target.closest('button')) return;
      const k = head.dataset.fold;
      if (scheduleOpen.has(k)) { scheduleOpen.delete(k); scheduleExpanded.delete(k); }
      else scheduleOpen.add(k);
      renderScheduleWeeks();
    };
  });

  el.querySelectorAll('.sc-toggle').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.week;
      if (scheduleExpanded.has(k)) scheduleExpanded.delete(k); else scheduleExpanded.add(k);
      renderScheduleWeeks();
    };
  });

  /**
   * 칸 내용 확정. 묶인 칸이면 그 칸이 덮고 있는 범위 전체에 똑같이 넣는다.
   * 실제로 바뀐 게 있을 때만 true 를 돌려준다.
   *
   * blur 때 오는 change 에만 기대지 않고 이 함수를 직접 부른다. change 는
   * 브라우저가 "사용자가 고쳤다"고 표시한 입력칸에서만 오는데, Enter 로
   * 확정하는 흐름까지 거기 얹으면 안 먹는 경우가 생긴다.
   */
  const commitCell = (inp) => {
    const w = schedule.weeks.find((x) => x.weekStart === inp.dataset.week);
    if (!w) return false;
    const val = inp.value.trim();
    const keys = inp.dataset.keys.split(',');
    if (keys.every((k) => (w.cells[k] || '') === val)) return false;
    for (const k of keys) {
      if (val) w.cells[k] = val; else delete w.cells[k];
    }
    const td = inp.closest('td');
    if (td) td.classList.toggle('sc-filled', !!val);
    scheduleSaveDebounced(w.weekStart);
    return true;
  };

  el.querySelectorAll('.sched-table input[data-keys]').forEach((inp) => {
    // 칸을 옮겨다니며 입력할 때 포커스가 끊기지 않도록, 여기서는 다시 그리지 않는다
    inp.addEventListener('change', () => commitCell(inp));
  });

  /** 지금 칸에서 dr행·dc열만큼 옮긴 자리. 묶인 칸은 그 덩어리 바깥으로 나간다. */
  const neighborOf = (inp, dr, dc) => {
    const td = inp.closest('td[data-r]');
    const table = inp.closest('.sched-table');
    if (!td || !table) return null;
    const rows = table.tBodies[0].rows.length;
    const r = dr > 0 ? +td.dataset.r2 + dr : +td.dataset.r + dr;
    const c = dc > 0 ? +td.dataset.c2 + dc : +td.dataset.c + dc;
    if (r < 0 || r >= rows || c < 0 || c >= SCHED_DAYS.length) return null;
    return { week: inp.dataset.week, r, c };
  };

  // 표 안 입력칸은 감싸는 폼이 없어서 Enter 가 그냥 무시된다. 직접 확정시키고,
  // 표 계산기처럼 아래 칸으로 커서를 넘긴다. 방향키로도 칸 사이를 오갈 수 있다.
  // (Esc 는 고치던 걸 물린다. 시간 칸은 아래에서 따로 처리.)
  el.querySelectorAll('.sched-table input[data-keys]').forEach((inp) => {
    const original = inp.value;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); inp.value = original; inp.blur(); return; }

      if (e.key === 'Enter') {
        e.preventDefault();
        const td = inp.closest('td[data-r]');
        const next = neighborOf(inp, 1, 0)
                  || { week: inp.dataset.week, r: +td.dataset.r, c: +td.dataset.c }; // 맨 아랫줄이면 제자리
        if (commitCell(inp)) {
          // 값이 바뀌면 묶임·색이 달라져 표를 다시 그려야 한다. 새로 그린
          // 표에서 커서를 다시 잡아야 하므로 갈 자리를 넘겨 둔다.
          scheduleFocusTarget = next;
          renderScheduleWeeks();
        } else {
          focusScheduleCell(next.week, next.r, next.c);
        }
        return;
      }

      const step = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (!step || e.metaKey || e.ctrlKey || e.altKey) return;
      // 좌우 화살표는 글자 안에서 커서를 옮기는 중이면 가로채지 않는다.
      // 다만 방금 이 칸으로 건너와 글자가 통째로 선택된 상태면 칸 이동으로 본다.
      const len = inp.value.length;
      const allSelected = inp.selectionStart === 0 && inp.selectionEnd === len && len > 0;
      if (step[1] && !allSelected) {
        const atStart = inp.selectionStart === 0 && inp.selectionEnd === 0;
        const atEnd = inp.selectionStart === len && inp.selectionEnd === len;
        if (step[1] < 0 && !atStart) return;
        if (step[1] > 0 && !atEnd) return;
      }
      const next = neighborOf(inp, step[0], step[1]);
      if (!next) return;
      e.preventDefault();
      commitCell(inp);   // 옮기기 전에 적어둔 값은 저장한다(다시 그리지는 않는다)
      focusScheduleCell(next.week, next.r, next.c);
    });
  });

  // 나누기 — 묶인 칸을 떼어내서 요일·시간별로 따로 고칠 수 있게 한다
  el.querySelectorAll('.sc-split').forEach((btn) => {
    btn.onclick = () => {
      for (const k of btn.dataset.keys.split(',')) scheduleSplit.add(`${btn.dataset.week}|${k}`);
      renderScheduleWeeks();
    };
  });

  // 다시 합치기 — 잘못 나눴을 때. 붙어 있는 같은 값 칸들의 나눔 표시를 지운다
  el.querySelectorAll('.sc-join').forEach((btn) => {
    btn.onclick = () => {
      const w = schedule.weeks.find((x) => x.weekStart === btn.dataset.week);
      if (!w) return;
      for (const k of schedSameRegion(slotsOf(w), w.cells, +btn.dataset.r, +btn.dataset.c)) {
        scheduleSplit.delete(`${w.weekStart}|${k}`);
      }
      renderScheduleWeeks();
    };
  });

  el.querySelectorAll('.sc-del').forEach((btn) => {
    btn.onclick = () => deleteScheduleWeek(btn.dataset.week);
  });

  el.querySelectorAll('.sched-table[data-week]').forEach(attachScheduleDrag);

  /** 'rejected' | 'same' | 'changed' — 커서를 옮겨도 되는지 판단하는 데 쓴다. */
  const commitTime = (inp) => {
    const w = schedule.weeks.find((x) => x.weekStart === inp.dataset.week);
    if (!w) return 'same';
    const slots = slotsOf(w).map((s) => ({ ...s }));
    const i = Number(inp.dataset.slot);
    const parsed = parseSchedTime(inp.value);
    const prev = i > 0 ? slots[i - 1] : null;
    const next = i < slots.length - 1 ? slots[i + 1] : null;
    // 못 읽는 값이거나, 바로 앞/뒤 칸을 0분 이하로 뭉개는 값이면 되돌린다
    if (!parsed
        || (prev && prev.start >= parsed.start)
        || (next && parsed.end >= next.end)
        || (!next && parsed.end > 1440)) {
      inp.value = slotLabel(slots[i]);
      return 'rejected';
    }
    if (parsed.start === slots[i].start && parsed.end === slots[i].end) return 'same';
    // 바뀐 만큼 바로 옆 한 칸의 길이만 늘거나 준다. 나머지 칸은 건드리지 않는다.
    slots[i].start = parsed.start;
    slots[i].end = parsed.end;
    if (prev) prev.end = parsed.start;
    if (next) next.start = parsed.end;
    w.slots = slots;
    scheduleSaveDebounced(w.weekStart);
    renderScheduleWeeks();               // 옆 칸 라벨도 같이 갱신된다
    return 'changed';
  };

  el.querySelectorAll('.sc-time-in').forEach((inp) => {
    const original = inp.value;
    const slot = Number(inp.dataset.slot);
    const rowCount = inp.closest('.sched-table').tBodies[0].rows.length;

    // 커서를 slot 번째 시간 칸으로 옮긴다. 값이 안 읽히는 상태면 고칠 수
    // 있도록 제자리에 둔다(다시 그렸다면 그리기 끝에서 이미 옮겨졌다).
    const moveTo = (target) => {
      scheduleFocusTarget = { week: inp.dataset.week, slot: target };
      const res = commitTime(inp);
      if (res === 'rejected') { scheduleFocusTarget = null; return; }
      if (res === 'same') applyScheduleFocus();
    };

    inp.addEventListener('change', () => commitTime(inp));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); inp.value = original; inp.blur(); return; }

      if (e.key === 'Enter') {
        e.preventDefault();
        moveTo(Math.min(slot + 1, rowCount - 1));   // 맨 아랫줄이면 제자리
        return;
      }

      const dir = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
      const next = slot + dir;
      if (next < 0 || next >= rowCount) return;
      e.preventDefault();
      moveTo(next);
    });
  });

  applyScheduleFocus();   // 다시 그리기 전에 적어둔 자리가 있으면 커서를 되돌린다
}

/**
 * 표 위에서 드래그하면 지나간 사각형 범위를 한 칸으로 합친다.
 * 칸이 전부 입력칸이라 누르는 순간에는 그냥 클릭인지 드래그인지 알 수 없다.
 * 그래서 몇 px 넘게 움직였을 때 비로소 드래그로 보고 입력 포커스를 뺀다.
 */
function attachScheduleDrag(table) {
  const weekStartStr = table.dataset.week;
  let anchor = null, dragging = false, x0 = 0, y0 = 0;

  const cellOf = (t) => (t && t.closest ? t.closest('td[data-r]') : null);
  const box = () => {
    const cur = cellOf(document.elementFromPoint(lastX, lastY));
    if (!cur) return null;
    return {
      r1: Math.min(+anchor.dataset.r, +cur.dataset.r),
      r2: Math.max(+anchor.dataset.r2, +cur.dataset.r2),
      c1: Math.min(+anchor.dataset.c, +cur.dataset.c),
      c2: Math.max(+anchor.dataset.c2, +cur.dataset.c2),
    };
  };
  let lastX = 0, lastY = 0;

  const paint = () => {
    const b = box();
    table.querySelectorAll('td[data-r]').forEach((td) => {
      const inBox = b && +td.dataset.r2 >= b.r1 && +td.dataset.r <= b.r2 &&
                        +td.dataset.c2 >= b.c1 && +td.dataset.c <= b.c2;
      td.classList.toggle('sc-picking', !!inBox);
    });
  };

  table.addEventListener('pointerdown', (e) => {
    // 터치는 제외한다 — 화면을 스크롤하려고 칸을 쓸어넘긴 것까지 합치기로
    // 오해하면 손대지도 않은 칸이 통째로 바뀐다. 터치에서는 버튼으로만 합친다.
    if (e.pointerType === 'touch') return;
    const td = cellOf(e.target);
    if (!td || e.button !== 0) return;
    anchor = td; dragging = false; x0 = e.clientX; y0 = e.clientY;
  });

  table.addEventListener('pointermove', (e) => {
    if (!anchor) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!dragging && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
    if (!dragging) {
      dragging = true;
      table.classList.add('sc-dragging');
      if (document.activeElement && table.contains(document.activeElement)) document.activeElement.blur();
    }
    e.preventDefault();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    paint();
  });

  const finish = () => {
    if (!anchor) return;
    const b = dragging ? box() : null;
    table.querySelectorAll('.sc-picking').forEach((td) => td.classList.remove('sc-picking'));
    table.classList.remove('sc-dragging');
    anchor = null; dragging = false;
    if (b && (b.r1 !== b.r2 || b.c1 !== b.c2)) mergeScheduleRange(weekStartStr, b);
  };
  table.addEventListener('pointerup', finish);
  table.addEventListener('pointercancel', finish);
  table.addEventListener('pointerleave', finish);
}

/** 드래그로 고른 범위를 같은 값으로 채워서 한 칸으로 만든다. */
function mergeScheduleRange(weekStartStr, b) {
  const w = schedule.weeks.find((x) => x.weekStart === weekStartStr);
  if (!w) return;
  const slots = slotsOf(w);
  const keys = [];
  for (let r = b.r1; r <= b.r2 && r < slots.length; r++) {
    for (let c = b.c1; c <= b.c2 && c < SCHED_DAYS.length; c++) keys.push(`${SCHED_DAYS[c]}_${slots[r].id}`);
  }
  // 범위 안에서 처음 만나는 내용을 대표값으로 삼는다(빈 칸만 골랐으면 할 일 없음)
  const val = keys.map((k) => (w.cells[k] || '').trim()).find((v) => v);
  if (!val) return;
  for (const k of keys) {
    w.cells[k] = val;
    scheduleSplit.delete(`${weekStartStr}|${k}`); // 전에 나눠둔 흔적도 지운다
  }
  scheduleSaveDebounced(weekStartStr);
  renderScheduleWeeks();
}

async function deleteScheduleWeek(weekStartStr) {
  const w = schedule.weeks.find((x) => x.weekStart === weekStartStr);
  if (!w) return;
  if (!confirm(`W${isoWeekNo(weekStartStr)} (${weekStartStr} 주)를 지울까요?\n지운 내용은 되돌릴 수 없습니다.`)) return;
  clearTimeout(scheduleSaveTimers[weekStartStr]);
  await apiDeleteScheduleWeek(weekStartStr);
  schedule.weeks = schedule.weeks.filter((x) => x.weekStart !== weekStartStr);
  scheduleExpanded.delete(weekStartStr);
  scheduleOpen.delete(weekStartStr);
  renderScheduleWeeks();
}

function scheduleSaveDebounced(weekStartStr) {
  clearTimeout(scheduleSaveTimers[weekStartStr]);
  scheduleSaveTimers[weekStartStr] = setTimeout(() => {
    const w = schedule.weeks.find((x) => x.weekStart === weekStartStr);
    if (w) apiSaveScheduleWeek(w.weekStart, w.cells, w.slots);
  }, 700);
}

async function addNewScheduleWeek() {
  const latest = schedule.weeks[0];
  const nextStart = latest ? shiftDate(latest.weekStart, 7) : weekStart(todayStr());
  if (schedule.weeks.some((w) => w.weekStart === nextStart)) return;
  const cells = buildDefaultScheduleCells();
  await apiSaveScheduleWeek(nextStart, cells);
  schedule.weeks.unshift({ weekStart: nextStart, cells });
  renderScheduleWeeks();
}

/**
 * 앱 맨 위 탭 전환. 탭은 열고 닫는 오버레이가 아니라 같은 화면 안의 여러
 * 페이지를 오가는 개념이라, 탭 버튼 자체가 라우터 역할을 한다. 탭을 더
 * 늘리려면 아래 표에 한 줄만 보태면 된다.
 */
const APP_TABS = {
  day:      { panel: 'panelDay' },
  schedule: { panel: 'panelSchedule', load: () => loadScheduleWeeks() },
  progress: { panel: 'panelProgress', load: () => loadProgress() },
  task:     { panel: 'panelTask',     load: () => loadTasks() },
};

async function switchTab(tab) {
  if (!APP_TABS[tab]) tab = 'day';
  for (const [name, def] of Object.entries(APP_TABS)) {
    $(def.panel).hidden = name !== tab;
  }
  document.querySelectorAll('.app-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  window.scrollTo(0, 0);
  // 다른 기기에서 고친 최신 내용을 탭에 들어갈 때마다 다시 받아온다
  if (APP_TABS[tab].load) await APP_TABS[tab].load();
}

/* ------------------------------------------- 과목 (진도판·수행평가 공용) */

const board = { subjects: [], items: [], tasks: [], taskSort: 'subject', loaded: false };

function subjOf(id) {
  return board.subjects.find((s) => s.id === id) || { id, name: '기타', color: '#888780' };
}

async function loadSubjects() {
  if (!board.subjects.length) board.subjects = await apiGetSubjects();
  return board.subjects;
}

function openSubjectManager() {
  $('subjEdit').hidden = false;
  renderSubjectManager();
}

function renderSubjectManager() {
  $('subjList').innerHTML = board.subjects.map((s, i) => `
    <div class="ma-row">
      <input type="color" value="${esc(s.color)}" data-sub="${esc(s.id)}" data-f="color">
      <input type="text" value="${esc(s.name)}" maxlength="12" data-sub="${esc(s.id)}" data-f="name">
      <button class="sm ghost" data-sub-up="${esc(s.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="sm ghost" data-sub-del="${esc(s.id)}">삭제</button>
    </div>`).join('');

  $('subjList').querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      const s = board.subjects.find((x) => x.id === inp.dataset.sub);
      if (!s) return;
      const v = inp.value.trim();
      if (inp.dataset.f === 'name' && !v) { inp.value = s.name; return; }
      s[inp.dataset.f] = inp.dataset.f === 'name' ? v : inp.value;
      apiSaveSubjects(board.subjects);
      renderProgress(); renderTasks();
    };
  });

  $('subjList').querySelectorAll('[data-sub-up]').forEach((btn) => {
    btn.onclick = () => {
      const i = board.subjects.findIndex((x) => x.id === btn.dataset.subUp);
      if (i <= 0) return;
      [board.subjects[i - 1], board.subjects[i]] = [board.subjects[i], board.subjects[i - 1]];
      apiSaveSubjects(board.subjects);
      renderSubjectManager(); renderProgress(); renderTasks();
    };
  });

  $('subjList').querySelectorAll('[data-sub-del]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.subDel;
      const used = board.items.filter((x) => x.subjectId === id).length
                 + board.tasks.filter((x) => x.subjectId === id).length;
      // 과목을 지우면 그 아래 항목이 갈 곳을 잃는다. 미리 알려주고 막는다.
      if (used) { alert(`이 과목에 항목·수행이 ${used}개 있습니다.\n먼저 옮기거나 지운 뒤에 과목을 삭제하세요.`); return; }
      if (!confirm(`'${subjOf(id).name}' 과목을 지울까요?`)) return;
      board.subjects = board.subjects.filter((x) => x.id !== id);
      apiSaveSubjects(board.subjects);
      renderSubjectManager(); renderProgress(); renderTasks();
    };
  });
}

/* ------------------------------------------------- 학습진도 현황판 */

/** 남은 날 대비 남은 분량으로 "이 속도면 며칠 빠름/늦음"을 계산한다. */
function itemPace(it) {
  const total = Number(it.total) || 0;
  const cur = Math.min(Number(it.current) || 0, total);
  const pct = total ? Math.round((cur / total) * 100) : 0;
  const out = { pct, cur, total, done: total > 0 && cur >= total };
  if (out.done || !it.dueDate) return out;

  const today = todayStr();
  const daysLeft = daysBetween(today, it.dueDate);
  const left = total - cur;
  out.daysLeft = daysLeft;
  out.perDay = daysLeft > 0 ? Math.ceil(left / daysLeft) : left;

  // 지금까지의 실제 속도로 남은 분량을 나눠 완료 예정일을 잡는다.
  const start = it.startDate || today;
  const elapsed = Math.max(1, daysBetween(start, today));
  const speed = cur / elapsed;                 // 하루 평균
  if (speed > 0) {
    const needDays = Math.ceil(left / speed);
    out.diff = daysLeft - needDays;            // +면 여유, -면 부족
  }
  return out;
}

function itemStatusChip(p) {
  if (p.done) return '<span class="pg-chip is-done">완료</span>';
  if (p.diff === undefined) return '<span class="pg-chip">기록 대기</span>';
  if (p.daysLeft < 0) return '<span class="pg-chip is-late">기한 지남</span>';
  if (p.diff >= 1) return `<span class="pg-chip is-ok">${p.diff}일 빠름</span>`;
  if (p.diff <= -1) return `<span class="pg-chip is-late">${-p.diff}일 늦음</span>`;
  return '<span class="pg-chip">일정대로</span>';
}

async function loadProgress() {
  await loadSubjects();
  board.items = await apiListProgressItems();
  renderProgress();
}

function renderProgress() {
  const el = $('progressList');
  if (!el) return;

  const live = board.items.filter((it) => !itemPace(it).done);
  const doneCount = board.items.length - live.length;
  const avg = live.length
    ? Math.round(live.reduce((a, it) => a + itemPace(it).pct, 0) / live.length) : 0;
  const behind = live.filter((it) => (itemPace(it).diff ?? 0) <= -1).length;

  $('progressSummary').innerHTML = board.items.length ? `
    <div class="pg-card"><div class="pg-k">진행 중</div><div class="pg-v">${live.length}권</div></div>
    <div class="pg-card"><div class="pg-k">평균 달성률</div><div class="pg-v">${avg}%</div></div>
    <div class="pg-card"><div class="pg-k">뒤처진 항목</div><div class="pg-v${behind ? ' is-warn' : ''}">${behind}건</div></div>
    <div class="pg-card"><div class="pg-k">끝낸 교재</div><div class="pg-v">${doneCount}권</div></div>` : '';

  const bySub = board.subjects
    .map((s) => ({ s, list: board.items.filter((it) => it.subjectId === s.id) }))
    .filter((g) => g.list.length);

  if (!bySub.length) {
    el.innerHTML = `<div class="pg-empty">
      아직 등록한 교재가 없습니다.
      <button class="primary sm" id="pgFirstAdd">＋ 첫 항목 추가</button>
    </div>`;
    const b = $('pgFirstAdd');
    if (b) b.onclick = () => openItemEditor(null, board.subjects[0] && board.subjects[0].id);
    return;
  }

  el.innerHTML = bySub.map(({ s, list }) => {
    const open = list.filter((it) => !itemPace(it).done);
    const fin = list.filter((it) => itemPace(it).done);
    const rows = open.map((it) => progressRowHtml(it, s)).join('');
    // 진행 중인 게 없으면 평균은 의미가 없다 — 0%도 100%도 거짓말이다
    const meta = open.length
      ? `항목 ${open.length} · 평균 ${Math.round(open.reduce((a, it) => a + itemPace(it).pct, 0) / open.length)}%`
      : '진행 중인 항목 없음';
    return `<section class="pg-sub">
      <div class="pg-sub-head">
        <span class="pg-dot" style="background:${esc(s.color)}"></span>
        <span class="pg-sub-name">${esc(s.name)}</span>
        <span class="pg-sub-meta">${meta}</span>
        <button class="ghost sm" data-add-item="${esc(s.id)}">＋ 항목 추가</button>
      </div>
      <div class="pg-rows">${rows || '<div class="pg-none">진행 중인 항목이 없습니다</div>'}</div>
      ${fin.length ? `<div class="pg-fold" data-fold-sub="${esc(s.id)}">
        <span class="sc-chev">${progressFolded.has(s.id) ? '▸' : '▾'}</span>
        <span>끝낸 항목 ${fin.length}개</span>
      </div>${progressFolded.has(s.id) ? '' : `<div class="pg-rows">${fin.map((it) => progressRowHtml(it, s)).join('')}</div>`}` : ''}
    </section>`;
  }).join('');

  el.querySelectorAll('[data-add-item]').forEach((b) => {
    b.onclick = () => openItemEditor(null, b.dataset.addItem);
  });
  el.querySelectorAll('[data-fold-sub]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.foldSub;
      if (progressFolded.has(k)) progressFolded.delete(k); else progressFolded.add(k);
      renderProgress();
    };
  });
  el.querySelectorAll('[data-edit-item]').forEach((b) => {
    b.onclick = () => openItemEditor(b.dataset.editItem);
  });
  el.querySelectorAll('input[data-cur]').forEach((inp) => {
    const commit = () => {
      const it = board.items.find((x) => x.id === inp.dataset.cur);
      if (!it) return;
      const v = Math.max(0, Math.min(Number(it.total) || 0, Math.round(Number(inp.value) || 0)));
      if (v === it.current) { inp.value = it.current; return; }
      it.current = v;
      // 날짜별 진도를 남겨 둬야 "하루 평균 몇 쪽"을 계산할 수 있다
      it.history = (it.history || []).filter((h) => h.date !== todayStr());
      it.history.push({ date: todayStr(), value: v });
      apiSaveProgressItem(it);
      renderProgress();
    };
    inp.onchange = commit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  });
}

const progressFolded = new Set();

function progressRowHtml(it, s) {
  const p = itemPace(it);
  const sub = p.done ? `${p.total}${esc(it.unit)} 완료`
    : `${p.perDay ? `하루 ${p.perDay}${esc(it.unit)}` : ''}${it.dueDate ? ` · 목표 ${it.dueDate.slice(5).replace('-', '/')}` : ''}`;
  return `<div class="pg-row${p.done ? ' is-done' : ''}">
    <span class="pg-kind">${esc(it.kind)}</span>
    <span class="pg-name" data-edit-item="${esc(it.id)}" title="눌러서 목표 고치기">${esc(it.name)}</span>
    <span class="pg-bar"><span style="width:${p.pct}%; background:${esc(s.color)}"></span></span>
    <span class="pg-num">
      <input type="number" data-cur="${esc(it.id)}" value="${p.cur}" min="0" max="${p.total}" aria-label="${esc(it.name)} 현재 진도">
      <span class="pg-den">/ ${p.total}${esc(it.unit)}</span>
    </span>
    ${itemStatusChip(p)}
    <span class="pg-sub2">${sub}</span>
  </div>`;
}

/* ------------------------------------------------------- 수행평가 */

/** 오늘 기준 남은 날. 음수면 기한이 지났다. */
function taskDays(t) {
  return daysBetween(todayStr(), t.dueDate);
}

/** 급한 정도 — 낮을수록 급하다. 정렬과 색을 이 값 하나로 정한다. */
function taskLevel(t) {
  if (t.done) return 3;
  const d = taskDays(t);
  if (d < 0) return 0;      // 기한 지남
  if (d <= 3) return 1;     // 사흘 안쪽
  if (d <= 10) return 2;    // 열흘 안쪽
  return 3;
}

const TASK_LEVEL_CLASS = ['is-over', 'is-soon', 'is-warn', ''];

function taskDdayText(t) {
  const d = taskDays(t);
  if (d < 0) return `${-d}일 지남`;
  if (d === 0) return 'D-day';
  return `D-${d}`;
}

async function loadTasks() {
  await loadSubjects();
  board.tasks = await apiListTasks();
  renderTasks();
}

/** 탭에 붙는 빨간 숫자 — 기한 지났거나 사흘 안쪽인 미제출 건수. */
function urgentTaskCount() {
  return board.tasks.filter((t) => !t.done && taskDays(t) <= 3).length;
}

function refreshTaskBadge() {
  const el = $('taskBadge');
  if (!el) return;
  const n = urgentTaskCount();
  el.textContent = n;
  el.hidden = !n;
}

function renderTasks() {
  const el = $('taskList');
  if (!el) return;
  refreshTaskBadge();

  const open = board.tasks.filter((t) => !t.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const done = board.tasks.filter((t) => t.done)
    .sort((a, b) => ((a.doneDate || '') > (b.doneDate || '') ? -1 : 1));

  // 대시보드 — 미제출이 있는 과목만. 다 낸 과목까지 칸을 만들면 급한 게 묻힌다.
  const groups = board.subjects
    .map((s) => ({ s, list: open.filter((t) => t.subjectId === s.id) }))
    .filter((g) => g.list.length)
    .sort((a, b) => taskDays(a.list[0]) - taskDays(b.list[0]));

  $('taskDash').innerHTML = groups.map(({ s, list }) => {
    const head = list[0];
    const lv = TASK_LEVEL_CLASS[taskLevel(head)];
    return `<div class="pg-card tk-card ${lv}" data-goto="${esc(s.id)}">
      <div class="pg-k"><span class="pg-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</div>
      <div class="pg-v">${taskDdayText(head)}</div>
      <div class="pg-k2">미제출 ${list.length}건</div>
    </div>`;
  }).join('');

  const over = open.filter((t) => taskDays(t) < 0);
  const soon = open.filter((t) => taskDays(t) >= 0 && taskDays(t) <= 3);
  const alertEl = $('taskAlert');
  alertEl.hidden = !(over.length || soon.length);
  if (!alertEl.hidden) {
    const names = [...over, ...soon].slice(0, 3)
      .map((t) => `${subjOf(t.subjectId).name} ${t.title}`).join(' · ');
    alertEl.innerHTML = `<span class="tk-alert-t">⚠ 기한 지남 ${over.length}건 · 3일 이내 ${soon.length}건</span>
      <span class="tk-alert-d">${esc(names)}</span>`;
  }

  let body;
  if (!open.length && !done.length) {
    body = `<div class="pg-empty">등록된 수행평가가 없습니다.
      <button class="primary sm" id="tkFirstAdd">＋ 첫 수행 추가</button></div>`;
  } else if (board.taskSort === 'due') {
    body = `<div class="tk-rows">${open.map(taskRowHtml).join('') || '<div class="pg-none">미제출 수행이 없습니다</div>'}</div>`;
  } else {
    body = groups.map(({ s, list }) => `
      <section class="pg-sub" id="tksub-${esc(s.id)}">
        <div class="pg-sub-head">
          <span class="pg-dot" style="background:${esc(s.color)}"></span>
          <span class="pg-sub-name">${esc(s.name)}</span>
          <span class="tk-badge ${TASK_LEVEL_CLASS[taskLevel(list[0])]}">${taskDdayText(list[0])}</span>
          <span class="pg-sub-meta">${list.length}건</span>
        </div>
        <div class="tk-rows">${list.map(taskRowHtml).join('')}</div>
      </section>`).join('')
      || '<div class="pg-none">미제출 수행이 없습니다</div>';
  }

  const foldOpen = !taskDoneFolded;
  body += done.length ? `
    <div class="pg-fold" id="tkDoneFold">
      <span class="sc-chev">${foldOpen ? '▾' : '▸'}</span>
      <span>제출 완료 ${done.length}건</span>
    </div>
    ${foldOpen ? `<div class="tk-rows">${done.map(taskRowHtml).join('')}</div>` : ''}` : '';

  el.innerHTML = body;

  el.querySelectorAll('[data-task-done]').forEach((b) => {
    b.onclick = () => {
      const t = board.tasks.find((x) => x.id === b.dataset.taskDone);
      if (!t) return;
      t.done = !t.done;
      t.doneDate = t.done ? todayStr() : '';
      apiSaveTask(t);
      renderTasks();
    };
  });
  el.querySelectorAll('[data-task-edit]').forEach((b) => {
    b.onclick = () => openTaskEditor(b.dataset.taskEdit);
  });
  const f = $('tkDoneFold');
  if (f) f.onclick = () => { taskDoneFolded = !taskDoneFolded; renderTasks(); };
  const fa = $('tkFirstAdd');
  if (fa) fa.onclick = () => openTaskEditor(null);

  $('taskDash').querySelectorAll('[data-goto]').forEach((c) => {
    c.onclick = () => {
      const sec = $(`tksub-${c.dataset.goto}`);
      if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
  });
}

let taskDoneFolded = false;

function taskRowHtml(t) {
  const s = subjOf(t.subjectId);
  const lv = TASK_LEVEL_CLASS[taskLevel(t)];
  if (t.done) {
    return `<div class="tk-row is-done">
      <span class="tk-check">✓</span>
      <span class="tk-title" data-task-edit="${esc(t.id)}">${esc(s.name)} · ${esc(t.title)}</span>
      <span class="tk-when">${t.doneDate ? `${t.doneDate.slice(5).replace('-', '/')} 제출` : '제출함'}</span>
      <button class="ghost sm" data-task-done="${esc(t.id)}">되돌리기</button>
    </div>`;
  }
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(t.dueDate + 'T00:00').getDay()];
  return `<div class="tk-row ${lv}">
    <span class="tk-main" data-task-edit="${esc(t.id)}" title="눌러서 고치기">
      <span class="tk-title">${esc(t.title)}</span>
      ${t.note ? `<span class="tk-note">${esc(t.note)}</span>` : ''}
    </span>
    <span class="tk-when">${t.dueDate.slice(5).replace('-', '/')}(${dow})</span>
    <span class="tk-dday ${lv}">${taskDdayText(t)}</span>
    <button class="ghost sm" data-task-done="${esc(t.id)}">제출</button>
  </div>`;
}

/* ------------------------------------------------- 항목·수행 편집창 */

let editingItemId = null;
let editingTaskId = null;

function fillSubjectSelect(sel, chosen) {
  sel.innerHTML = board.subjects.map((s) =>
    `<option value="${esc(s.id)}"${s.id === chosen ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

function openItemEditor(id, presetSubject) {
  if (!board.subjects.length) { alert('먼저 과목을 하나 이상 추가하세요.'); return; }
  editingItemId = id;
  const it = id ? board.items.find((x) => x.id === id) : null;
  $('itemEditTitle').textContent = it ? '항목 수정' : '항목 추가';
  fillSubjectSelect($('itemSubject'), it ? it.subjectId : presetSubject);
  $('itemKind').value = it ? it.kind : '교재';
  $('itemName').value = it ? it.name : '';
  $('itemUnit').value = it ? it.unit : '쪽';
  $('itemTotal').value = it ? it.total : '';
  $('itemStart').value = it ? (it.startDate || '') : todayStr();
  $('itemDue').value = it ? (it.dueDate || '') : '';
  $('itemDelete').hidden = !it;
  $('itemEdit').hidden = false;
  $('itemName').focus();
}

async function saveItemEditor() {
  const name = $('itemName').value.trim();
  const total = Math.round(Number($('itemTotal').value) || 0);
  if (!name) { alert('이름을 입력하세요.'); return; }
  if (total <= 0) { alert('총 분량을 1 이상으로 입력하세요.'); return; }
  const due = $('itemDue').value;
  const start = $('itemStart').value || todayStr();
  if (due && daysBetween(start, due) < 0) { alert('목표일이 시작일보다 빠릅니다.'); return; }

  const old = editingItemId ? board.items.find((x) => x.id === editingItemId) : null;
  const it = {
    id: editingItemId || `pi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    subjectId: $('itemSubject').value,
    kind: $('itemKind').value,
    name,
    unit: $('itemUnit').value,
    total,
    current: old ? Math.min(old.current || 0, total) : 0,
    startDate: start,
    dueDate: due,
    history: old ? (old.history || []) : [],
  };
  await apiSaveProgressItem(it);
  if (old) Object.assign(old, it); else board.items.push(it);
  $('itemEdit').hidden = true;
  renderProgress();
}

function openTaskEditor(id) {
  if (!board.subjects.length) { alert('먼저 과목을 하나 이상 추가하세요.'); return; }
  editingTaskId = id;
  const t = id ? board.tasks.find((x) => x.id === id) : null;
  $('taskEditTitle').textContent = t ? '수행 수정' : '수행 추가';
  fillSubjectSelect($('taskSubject'), t ? t.subjectId : undefined);
  $('taskTitle').value = t ? t.title : '';
  $('taskNote').value = t ? (t.note || '') : '';
  $('taskDue').value = t ? t.dueDate : '';
  $('taskDelete').hidden = !t;
  $('taskEdit').hidden = false;
  $('taskTitle').focus();
}

async function saveTaskEditor() {
  const title = $('taskTitle').value.trim();
  const due = $('taskDue').value;
  if (!title) { alert('제목을 입력하세요.'); return; }
  if (!due) { alert('제출 기한을 입력하세요.'); return; }

  const old = editingTaskId ? board.tasks.find((x) => x.id === editingTaskId) : null;
  const t = {
    id: editingTaskId || `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    subjectId: $('taskSubject').value,
    title,
    note: $('taskNote').value.trim(),
    dueDate: due,
    done: old ? !!old.done : false,
    doneDate: old ? (old.doneDate || '') : '',
  };
  await apiSaveTask(t);
  if (old) Object.assign(old, t); else board.tasks.push(t);
  $('taskEdit').hidden = true;
  renderTasks();
}

function miniWheel(d) {
  let s = '<svg viewBox="0 0 400 400">';
  s += `<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="var(--card-soft)"/>`;
  for (const b of d.plan) s += segShape(b, 0, R_OUT, act(b.activity).color, 0.42);
  for (const b of d.actual) s += segShape(b, 44, R_ACTUAL_OUT, act(b.activity).color, 1);
  s += `<circle cx="${CX}" cy="${CY}" r="${R_ACTUAL_OUT}" fill="none" stroke="var(--card)" stroke-width="2.5"/>`;
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

  // 상단 탭
  document.querySelectorAll('.app-tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  // 과목 관리 (진도판·수행평가 공용)
  $('progressManageSubjects').onclick = openSubjectManager;
  $('taskManageSubjects').onclick = openSubjectManager;
  $('subjClose').onclick = () => { $('subjEdit').hidden = true; };
  $('subjAddForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('subjAddName').value.trim();
    if (!name) return;
    board.subjects.push({
      id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name, color: $('subjAddColor').value,
    });
    await apiSaveSubjects(board.subjects);
    $('subjAddName').value = '';
    renderSubjectManager(); renderProgress(); renderTasks();
  };

  // 학습진도 현황판
  $('itemCancel').onclick = () => { $('itemEdit').hidden = true; };
  $('itemSave').onclick = saveItemEditor;
  $('itemDelete').onclick = async () => {
    if (!editingItemId || !confirm('이 항목을 지울까요?\n기록한 진도도 함께 사라집니다.')) return;
    await apiDeleteProgressItem(editingItemId);
    board.items = board.items.filter((x) => x.id !== editingItemId);
    $('itemEdit').hidden = true;
    renderProgress();
  };

  // 수행평가
  $('taskAddBtn').onclick = () => openTaskEditor(null);
  $('taskCancel').onclick = () => { $('taskEdit').hidden = true; };
  $('taskSave').onclick = saveTaskEditor;
  $('taskDelete').onclick = async () => {
    if (!editingTaskId || !confirm('이 수행을 지울까요?')) return;
    await apiDeleteTask(editingTaskId);
    board.tasks = board.tasks.filter((x) => x.id !== editingTaskId);
    $('taskEdit').hidden = true;
    renderTasks();
  };
  document.querySelectorAll('.tk-sort').forEach((b) => {
    b.onclick = () => {
      board.taskSort = b.dataset.sort;
      document.querySelectorAll('.tk-sort').forEach((x) => x.classList.toggle('is-on', x === b));
      renderTasks();
    };
  });

  // 주간 일정표
  $('scheduleAddWeek').onclick = addNewScheduleWeek;

  // 단축키 — ⌘(macOS) / Ctrl(Windows·Linux) 양쪽 모두 동작한다
  $('saveBtn').title = `지금 저장 (${MOD}S)`;
  $('undoBtn').title = `되돌리기 (${MOD}Z)`;
  $('weekBtn').title = `이번 주 7일을 한 화면에서 비교 (${MOD}W)`;
  $('prevDay').title = '어제 (←)';
  $('nextDay').title = '내일 (→)';

  document.addEventListener('keydown', (e) => {
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const dayTabActive = !$('panelDay').hidden;
    const weekOpen = !$('weekView').hidden;
    const editOpen = !$('editAct').hidden;
    const manageOpen = !$('manageAct').hidden;
    const boardPops = ['subjEdit', 'itemEdit', 'taskEdit'].filter((id) => !$(id).hidden);
    const mod = e.metaKey || e.ctrlKey;
    const key = (e.key || '').toLowerCase();

    if (key === 'escape' && boardPops.length) {
      e.preventDefault();
      boardPops.forEach((id) => { $(id).hidden = true; });
      return;
    }
    if (key === 'escape' && editOpen) { e.preventDefault(); closeActivityEditor(); return; }
    if (key === 'escape' && manageOpen) { e.preventDefault(); closeActivityManager(); return; }
    if (key === 'escape' && weekOpen) { e.preventDefault(); closeWeek(); return; }
    if (editOpen || manageOpen || boardPops.length || (!dayTabActive && typing)) return;

    if (mod && key === 's') { e.preventDefault(); saveNow(); return; }
    if (mod && key === 'z' && !typing && dayTabActive && !weekOpen) { e.preventDefault(); undo(); return; }
    if (mod && key === 'w' && (dayTabActive || weekOpen)) {   // 브라우저 탭 닫기는 막지 못할 수 있다
      e.preventDefault();
      weekOpen ? closeWeek() : openWeek();
      return;
    }
    if (!dayTabActive || typing || mod || e.altKey) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      weekOpen ? openWeek(shiftDate(week.start, -7)) : load(shiftDate(state.date, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      weekOpen ? openWeek(shiftDate(week.start, 7)) : load(shiftDate(state.date, 1));
    }
  });

  await load(todayStr());

  // 수행평가는 다른 탭에 있어도 탭 배지로 알려야 하므로 시작할 때 한 번 읽는다.
  // (진도판은 그 탭에 들어갈 때 읽어도 늦지 않다.)
  loadSubjects()
    .then(() => apiListTasks())
    .then((list) => { board.tasks = list; refreshTaskBadge(); })
    .catch(() => {});

  setInterval(() => { if (state.date === todayStr()) renderWheel('actual'); }, 60000);
}

init();
