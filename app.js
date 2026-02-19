import { db } from './firebase-config.js';
import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Time period lookup (matches swatch chart exactly) ────────
//   3am–8am   → burnt orange      #FF7231 → #8A3809
//   8am–11am  → golden yellow     #FFEF96 → #D39D0B
//   11am–2pm  → sky blue + gold   #528EFF → #FFDC7D
//   2pm–6pm   → periwinkle blue   #96E3FF → #313F85
//   6pm–8pm   → deep royal blue   #1075FA → #1D115D
//   8pm–11pm  → purple + cream    #3807B4 → #FFF1AA
//   11pm–3am  → peach + yellow    #FFA071 → #FFF788

function getPeriod(h) {
  if (h >= 3  && h < 8)  return 'early-morning'; // 3am–8am
  if (h >= 8  && h < 11) return 'morning';        // 8am–11am (golden)
  if (h >= 11 && h < 14) return 'midday';         // 11am–2pm (sky blue)
  if (h >= 14 && h < 18) return 'afternoon';      // 2pm–6pm  (periwinkle)
  if (h >= 18 && h < 20) return 'evening';        // 6pm–8pm  (royal blue)
  if (h >= 20 && h < 23) return 'dusk';           // 8pm–11pm (purple)
  return 'night';                                  // 11pm–3am (peach-yellow)
}

// ── Bubble gradient — exact swatches ─────────────────────────
function bubbleGradientFromTimestamp(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date();
  const period = getPeriod(date.getHours());

  const gradients = {
    'early-morning': 'radial-gradient(circle at 38% 30%, #FF7231, #8A3809 85%)',   // burnt orange
    'morning':       'radial-gradient(circle at 38% 30%, #FFEF96, #D39D0B 85%)',   // golden yellow
    'midday':        'radial-gradient(circle at 38% 30%, #528EFF, #FFDC7D 85%)',   // sky blue → gold
    'afternoon':     'radial-gradient(circle at 38% 30%, #96E3FF, #313F85 85%)',   // periwinkle
    'evening':       'radial-gradient(circle at 38% 30%, #1075FA, #1D115D 85%)',   // deep royal blue
    'dusk':          'radial-gradient(circle at 38% 30%, #3807B4, #FFF1AA 85%)',   // purple → cream
    'night':         'radial-gradient(circle at 38% 30%, #FFA071, #FFF788 85%)',   // peach → yellow
  };
  return gradients[period];
}

// ── Sky overlay gradient — pastel/light version of the sky ────
// Deliberately lighter & softer so the UI stays usable
function skyGradientNow() {
  const period = getPeriod(new Date().getHours());

  const skies = {
    'early-morning': 'linear-gradient(180deg, #f5ddd0 0%, #f9e8d8 40%, #fce9d4 70%, #fdf0e0 100%)',
    'morning':       'linear-gradient(180deg, #e8f4ff 0%, #f4f8ff 35%, #fffbe8 65%, #fff8d0 100%)',
    'midday':        'linear-gradient(180deg, #d0e8ff 0%, #daeffe 35%, #eaf5ff 65%, #f5faff 100%)',
    'afternoon':     'linear-gradient(180deg, #d8e8f8 0%, #e0eef8 35%, #eef5fc 65%, #f4f8fe 100%)',
    'evening':       'linear-gradient(180deg, #d0d8f0 0%, #dae0f5 30%, #e8eeff 55%, #f0f4ff 80%, #f8f8ff 100%)',
    'dusk':          'linear-gradient(180deg, #e8d8f0 0%, #f0dff5 30%, #f5e8fa 55%, #faeeff 75%, #fdf5ff 100%)',
    'night':         'linear-gradient(180deg, #f0ddd8 0%, #f5e4e0 35%, #faeee8 60%, #fdf3ef 80%, #fff8f5 100%)',
  };
  return skies[period];
}

// ── In-bubble time label ──────────────────────────────────────
// Each bubble gets a .bubble-time child. On mouseenter we add
// .showing which triggers the CSS keyframe (fade in → hold → fade out).
function attachTimeLabel(bubbleEl, timeStr) {
  const overlay = document.createElement('div');
  overlay.className = 'bubble-time';
  const span = document.createElement('span');
  span.textContent = timeStr;
  overlay.appendChild(span);
  bubbleEl.appendChild(overlay);

  let fadeTimer = null;

  bubbleEl.addEventListener('mouseenter', () => {
    overlay.classList.remove('showing');
    void overlay.offsetWidth; // force reflow
    overlay.classList.add('showing');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => overlay.classList.remove('showing'), 1400);
  });
}

// ── Bubble sizing — varied for organic feel ───────────────────
const SIZES = [92, 112, 76, 130, 88, 106, 118, 80, 100, 96, 122, 84];
function sizeForIndex(i) { return SIZES[i % SIZES.length]; }

// ── Non-overlapping circle packing ───────────────────────────
// For each bubble, scan outward in concentric rings, sampling
// many angles per ring until a gap-free position is found.
// This guarantees no overlaps regardless of bubble count/size.
function layoutBubbles(bubbles, containerW, containerH) {
  if (!bubbles.length) return [];

  const cx = containerW / 2;
  const cy = containerH / 2 - 10;
  const placed = []; // { cx, cy, r }

  return bubbles.map((b) => {
    const r = b.size / 2;

    if (placed.length === 0) {
      placed.push({ cx, cy, r });
      return { ...b, x: cx - r, y: cy - r, cx, cy };
    }

    // Scan rings starting from a radius that could touch the nearest bubble.
    // Step outward by 2px per ring; sample 360 angles per ring.
    const minStartRadius = r + 6; // at least gap from center
    let found = null;

    for (let ring = minStartRadius; ring <= 800 && !found; ring += 2) {
      const angleSteps = Math.max(36, Math.ceil(2 * Math.PI * ring / 4)); // ~4px arc steps
      for (let a = 0; a < angleSteps && !found; a++) {
        const angle = (a / angleSteps) * 2 * Math.PI;
        const px = cx + Math.cos(angle) * ring;
        const py = cy + Math.sin(angle) * ring;

        const overlaps = placed.some(p => {
          const dx = px - p.cx;
          const dy = py - p.cy;
          return Math.sqrt(dx * dx + dy * dy) < r + p.r + 6; // 6px gap
        });

        if (!overlaps) {
          found = { px, py };
        }
      }
    }

    const px = found ? found.px : cx + (placed.length * 10);
    const py = found ? found.py : cy + (placed.length * 10);
    placed.push({ cx: px, cy: py, r });
    return { ...b, x: px - r, y: py - r, cx: px, cy: py };
  });
}

// ── Incremental bubble renderer ───────────────────────────────
// Tracks which bubble IDs are already in the DOM. On each
// Firestore update it only adds NEW bubbles (with pop-in
// animation) and moves existing ones smoothly if layout shifts.
// Structure: .bubble-anchor (positioned) > .bubble (visual + float anim)
// Separating position from animation avoids transform conflicts.
const renderedIds = {}; // { containerId → Set<id> }

function renderBubbles(bubbleData, containerId, containerW, containerH) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const laid = layoutBubbles(bubbleData, containerW, containerH);

  if (!renderedIds[containerId]) renderedIds[containerId] = new Set();
  const known = renderedIds[containerId];

  // Remove any bubbles that are no longer in the data
  const currentIds = new Set(bubbleData.map(b => b.id));
  el.querySelectorAll('.bubble-anchor[data-id]').forEach(node => {
    if (!currentIds.has(node.dataset.id)) {
      node.remove();
      known.delete(node.dataset.id);
    }
  });

  laid.forEach((b) => {
    const existing = el.querySelector(`.bubble-anchor[data-id="${b.id}"]`);

    if (existing) {
      // Smoothly reposition if layout changed (e.g. panel resize)
      existing.style.left   = `${b.x}px`;
      existing.style.top    = `${b.y}px`;
      existing.style.width  = `${b.size}px`;
      existing.style.height = `${b.size}px`;
      // Update inner bubble gradient too
      const inner = existing.querySelector('.bubble');
      if (inner) inner.style.background = b.gradient;
    } else {
      // Brand-new bubble — outer anchor handles position, inner bubble animates
      const anchor = document.createElement('div');
      anchor.className  = 'bubble-anchor';
      anchor.dataset.id = b.id;
      anchor.style.cssText = `
        left:   ${b.x}px;
        top:    ${b.y}px;
        width:  ${b.size}px;
        height: ${b.size}px;
      `;

      const inner = document.createElement('div');
      inner.className = 'bubble';
      // Vary float delay per index so bubbles drift independently
      const floatDelay = ((b.index % 7) * 0.65).toFixed(2);
      inner.style.cssText = `
        background:    ${b.gradient};
        --float-delay: ${floatDelay}s;
      `;

      const date    = b.ts?.toDate ? b.ts.toDate() : new Date();
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      attachTimeLabel(inner, timeStr);

      anchor.appendChild(inner);
      el.appendChild(anchor);
      known.add(b.id);
    }
  });
}

// ── Draggable panel resizer ───────────────────────────────────
function initResizer() {
  const divider  = document.getElementById('panelDivider');
  const screen2  = document.querySelector('.screen-2');
  if (!divider || !screen2) return;

  const panelLeft = screen2.querySelector('.panel-left');
  if (!panelLeft) return;

  let dragging = false;

  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const containerRect = screen2.getBoundingClientRect();
    const mouseOffset   = e.clientX - containerRect.left;
    let pct = (mouseOffset / containerRect.width) * 100;
    pct = Math.min(75, Math.max(25, pct));
    panelLeft.style.setProperty('--left-w', pct + '%');
  });

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
  }

  document.addEventListener('mouseup',    stopDrag);
  document.addEventListener('mouseleave', stopDrag);
}

// ── Main init — called by each page with its identity ────────
export function initApp({ me, them, myKey }) {
  // Auth guard
  const params = new URLSearchParams(window.location.search);
  if (params.get('key') !== myKey) {
    document.getElementById('accessDenied').classList.remove('hidden');
    return;
  }
  document.getElementById('app').classList.remove('hidden');

  const myCol    = collection(db, 'thoughts', me,   'taps');
  const theirCol = collection(db, 'thoughts', them, 'taps');

  // ── Live listeners ────────────────────────────────────────
  onSnapshot(query(theirCol, orderBy('ts', 'asc')), (snap) => {
    const bubbles = snap.docs.map((d, i) => ({
      id: d.id, ts: d.data().ts, index: i,
      size: sizeForIndex(i),
      gradient: bubbleGradientFromTimestamp(d.data().ts),
    }));
    renderBubbles(bubbles, 'theirBubbleField',     900, 680);
    renderBubbles(bubbles, 'theirBubbleFieldLeft', 580, 680);
  });

  onSnapshot(query(myCol, orderBy('ts', 'asc')), (snap) => {
    const bubbles = snap.docs.map((d, i) => ({
      id: d.id, ts: d.data().ts, index: i,
      size: sizeForIndex(i),
      gradient: bubbleGradientFromTimestamp(d.data().ts),
    }));
    renderBubbles(bubbles, 'myBubbleField', 540, 560);
  });

  // ── Record a thought ──────────────────────────────────────
  async function recordThought() {
    const btn = document.getElementById('recordBtn');
    btn.disabled = true;
    btn.innerHTML = `♥ sent`;
    try {
      await addDoc(myCol, { ts: serverTimestamp() });
    } catch(e) { console.error(e); }
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><line x1="5.5" y1="1" x2="5.5" y2="10" stroke="#888" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="5.5" x2="10" y2="5.5" stroke="#888" stroke-width="1.5" stroke-linecap="round"/></svg> Thinking of you right now`;
    }, 2000);
  }

  // ── UI wiring ─────────────────────────────────────────────
  function openPanel() {
    const overlay = document.getElementById('sidePanelOverlay');
    // Ensure it's in the flow (remove hidden) then on next frame fade in
    overlay.classList.remove('hidden');
    overlay.style.background = skyGradientNow();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });
  }

  function closePanel() {
    const overlay = document.getElementById('sidePanelOverlay');
    // Fade out — visibility+opacity both transition (defined in CSS)
    overlay.classList.remove('visible');
    // After transition completes, fully remove from layout
    setTimeout(() => overlay.classList.add('hidden'), 460);
  }

  document.getElementById('openPanelBtn').addEventListener('click', openPanel);
  document.getElementById('closePanelBtn').addEventListener('click', closePanel);
  document.getElementById('recordBtn').addEventListener('click', recordThought);
  document.getElementById('sidePanelOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sidePanelOverlay')) closePanel();
  });

  initResizer();
}
