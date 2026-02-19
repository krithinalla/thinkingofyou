import { db } from './firebase-config.js';
import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Exact color palette from design swatches ──────────────────
// Each period: [highlight (top-left), shadow (bottom-right)]
//
// Morning   6–11   golden yellow   #FFEF96 → #D39D0B
// Late morn 11–13  warm peach-gold #FFA071 → #FFF788  (or use sunrise orange-yellow)
// Afternoon 13–17  burnt orange    #FF7231 → #8A3809
// Sunset    17–20  orange-yellow   #FFA071 → #FFF788
// Dusk      20–22  purple-lilac    #3807B4 → #FFF1AA
// Night     22–6   deep blue       #1075FA → #1D115D
// Blue-day  alt    sky blue        #528EFF → #FFDC7D
// Deep night alt   navy-periwinkle #96E3FF → #313F85

function bubbleGradientFromTimestamp(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date();
  const h = date.getHours();

  if (h >= 6 && h < 11) {
    // Morning — golden yellow
    return `radial-gradient(circle at 38% 30%, #FFEF96, #D39D0B 85%)`;
  } else if (h >= 11 && h < 14) {
    // Late morning / midday — warm peach into yellow
    return `radial-gradient(circle at 38% 30%, #FFA071, #FFF788 85%)`;
  } else if (h >= 14 && h < 18) {
    // Afternoon — burnt orange
    return `radial-gradient(circle at 38% 30%, #FF7231, #8A3809 85%)`;
  } else if (h >= 18 && h < 21) {
    // Sunset — orange fading to yellow
    return `radial-gradient(circle at 38% 30%, #FFA071, #FFF788 85%)`;
  } else if (h >= 21 && h < 23) {
    // Dusk — purple into gold
    return `radial-gradient(circle at 38% 30%, #3807B4, #FFF1AA 85%)`;
  } else {
    // Night (23–6) — deep blue
    return `radial-gradient(circle at 38% 30%, #1075FA, #1D115D 85%)`;
  }
}

function timeLabel(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date();
  const h = date.getHours();
  if (h >= 6 && h < 11)  return 'morning';
  if (h >= 11 && h < 14) return 'midday';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 21) return 'sunset';
  if (h >= 21 && h < 23) return 'dusk';
  return 'night';
}

// ── Tooltip singleton ─────────────────────────────────────────
const tooltip = document.createElement('div');
tooltip.className = 'bubble-tooltip';
document.body.appendChild(tooltip);

function showTooltip(e, text) {
  tooltip.textContent = text;
  tooltip.classList.add('visible');
  moveTooltip(e);
}
function moveTooltip(e) {
  tooltip.style.left = (e.clientX + 14) + 'px';
  tooltip.style.top  = (e.clientY - 28) + 'px';
}
function hideTooltip() {
  tooltip.classList.remove('visible');
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

    const date = b.ts?.toDate ? b.ts.toDate() : new Date();
    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const label   = timeLabel(b.ts);
    const tooltipText = `${timeStr} · ${dateStr} · ${label}`;

    div.addEventListener('mouseenter', (e) => showTooltip(e, tooltipText));
    div.addEventListener('mousemove',  (e) => moveTooltip(e));
    div.addEventListener('mouseleave', hideTooltip);

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
    document.getElementById('sidePanelOverlay').classList.remove('hidden');
  });
  document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('sidePanelOverlay').classList.add('hidden');
  });
  document.getElementById('recordBtn').addEventListener('click', recordThought);
  document.getElementById('addThoughtBtn').addEventListener('click', recordThought);
  document.getElementById('sidePanelOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sidePanelOverlay')) {
      document.getElementById('sidePanelOverlay').classList.add('hidden');
    }
  });
}
