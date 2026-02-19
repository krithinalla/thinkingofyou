import { db } from './firebase-config.js';
import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Time period lookup (matches swatch chart exactly) ────────
//   3am–5am   → burnt orange      #FF7231 → #8A3809
//   8am–10am  → golden yellow     #FFEF96 → #D39D0B
//   11am–1pm  → sky blue + gold   #528EFF → #FFDC7D
//   2pm–5pm   → periwinkle blue   #96E3FF → #313F85
//   6pm–7pm   → deep royal blue   #1075FA → #1D115D
//   8pm–10pm  → purple + cream    #3807B4 → #FFF1AA
//   11pm–2am  → peach + yellow    #FFA071 → #FFF788

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

// ── Sky overlay gradient — evokes the actual sky at that time ─
function skyGradientNow() {
  const period = getPeriod(new Date().getHours());

  const skies = {
    'early-morning': 'linear-gradient(180deg, #0a0510 0%, #2a0e1a 30%, #8a3020 55%, #c86030 75%, #e8a060 100%)',
    'morning':       'linear-gradient(180deg, #c8e8f8 0%, #e8f4ff 35%, #fff0c0 65%, #ffe080 100%)',
    'midday':        'linear-gradient(180deg, #1a6abf 0%, #3a8fd1 30%, #74b9f5 60%, #c8e4ff 100%)',
    'afternoon':     'linear-gradient(180deg, #1a4a90 0%, #3070b8 35%, #80b8e8 65%, #c0dcf8 100%)',
    'evening':       'linear-gradient(180deg, #080f38 0%, #1030a0 30%, #2850d0 55%, #6090e8 80%, #90b8f8 100%)',
    'dusk':          'linear-gradient(180deg, #04060f 0%, #0d0830 30%, #280850 55%, #580878 75%, #9840a8 100%)',
    'night':         'linear-gradient(180deg, #010208 0%, #04082a 35%, #180830 60%, #401840 80%, #a04828 100%)',
  };
  return skies[period];
}

function timeLabel(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date();
  return getPeriod(date.getHours()).replace('-', ' ');
}

// ── In-bubble time label ──────────────────────────────────────
// Each bubble gets a .bubble-time child. On mouseenter we add
// .showing which triggers the CSS keyframe (fade in → hold → fade out).
// We cancel any in-flight animation first so re-hovering restarts it.
function attachTimeLabel(bubbleEl, timeStr) {
  const overlay = document.createElement('div');
  overlay.className = 'bubble-time';
  const span = document.createElement('span');
  span.textContent = timeStr;
  overlay.appendChild(span);
  bubbleEl.appendChild(overlay);

  let fadeTimer = null;

  bubbleEl.addEventListener('mouseenter', () => {
    // Restart animation cleanly
    overlay.classList.remove('showing');
    // Force reflow so removing+adding the class triggers a fresh animation
    void overlay.offsetWidth;
    overlay.classList.add('showing');

    // Auto-remove class after animation completes (2.2 s) so it's ready for next hover
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => overlay.classList.remove('showing'), 2200);
  });
}

// ── Bubble sizing — varied for organic feel ───────────────────
const SIZES = [92, 112, 76, 130, 88, 106, 118, 80, 100, 96, 122, 84];
function sizeForIndex(i) { return SIZES[i % SIZES.length]; }

// ── Phyllotaxis (sunflower) layout — natural packing ─────────
function layoutBubbles(bubbles, containerW, containerH) {
  if (!bubbles.length) return [];
  const cx = containerW / 2;
  const cy = containerH / 2 - 30;
  const GOLDEN_ANGLE = 2.39996; // radians ≈ 137.5°

  return bubbles.map((b, i) => {
    const r = b.size / 2;
    if (i === 0) return { ...b, x: cx - r, y: cy - r };
    const radius = Math.sqrt(i) * b.size * 0.68;
    const angle  = i * GOLDEN_ANGLE;
    return {
      ...b,
      x: cx + Math.cos(angle) * radius - r,
      y: cy + Math.sin(angle) * radius - r,
    };
  });
}

// ── Render bubbles ────────────────────────────────────────────
function renderBubbles(bubbleData, containerId, containerW, containerH) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';

  const laid = layoutBubbles(bubbleData, containerW, containerH);
  laid.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'bubble';
    div.style.cssText = `
      left:   ${b.x}px;
      top:    ${b.y}px;
      width:  ${b.size}px;
      height: ${b.size}px;
      background: ${b.gradient};
    `;

    // Format: "5:03 PM" on first line — clean and minimal like the reference
    const date    = b.ts?.toDate ? b.ts.toDate() : new Date();
    const timeStr = date.toLocaleTimeString('en-US', {
      hour:   'numeric',
      minute: '2-digit',
      hour12: true,
    });

    attachTimeLabel(div, timeStr);
    el.appendChild(div);
  });
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
      id: d.id, ts: d.data().ts,
      size: sizeForIndex(i),
      gradient: bubbleGradientFromTimestamp(d.data().ts),
    }));
    renderBubbles(bubbles, 'theirBubbleField',     900, 680);
    renderBubbles(bubbles, 'theirBubbleFieldLeft', 580, 680);
  });

  onSnapshot(query(myCol, orderBy('ts', 'asc')), (snap) => {
    const bubbles = snap.docs.map((d, i) => ({
      id: d.id, ts: d.data().ts,
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
      btn.innerHTML = `<svg width="11" height="10" viewBox="0 0 11 10" fill="none"><path d="M5.5 9S1 6.12 1 3.25a2.75 2.75 0 0 1 4.5-2.1A2.75 2.75 0 0 1 10 3.25C10 6.12 5.5 9 5.5 9Z" fill="#888"/></svg> Thinking of you right now`;
    }, 2000);
  }

  // ── UI wiring ─────────────────────────────────────────────
  document.getElementById('openPanelBtn').addEventListener('click', () => {
    const overlay = document.getElementById('sidePanelOverlay');
    // Set sky gradient for the current time of day
    overlay.style.background = skyGradientNow();
    overlay.classList.remove('hidden');
  });
  document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('sidePanelOverlay').classList.add('hidden');
  });
  document.getElementById('recordBtn').addEventListener('click', recordThought);
  document.getElementById('sidePanelOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sidePanelOverlay')) {
      document.getElementById('sidePanelOverlay').classList.add('hidden');
    }
  });
}
