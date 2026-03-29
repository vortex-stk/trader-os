// ═══════════════════════════════════════
//  TRADER OS · ui/components.js
//  Toast, modal, loading, eventos globais
// ═══════════════════════════════════════

// ── Toast ─────────────────────────────
const toastContainer = () => document.getElementById('toast-container');

export function showToast(message, type = 'info', duration = 3500) {
  const container = toastContainer();
  if (!container) return;

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ── Modal ─────────────────────────────
export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.removeAttribute('hidden');
  el.setAttribute('aria-modal', 'true');
  document.body.style.overflow = 'hidden';

  // Foca o primeiro elemento focável
  setTimeout(() => {
    const focusable = el.querySelector('input, select, textarea, button:not(.modal-close)');
    if (focusable) focusable.focus();
  }, 100);
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

// Fecha modal ao clicar no overlay
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }
  // Botões com data-close-modal
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) {
    closeModal(closeBtn.dataset.closeModal);
  }
});

// Fecha modal com Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-overlay:not([hidden])');
    if (open) {
      open.setAttribute('hidden', '');
      document.body.style.overflow = '';
    }
  }
});

// ── Loading ───────────────────────────
export function setLoading(visible, message = 'Carregando...') {
  const overlay = document.getElementById('loading-overlay');
  const text    = document.getElementById('loading-text');
  if (!overlay) return;
  if (visible) {
    overlay.removeAttribute('hidden');
    if (text) text.textContent = message;
  } else {
    overlay.setAttribute('hidden', '');
  }
}

// ── Lightbox ──────────────────────────
export function openLightbox(src) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lb || !img) return;
  img.src = src;
  lb.removeAttribute('hidden');
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') {
    const lb = document.getElementById('lightbox');
    if (lb) lb.setAttribute('hidden', '');
  }
});

// ── Dropdown genérico ──────────────────
export function toggleDropdown(triggerId, menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isHidden = menu.hasAttribute('hidden');
  closeAllDropdowns();
  if (isHidden) menu.removeAttribute('hidden');
}

export function closeAllDropdowns() {
  document.querySelectorAll('.acct-dropdown, .user-menu').forEach(el => {
    el.setAttribute('hidden', '');
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#acct-switcher') && !e.target.closest('#btn-user-menu')) {
    closeAllDropdowns();
  }
});

// ── Sidebar toggle ─────────────────────
export function initSidebar() {
  const btn     = document.getElementById('btn-hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!btn || !sidebar) return;

  btn.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    sidebar.classList.toggle('open', !isOpen);
    overlay.classList.toggle('visible', !isOpen);
    btn.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  });
}

// ── Navegação por data-nav ─────────────
export function initNavigation(navigateFn) {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;
    navigateFn(btn.dataset.nav);
    // Fecha sidebar no mobile após navegar
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('btn-hamburger');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    if (hamburger) { hamburger.classList.remove('open'); hamburger.setAttribute('aria-expanded','false'); }
  });
}

// ── Número formatado ───────────────────
export function fmt$(val, showSign = false) {
  const n = Math.abs(val || 0);
  const str = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (showSign) return (val >= 0 ? '+R$' : '-R$') + str;
  return (val < 0 ? '-R$' : 'R$') + str;
}

export function fmtPct(val) {
  return (val || 0).toFixed(1) + '%';
}

export function fmtR(val) {
  if (val === null || val === undefined) return '—';
  return (val >= 0 ? '+' : '') + val.toFixed(2) + 'R';
}

// ── Color picker ──────────────────────
const PALETTE = ['#00F5A0','#3B9EFF','#FFB547','#FF3D6B','#A78BFA','#FF8C42','#22D3EE','#F472B6'];

export function renderColorPicker(containerId, currentColor, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = PALETTE.map(color => `
    <div class="color-swatch ${color === currentColor ? 'active' : ''}"
      style="background:${color}"
      data-color="${color}"
      role="radio"
      aria-checked="${color === currentColor}"
      aria-label="Cor ${color}"
      tabindex="0">
    </div>
  `).join('');

  container.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    container.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.remove('active');
      s.setAttribute('aria-checked', 'false');
    });
    swatch.classList.add('active');
    swatch.setAttribute('aria-checked', 'true');
    if (onChange) onChange(swatch.dataset.color);
  });
}

// ── Emotion picker ────────────────────
import { EMOTIONS } from '../config.js';

export function renderEmotionGrid(containerId, currentVal, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = EMOTIONS.map(e => `
    <button type="button"
      class="emo-btn ${e.val === currentVal ? 'active' : ''}"
      data-val="${e.val}"
      aria-pressed="${e.val === currentVal}">
      ${e.emoji}<span>${e.label}</span>
    </button>
  `).join('');

  container.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.emo-btn');
    if (!btn) return;
    container.querySelectorAll('.emo-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    if (onChange) onChange(btn.dataset.val);
  });
}

// ── Pair / Session selects ─────────────
import { PAIRS, SESSIONS } from '../config.js';

export function populateSelect(id, options, currentVal = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">—</option>' +
    options.map(o => `<option value="${o}" ${o === currentVal ? 'selected' : ''}>${o}</option>`).join('');
}

export function initTradeFormSelects(currentPair = '', currentSession = '') {
  populateSelect('f-pair',    PAIRS,    currentPair);
  populateSelect('f-session', SESSIONS, currentSession);
}

// ── Screenshot drop zone ───────────────
export function initScreenshotZone(onFile) {
  const zone    = document.getElementById('screenshot-drop');
  const input   = document.getElementById('f-screenshot');
  const preview = document.getElementById('screenshot-preview');
  const label   = document.getElementById('screenshot-label');
  if (!zone || !input) return;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    // Preview local imediato
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (preview) { preview.src = ev.target.result; preview.removeAttribute('hidden'); }
      if (label) label.textContent = file.name;
    };
    reader.readAsDataURL(file);
    if (onFile) onFile(file);
  };

  input.addEventListener('change', () => handleFile(input.files[0]));

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}
