// ═══════════════════════════════════════
//  TRADER OS · notifications.js
//  Sistema de notificações push + alertas
//  em tempo real de drawdown e metas
// ═══════════════════════════════════════

import { getActiveAccount, getConfig, getTrades, getGoals } from './db.js';
import { createAlert } from './cloud-v3.js';

// ── PWA Push Notifications ─────────────
export async function requestPushPermission() {
  if (!('Notification' in window)) {
    return { granted: false, reason: 'Navegador não suporta notificações' };
  }
  if (Notification.permission === 'granted') return { granted: true };
  if (Notification.permission === 'denied') {
    return { granted: false, reason: 'Permissão negada. Reative nas configurações do navegador.' };
  }
  const permission = await Notification.requestPermission();
  return { granted: permission === 'granted' };
}

export function sendLocalNotification(title, body, opts = {}) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:  '/assets/icon-192.png',
    badge: '/assets/icon-72.png',
    tag:   opts.tag || 'trader-os',
    requireInteraction: opts.urgent || false,
    ...opts,
  });
  n.onclick = () => { window.focus(); n.close(); };
  return n;
}

// ── Service Worker para notificações PWA ──
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('[SW] Registrado:', reg.scope);
    return reg;
  } catch (e) {
    console.warn('[SW] Falha ao registrar:', e.message);
    return null;
  }
}

// ── Motor de alertas de trading ────────
export class TradingAlerts {
  constructor() {
    this._lastAlerts = new Set();
    this._checkInterval = null;
  }

  start(intervalMs = 60_000) {
    this.check(); // imediato
    this._checkInterval = setInterval(() => this.check(), intervalMs);
  }

  stop() {
    clearInterval(this._checkInterval);
    this._checkInterval = null;
  }

  async check() {
    const acct   = getActiveAccount();
    const config = getConfig();
    const trades = getTrades();
    const goals  = getGoals();
    if (!acct || !config) return;

    const today    = new Date().toISOString().slice(0, 10);
    const todayTrades = trades.filter(t => t.date === today);
    const todayPnL    = todayTrades.reduce((a, t) => a + t.pnl, 0);
    const totalPnL    = trades.reduce((a, t) => a + t.pnl, 0);
    const cap         = acct.capital || 10000;

    const alerts = [];

    // ── Limite de perda diária ──────────
    if (config.maxDailyLoss && todayPnL < 0) {
      const used = Math.abs(todayPnL) / config.maxDailyLoss;
      if (used >= 1.0  && !this._fired('daily_loss_100')) {
        alerts.push({ type: 'daily_loss', key: 'daily_loss_100', urgent: true,
          title: '🚨 Limite Diário Atingido',
          body:  `Perda de R$${Math.abs(todayPnL).toFixed(2)} — PARE de operar hoje.` });
      } else if (used >= 0.75 && !this._fired('daily_loss_75')) {
        alerts.push({ type: 'daily_loss', key: 'daily_loss_75', urgent: false,
          title: '⚠️ Atenção: Limite Diário',
          body:  `Você usou ${(used*100).toFixed(0)}% do limite diário (${fmt(todayPnL)}).` });
      }
    }

    // ── Drawdown total ──────────────────
    if (config.maxTotalLoss && totalPnL < 0) {
      const used = Math.abs(totalPnL) / config.maxTotalLoss;
      if (used >= 1.0 && !this._fired('total_loss_100')) {
        alerts.push({ type: 'total_loss', key: 'total_loss_100', urgent: true,
          title: '🚨 Conta Violada',
          body:  `Drawdown máximo atingido. Conta encerrada.` });
      } else if (used >= 0.80 && !this._fired('total_loss_80')) {
        alerts.push({ type: 'total_loss', key: 'total_loss_80', urgent: true,
          title: '⚠️ Drawdown Crítico',
          body:  `${(used*100).toFixed(0)}% do limite total consumido.` });
      }
    }

    // ── Meta mensal atingida ────────────
    const monthTrades = trades.filter(t => {
      const d = new Date(t.date + 'T12:00:00');
      const n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    });
    const monthPnL = monthTrades.reduce((a, t) => a + t.pnl, 0);
    if (goals.goalMonth && monthPnL >= goals.goalMonth && !this._fired('goal_month')) {
      alerts.push({ type: 'goal_reached', key: 'goal_month', urgent: false,
        title: '🎯 Meta Mensal Atingida!',
        body:  `Parabéns! R$${monthPnL.toFixed(2)} de R$${goals.goalMonth}.` });
    }

    // ── Sequência positiva ──────────────
    const sorted = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].pnl > 0) streak++;
      else break;
    }
    if (streak >= 5 && !this._fired('streak_5')) {
      alerts.push({ type: 'streak', key: 'streak_5', urgent: false,
        title: '🔥 Sequência de 5 Ganhos!',
        body:  'Você está em uma sequência incrível. Mantenha o foco!' });
    }

    // Dispara alertas
    for (const alert of alerts) {
      this._lastAlerts.add(alert.key);
      sendLocalNotification(alert.title, alert.body, { tag: alert.key, urgent: alert.urgent });

      // Salva no banco para exibição no app
      try {
        await createAlert(acct.id, alert.type, alert.body);
      } catch { /* offline — ignora */ }

      // Exibe banner no app
      this._showInAppBanner(alert);
    }
  }

  _fired(key) { return this._lastAlerts.has(key); }

  _showInAppBanner(alert) {
    const container = document.getElementById('dash-alerts');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `banner ${alert.urgent ? 'danger' : 'warning'}`;
    div.innerHTML = `
      <strong>${alert.title}</strong>
      <span style="font-size:12px;margin-left:8px">${alert.body}</span>
      <button class="banner-close" onclick="this.closest('.banner').remove()">✕</button>
    `;
    container.prepend(div);
  }

  // Reset diário (chame à meia-noite)
  resetDaily() {
    ['daily_loss_100','daily_loss_75'].forEach(k => this._lastAlerts.delete(k));
  }
}

// ── Notificações In-App ────────────────
export function initNotificationBell() {
  const bell = document.getElementById('notif-bell');
  if (!bell) return;

  async function refresh() {
    const { loadAlerts } = await import('./cloud-v3.js');
    const alerts = await loadAlerts(true).catch(() => []);
    const count  = alerts.length;
    const dot    = document.getElementById('notif-dot');
    const panel  = document.getElementById('notif-panel');

    if (dot) { dot.style.display = count > 0 ? 'block' : 'none'; }

    if (panel) {
      panel.innerHTML = count === 0
        ? '<p style="padding:16px;color:var(--text-3);font-size:13px;text-align:center">Nenhuma notificação nova</p>'
        : alerts.map(a => `
          <div class="notif-item" data-id="${a.id}">
            <div class="notif-icon">${iconFor(a.type)}</div>
            <div class="notif-body">
              <div class="notif-msg">${a.message}</div>
              <div class="notif-time">${timeAgo(a.created_at)}</div>
            </div>
            <button class="notif-mark" data-id="${a.id}" title="Marcar como lida">✓</button>
          </div>
        `).join('');

      panel.querySelectorAll('.notif-mark').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const { markAlertRead } = await import('./cloud-v3.js');
          await markAlertRead(btn.dataset.id);
          btn.closest('.notif-item').style.opacity = '0.4';
          setTimeout(refresh, 500);
        });
      });
    }
  }

  bell.addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = !panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden', isOpen);
    if (!isOpen) refresh();
  });

  // Recarrega a cada 2 minutos
  refresh();
  setInterval(refresh, 120_000);
}

function iconFor(type) {
  const icons = {
    daily_loss:  '📉', total_loss: '🚨',
    goal_reached:'🎯', streak:     '🔥',
  };
  return icons[type] || '🔔';
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h/24)}d atrás`;
}

function fmt(v) { return (v >= 0 ? '+' : '') + 'R$' + Math.abs(v).toFixed(2); }

// ── Service Worker (sw.js) ─────────────
export const SERVICE_WORKER_CODE = `
// TRADER OS · sw.js
// Salve este conteúdo em /sw.js (raiz do projeto)

const CACHE  = 'trader-os-v3';
const ASSETS = ['/', '/index.html', '/css/design-system.css', '/css/layout.css', '/css/components.css', '/css/pages.css', '/js/app.js'];

self.addEventListener('install',  e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co') || e.request.url.includes('stripe.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(self.registration.showNotification(data.title || 'Trader OS', {
    body:  data.body || '',
    icon:  '/assets/icon-192.png',
    badge: '/assets/icon-72.png',
    tag:   data.tag || 'trader-os',
    requireInteraction: data.urgent || false,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
`;
