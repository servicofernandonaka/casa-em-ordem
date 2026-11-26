'use strict';

/* =========================================================
   Dados fixos
   ========================================================= */

const ROOMS = [
  ['quarto', '🛏️', 'Quarto'], ['sala', '🛋️', 'Sala'], ['cozinha', '🍳', 'Cozinha'],
  ['banheiro', '🚿', 'Banheiro'], ['lavanderia', '🧺', 'Lavanderia'], ['escritorio', '💻', 'Escritório'],
  ['infantil', '🧸', 'Quarto das crianças'], ['armario', '🚪', 'Armário / guarda-roupa'],
  ['garagem', '🚗', 'Garagem / depósito'], ['outro', '📦', 'Outro'],
];
const TIMES = [['15 minutos', '00:15', '15m'], ['30 minutos', '00:30', '30m'], ['1 hora', '01:00', '1h'], ['2 horas', '02:00', '2h'], ['meio dia', '04:00', '4h']];
const STYLES = [
  ['pratico', 'Prático', 'prático e funcional, fácil de manter no dia a dia', '⚙️', 'Fácil de manter'],
  ['minimalista', 'Mínimo', 'minimalista, com o mínimo de objetos à vista', '◻️', 'Pouco à vista'],
  ['aconchegante', 'Aconchego', 'aconchegante, organizado mas com cara de lar', '🕯️', 'Cara de lar'],
];
const GEMINI_URL = 'https://gemini.google.com/app';

const roomOf = (id) => ROOMS.find((r) => r[0] === id) || ROOMS[ROOMS.length - 1];
const styleOf = (id) => STYLES.find((s) => s[0] === id) || STYLES[0];

/* =========================================================
   Pedidos (prompts) para o Gemini
   ========================================================= */

function planPrompt(a) {
  const [, , room] = roomOf(a.room);
  const notes = a.notes?.trim() ? `\nObservações minhas: ${a.notes.trim()}` : '';
  return `Você é um organizador profissional de casas. Analise a foto anexa.
Ambiente: ${room}. Tempo que tenho para arrumar: ${a.time}. Estilo que quero: ${styleOf(a.style)[2]}.${notes}

Responda em português, EXATAMENTE neste formato, sem tabelas e sem gerar imagem:

DIAGNÓSTICO: (2 ou 3 frases sobre o que mais causa a bagunça)
TAREFAS:
1. [10 min] tarefa curta e concreta, começando com um verbo
2. [5 min] ...
(de 5 a 12 tarefas, na melhor ordem: primeiro lixo e o que não pertence ao ambiente, depois superfícies, depois guardar e organizar, por último limpar. Some no máximo ${a.time}.)
DICA PARA MANTER: (1 frase)`;
}

function imagePrompt(a) {
  const [, , room] = roomOf(a.room);
  return `Agora edite a foto que enviei mostrando este mesmo ambiente (${room.toLowerCase()}) depois de arrumado, seguindo o plano acima, num estilo ${styleOf(a.style)[2]}.
Mantenha exatamente o mesmo ângulo da câmera, a mesma iluminação, paredes, piso, janelas e móveis grandes nos mesmos lugares.
Apenas recolha, guarde, alinhe e organize os objetos que já existem. Não adicione móveis novos nem decoração que não exista.
O resultado deve parecer uma foto real tirada do mesmo lugar.`;
}

/* =========================================================
   Leitura da resposta do Gemini
   ========================================================= */

function parsePlan(raw) {
  const text = raw.replace(/\r/g, '').replace(/\*\*|__|`/g, '').replace(/^\s*#+\s*/gm, '');
  const diagnosis = (text.match(/DIAGN[ÓO]STICO\s*:?\s*([\s\S]*?)(?=\n\s*TAREFAS|\n\s*\d+\s*[.)]|$)/i)?.[1] || '').trim();
  const tip = (text.match(/DICA(?:\s+PARA\s+MANTER)?\s*:?\s*([\s\S]*)$/i)?.[1] || '').trim();

  let body = text;
  const start = body.search(/TAREFAS/i);
  if (start >= 0) body = body.slice(start);
  const end = body.search(/\n\s*DICA/i);
  if (end >= 0) body = body.slice(0, end);

  const tasks = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(?:\d+\s*[.)\-:]|[-*•]|\[\s?\])\s*(.+)$/);
    if (!m) continue;
    let t = m[1].trim();
    let min = null;
    const lead = t.match(/^[[(]?\s*(\d+(?:[.,]\d+)?)\s*(min(?:utos?)?|h(?:oras?)?)\.?\s*[\])]?\s*[-–—:]?\s*/i);
    if (lead) {
      min = toMinutes(lead[1], lead[2]);
      t = t.slice(lead[0].length);
    } else {
      const tail = t.match(/\s*[[(]\s*(\d+(?:[.,]\d+)?)\s*(min(?:utos?)?|h(?:oras?)?)\.?\s*[\])]\s*\.?$/i);
      if (tail) { min = toMinutes(tail[1], tail[2]); t = t.slice(0, tail.index); }
    }
    t = t.replace(/^[-–—:]\s*/, '').trim();
    if (t.length > 1) tasks.push({ id: uid(), text: t, min, done: false });
  }
  return { diagnosis, tip, tasks };
}
const toMinutes = (n, unit) => {
  const v = parseFloat(n.replace(',', '.'));
  return Math.round(/^h/i.test(unit) ? v * 60 : v);
};

/* =========================================================
   Banco de dados no celular (IndexedDB)
   ========================================================= */

const db = (() => {
  let conn;
  const open = () => (conn ??= new Promise((res, rej) => {
    const r = indexedDB.open('casa-em-ordem', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('arrumacoes', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const tx = d.transaction('arrumacoes', mode);
      const req = fn(tx.objectStore('arrumacoes'));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error);
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll()),
    get: (id) => run('readonly', (s) => s.get(id)),
    put: (o) => run('readwrite', (s) => s.put(o)),
    del: (id) => run('readwrite', (s) => s.delete(id)),
  };
})();

/* =========================================================
   Utilitários
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').toUpperCase();
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}` : `${m}min`);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let urls = [];
const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

const prefs = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('ceo-prefs') || '{}'); } catch { /* sem armazenamento */ }
  return {
    get sound() { return s.sound !== false; },
    set sound(v) { s.sound = v; try { localStorage.setItem('ceo-prefs', JSON.stringify(s)); } catch { /* ok */ } },
  };
})();

/* Ícones de linha */
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  power: '<path d="M12 2v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  skip: '<path d="m5 4 10 8-10 8V4zM19 5v14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M17 5h4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

/* Anel com marcações, como o visor de um ciclo */
function ring(pct = 0, { ticks = 60, stroke = 7 } = {}) {
  const r = 78, c = 2 * Math.PI * r;
  let marks = '';
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * 2 * Math.PI - Math.PI / 2;
    const major = i % 5 === 0;
    const r1 = major ? 88 : 90, r2 = 96;
    const on = i / ticks < pct ? ' on' : '';
    marks += `<line class="tick${major ? ' major' : ''}${on}" data-k="${i / ticks}" x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`;
  }
  return `<svg class="ring" viewBox="0 0 200 200" aria-hidden="true">${marks}
    <circle class="track" cx="100" cy="100" r="${r}" stroke-width="${stroke}"/>
    <circle class="arc${pct <= 0.002 ? ' zero' : ''}" cx="100" cy="100" r="${r}" stroke-width="${stroke}" transform="rotate(-90 100 100)"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" data-c="${c}"/></svg>`;
}
function setRing(root, pct) {
  const arc = $('.arc', root);
  if (!arc) return;
  arc.style.strokeDashoffset = arc.dataset.c * (1 - Math.max(0, Math.min(1, pct)));
  arc.classList.toggle('zero', pct <= 0.002);
  $$('.tick', root).forEach((t) => t.classList.toggle('on', +t.dataset.k < pct));
}
function miniRing(pct) {
  const r = 18, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 46 46"><circle class="track" cx="23" cy="23" r="${r}" stroke-width="4"/>
    <circle class="arc" cx="23" cy="23" r="${r}" stroke-width="4" transform="rotate(-90 23 23)" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
}

function countUp(el, to, ms = 1200) {
  if (reduceMotion) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* =========================================================
   Efeitos: som, vibração, confete
   ========================================================= */

const fx = (() => {
  let ac;
  const ctx = () => {
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };
  function tone(freq, dur = 0.08, vol = 0.05, type = 'sine', when = 0) {
    if (!prefs.sound) return;
    const a = ctx(); if (!a) return;
    const t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* sem vibração */ } };
  return {
    tick() { tone(2400, 0.02, 0.02, 'square'); buzz(3); },
    tap() { tone(1300, 0.05, 0.035); buzz(8); },
    ok() { tone(880, 0.09, 0.05); tone(1320, 0.14, 0.05, 'sine', 0.08); buzz(14); },
    start() { [440, 660, 990].forEach((f, i) => tone(f, 0.16, 0.05, 'sine', i * 0.09)); buzz([10, 40, 30]); },
    done() { [660, 880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.2, 0.05, 'sine', i * 0.1)); buzz([20, 40, 20, 40, 80]); },
    alarm() { for (let i = 0; i < 4; i++) tone(1000, 0.12, 0.07, 'square', i * 0.22); buzz([200, 100, 200, 100, 300]); },
    del() { tone(320, 0.14, 0.05, 'triangle'); buzz(20); },
  };
})();

function confetti() {
  if (reduceMotion) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const colors = ['#3ef0c8', '#ffb547', '#8fb0ff', '#ff7aa8', '#ffffff'];
  const ps = Array.from({ length: 180 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.42,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 5,
    s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now(), life = 2800;
  (function frame(t) {
    const el = t - t0;
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - el / life);
      g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (el < life) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

/* Toast com ação opcional */
let toastTimer;
function toast(msg, { ms = 3800, action, onAction } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction?.(); };
}

/* Ondulação ao tocar em botões */
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn, .key, .icon-btn');
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--rx', `${e.clientX - r.left}px`);
  b.style.setProperty('--ry', `${e.clientY - r.top}px`);
  b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip');
});

/* Relógio de painel e botão de som (presentes em todas as telas) */
const clockText = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
setInterval(() => $$('[data-clock]').forEach((el) => (el.textContent = clockText())), 15000);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound]');
  if (!b) return;
  prefs.sound = !prefs.sound;
  b.setAttribute('aria-pressed', prefs.sound);
  b.innerHTML = ic(prefs.sound ? 'sound' : 'mute');
  if (prefs.sound) fx.ok();
  toast(prefs.sound ? 'Sons ligados' : 'Sons desligados', { ms: 1500 });
});
const soundBtn = () => `<button class="icon-btn" data-sound aria-pressed="${prefs.sound}" aria-label="Ligar ou desligar sons">${ic(prefs.sound ? 'sound' : 'mute')}</button>`;

/* Imagens */
function loadImage(blob) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Não consegui abrir essa imagem.'));
    im.src = URL.createObjectURL(blob);
  });
}
async function compress(file, max = 1600) {
  const im = await loadImage(file);
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(im, 0, 0, w, h);
  URL.revokeObjectURL(im.src);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, w, h };
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* sem suporte */ }
  t.remove();
  return ok;
}

/* =========================================================
   Navegação
   ========================================================= */

const app = $('#app');

async function render() {
  freeUrls();
  app.onclick = app.onchange = app.oninput = null;
  const hash = location.hash.slice(1);
  try {
    if (hash === 'nova') renderNew();
    else if (hash.startsWith('a/')) await renderDetail(hash.slice(2));
    else await renderHome();
    $$('.reveal', app).forEach((el, i) => el.style.setProperty('--d', i));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="panel" style="margin-top:40px;text-align:center"><p>Algo deu errado: ${esc(e.message)}</p><br><a class="btn" href="#">Voltar ao início</a></div>`;
  }
}

function navigate() {
  app.classList.add('enter');
  clearTimeout(navigate.t);
  navigate.t = setTimeout(() => app.classList.remove('enter'), 1600);
  const run = async () => { await render(); window.scrollTo(0, 0); };
  if (document.startViewTransition && !reduceMotion) {
    const vt = document.startViewTransition(run);
    vt.ready.catch(() => {}); vt.finished.catch(() => {}); // transição abortada não é erro
  } else run();
}
window.addEventListener('hashchange', navigate);

/* =========================================================
   Tela: Painel (início)
   ========================================================= */

async function renderHome() {
  const items = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
  const all = items.flatMap((a) => a.tasks);
  const total = all.length, done = all.filter((t) => t.done).length;
  const pct = total ? done / total : 0;
  const leftMin = all.reduce((s, t) => s + (t.done ? 0 : t.min || 0), 0);

  const cards = items.map((a) => {
    const [, icon, name] = roomOf(a.room);
    const n = a.tasks.length, d = a.tasks.filter((t) => t.done).length;
    const state = !n ? 'novo' : d === n ? 'ok' : 'ativo';
    const label = { novo: 'AGUARDANDO GEMINI', ativo: 'EM ANDAMENTO', ok: 'CONCLUÍDO' }[state];
    const p = n ? d / n : 0;
    return `<a class="cycle-card" href="#a/${a.id}">
      <div class="cc-img"><img src="${blobUrl(a.after || a.before)}" alt="" loading="lazy"><span class="cc-status s-${state}">${label}</span></div>
      <div class="cc-body">
        <div><div class="cc-title">${icon} ${esc(name)}</div><div class="cc-meta">${fmtDate(a.createdAt)}${n ? ` · ${d}/${n} ETAPAS` : ''}</div></div>
        <div class="mini-ring">${miniRing(p)}<b>${Math.round(p * 100)}</b></div>
      </div>
    </a>`;
  }).join('');

  const boot = [
    ['Capture', 'Fotografe o cômodo bagunçado'],
    ['Programe', 'Escolha cômodo, tempo e modo'],
    ['Consulte o Gemini', 'Ele cria o plano e a imagem do depois'],
    ['Execute o ciclo', 'Etapa por etapa, com timer de foco'],
  ].map(([t, s], k) => `<div class="panel boot-step reveal"><span class="n" style="--k:${k}">0${k + 1}</span><div><strong>${t}</strong><small>${s}</small></div></div>`).join('');

  app.innerHTML = `
    <header class="statusbar reveal">
      <a class="logo" href="#"><img src="icons/icon-192.png" alt=""><span>CASA<b>EM ORDEM</b></span></a>
      <div class="sb-right"><span class="led small" data-clock>${clockText()}</span>${soundBtn()}</div>
    </header>
    <section class="hero reveal">
      <div class="dial" id="homeDial">${ring(0)}
        <div class="dial-center"><div class="led big" id="homePct">0</div><div class="unit">% DA CASA EM ORDEM</div></div>
      </div>
      <div class="readouts">
        <div class="readout"><span class="led">${pad(items.length)}</span><small>CICLOS</small></div>
        <div class="readout"><span class="led">${pad(total - done)}</span><small>TAREFAS</small></div>
        <div class="readout"><span class="led">${leftMin ? fmtMin(leftMin) : '--'}</span><small>RESTANTE</small></div>
      </div>
    </section>
    <a class="btn primary xl glow reveal" href="#nova">${ic('power')} Iniciar novo ciclo</a>
    ${items.length
      ? `<div class="sec-head reveal"><h2>Seus ciclos</h2><span class="chip-led">${items.filter((a) => a.tasks.some((t) => !t.done)).length} ATIVOS</span></div>
         <div class="carousel reveal">${cards}</div>`
      : `<div class="boot">${boot}</div>`}`;

  requestAnimationFrame(() => setRing($('#homeDial'), pct));
  countUp($('#homePct'), Math.round(pct * 100));

  // Inclinação 3D dos cartões ao passar o mouse
  $$('.cycle-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--ty', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
      card.style.setProperty('--tx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
    });
    card.addEventListener('pointerleave', () => { card.style.removeProperty('--tx'); card.style.removeProperty('--ty'); });
  });
}

/* =========================================================
   Tela: Programar novo ciclo
   ========================================================= */

function renderNew() {
  const state = { photo: null, room: 0, time: 1, style: 'pratico', rot: 0 };

  app.innerHTML = `
    <header class="topbar reveal">
      <a class="icon-btn" href="#" aria-label="Voltar">${ic('back')}</a>
      <h1><span>Programar ciclo<span class="sub">NOVO PROGRAMA</span></span></h1>
      ${soundBtn()}
    </header>

    <section class="panel viewfinder reveal">
      <label class="vf-area" id="vf">
        <input class="sr-file" type="file" id="photo" accept="image/*">
        <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
        <span class="vf-empty"><span class="cam">${ic('camera')}</span><strong>Capturar cômodo</strong><small>Foto inteira, de um canto, com boa luz</small></span>
      </label>
      <div class="vf-status"><span class="dot" id="vfDot"></span><span class="led small" id="vfStatus">SEM IMAGEM</span></div>
    </section>

    <section class="panel reveal">
      <div class="panel-head"><span class="label">Ambiente</span><span class="led" id="roomLed">${ROOMS[0][2].toUpperCase()}</span></div>
      <div class="knob" id="knob" role="slider" tabindex="0" aria-label="Cômodo" aria-valuemin="0" aria-valuemax="${ROOMS.length - 1}" aria-valuenow="0" aria-valuetext="${ROOMS[0][2]}">
        ${ROOMS.map(([, emo, n], i) => `<button type="button" class="knob-opt${i === 0 ? ' on' : ''}" data-i="${i}" style="--a:${i * 36}deg" aria-label="${esc(n)}" tabindex="-1">${emo}</button>`).join('')}
        <div class="knob-dial" id="dial"></div>
        <div class="knob-face"><span id="knobEmoji">${ROOMS[0][1]}</span></div>
      </div>
      <p class="hint">Gire o seletor ou toque num ícone</p>
    </section>

    <section class="panel reveal">
      <div class="panel-head"><span class="label">Tempo disponível</span><span class="led" id="timeLed">${TIMES[1][1]}</span></div>
      <div class="slider">
        <input type="range" id="time" min="0" max="${TIMES.length - 1}" step="1" value="1" aria-label="Tempo disponível" aria-valuetext="${TIMES[1][0]}" style="--p:25%">
        <div class="notches">${TIMES.map((t, i) => `<span class="${i === 1 ? 'on' : ''}">${t[2]}</span>`).join('')}</div>
      </div>
    </section>

    <section class="panel reveal">
      <div class="panel-head"><span class="label">Modo</span></div>
      <div class="modes" role="radiogroup" aria-label="Estilo">
        ${STYLES.map(([id, n, , emo, sub], i) => `<button type="button" class="mode" role="radio" aria-checked="${i === 0}" data-style="${id}"><span class="mode-led"></span><span class="mode-ic">${emo}</span><strong>${n}</strong><small>${sub}</small></button>`).join('')}
      </div>
    </section>

    <details class="panel notes reveal">
      <summary><span class="label">Observações <span style="letter-spacing:0;text-transform:none;font-weight:400">· opcional</span></span></summary>
      <textarea id="notes" placeholder="Ex.: as roupas se acumulam na cadeira; não posso comprar móveis; tenho criança pequena"></textarea>
    </details>

    <div class="start reveal">
      <button class="power" id="start" disabled aria-label="Iniciar ciclo">
        <svg class="pring" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="47"/><circle class="fg" cx="50" cy="50" r="47" pathLength="100"/></svg>
        ${ic('power')}
      </button>
      <p class="hint" id="startHint">Capture uma foto para liberar</p>
    </div>`;

  /* --- Foto --- */
  const vf = $('#vf'), dot = $('#vfDot'), vfStatus = $('#vfStatus'), startBtn = $('#start'), hint = $('#startHint');
  $('#photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    dot.className = 'dot busy'; vfStatus.textContent = 'PROCESSANDO…';
    try {
      state.photo = await compress(file);
      $$('img, .vf-empty', vf).forEach((n) => n.remove());
      vf.insertAdjacentHTML('beforeend', `<img src="${blobUrl(state.photo.blob)}" alt="Foto do cômodo">`);
      vf.classList.remove('scanning'); void vf.offsetWidth; vf.classList.add('scanning');
      fx.tap();
      setTimeout(() => {
        dot.className = 'dot on';
        vfStatus.textContent = `IMAGEM PRONTA · ${state.photo.w}×${state.photo.h}`;
        startBtn.disabled = false;
        hint.textContent = 'Segure o botão para iniciar';
        fx.ok();
      }, reduceMotion ? 0 : 1500);
    } catch (err) {
      dot.className = 'dot'; vfStatus.textContent = 'ERRO NA IMAGEM';
      toast(err.message);
    }
  });

  /* --- Seletor giratório --- */
  const knob = $('#knob'), dial = $('#dial'), N = ROOMS.length, STEP = 360 / N;
  const setRoom = (i, silent) => {
    i = ((i % N) + N) % N;
    if (i === state.room && silent !== 'force') return;
    state.room = i;
    $$('.knob-opt', knob).forEach((o, k) => o.classList.toggle('on', k === i));
    $('#roomLed').textContent = ROOMS[i][2].toUpperCase();
    const em = $('#knobEmoji');
    em.textContent = ROOMS[i][1];
    em.classList.remove('pop'); void em.offsetWidth; em.classList.add('pop');
    knob.setAttribute('aria-valuenow', i);
    knob.setAttribute('aria-valuetext', ROOMS[i][2]);
    if (!silent) fx.tick();
  };
  const applyRot = () => dial.style.setProperty('--rot', `${state.rot}deg`);
  const angleOf = (e) => {
    const r = knob.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  let dragging = false;
  dial.addEventListener('pointerdown', (e) => {
    dragging = true; knob.classList.add('dragging'); dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let a = angleOf(e);
    while (a - state.rot > 180) a -= 360;
    while (a - state.rot < -180) a += 360;
    state.rot = a; applyRot();
    setRoom(Math.round(a / STEP));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false; knob.classList.remove('dragging');
    state.rot = Math.round(state.rot / STEP) * STEP; applyRot();
  };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);
  const turnTo = (i) => {
    const d = ((((i - state.room) % N) + N + N / 2) % N) - N / 2;
    state.rot += d * STEP; applyRot(); setRoom(i);
  };
  $$('.knob-opt', knob).forEach((o) => o.addEventListener('click', () => turnTo(+o.dataset.i)));
  knob.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowUp'].includes(e.key)) { e.preventDefault(); turnTo(state.room + 1); }
    if (['ArrowLeft', 'ArrowDown'].includes(e.key)) { e.preventDefault(); turnTo(state.room - 1); }
  });

  /* --- Tempo --- */
  const time = $('#time');
  time.addEventListener('input', () => {
    const i = +time.value;
    state.time = i;
    time.style.setProperty('--p', `${(i / (TIMES.length - 1)) * 100}%`);
    time.setAttribute('aria-valuetext', TIMES[i][0]);
    $('#timeLed').textContent = TIMES[i][1];
    $$('.notches span').forEach((s, k) => s.classList.toggle('on', k === i));
    fx.tick();
  });

  /* --- Modo --- */
  $$('.mode').forEach((m) => m.addEventListener('click', () => {
    state.style = m.dataset.style;
    $$('.mode').forEach((x) => x.setAttribute('aria-checked', x === m));
    fx.tap();
  }));

  /* --- Iniciar: segurar o botão --- */
  let holdTimer;
  const launch = async () => {
    if (!state.photo || launch.busy) return;
    launch.busy = true;
    clearTimeout(holdTimer);
    const a = {
      id: uid(), createdAt: Date.now(),
      room: ROOMS[state.room][0], time: TIMES[state.time][0], style: state.style, notes: $('#notes').value,
      before: state.photo.blob, w: state.photo.w, h: state.photo.h, after: null,
      diagnosis: '', tip: '', tasks: [], sentPlan: false, sentImage: false,
    };
    await db.put(a);
    navigator.storage?.persist?.();
    fx.start();
    startBtn.classList.add('launch');
    setTimeout(() => (location.hash = `a/${a.id}`), reduceMotion ? 0 : 450);
  };
  startBtn.addEventListener('pointerdown', (e) => {
    if (startBtn.disabled) return;
    e.preventDefault();
    startBtn.classList.add('holding');
    fx.tick();
    holdTimer = setTimeout(launch, 800);
  });
  const cancelHold = () => {
    if (!startBtn.classList.contains('holding') || launch.busy) return;
    clearTimeout(holdTimer);
    startBtn.classList.remove('holding');
    hint.textContent = 'Continue segurando até o anel completar';
  };
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => startBtn.addEventListener(ev, cancelHold));
  startBtn.addEventListener('click', (e) => { if (e.detail === 0) launch(); }); // teclado / leitor de tela
  startBtn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* =========================================================
   Tela: Ciclo (detalhe)
   ========================================================= */

let focusTimer = null; // { aid, tid, end, dur, iv }

function stopFocus() {
  if (focusTimer) clearInterval(focusTimer.iv);
  focusTimer = null;
}

async function renderDetail(id) {
  const a = await db.get(id);
  if (!a) { location.hash = ''; return; }
  const [, icon, name] = roomOf(a.room);
  const hasPlan = a.tasks.length > 0;
  const total = a.tasks.length, done = a.tasks.filter((t) => t.done).length;
  const leftMin = a.tasks.reduce((s, t) => s + (t.done ? 0 : t.min || 0), 0);
  const current = a.tasks.find((t) => !t.done);
  const curIdx = current ? a.tasks.indexOf(current) : -1;
  const timing = focusTimer && focusTimer.aid === a.id && current && focusTimer.tid === current.id;
  if (focusTimer && !timing && focusTimer.aid === a.id) stopFocus();

  /* Visor da foto / antes e depois */
  const viewer = a.after
    ? `<div class="viewer compare reveal" style="aspect-ratio:${a.w}/${a.h}">
         <img src="${blobUrl(a.before)}" alt="Antes">
         <div class="after" style="clip-path:inset(0 0 0 50%)"><img src="${blobUrl(a.after)}" alt="Depois"></div>
         <div class="handle" style="left:50%"></div>
         <span class="badge">ANTES</span><span class="badge r">DEPOIS</span>
         <input type="range" min="0" max="100" value="50" step="0.1" aria-label="Comparar antes e depois">
       </div>`
    : `<div class="viewer reveal"><img src="${blobUrl(a.before)}" alt="Foto do cômodo"><span class="badge">ANTES</span></div>`;

  /* Linha do tempo com o Gemini */
  const active = !a.sentPlan && !hasPlan ? 1 : !hasPlan ? 2 : !a.after ? 3 : 0;
  const stage = (n, isDone, title, desc, actions, extra = '') => `
    <div class="stage ${isDone ? 'done' : ''} ${active === n ? 'active' : ''}">
      <span class="node">${isDone ? ic('check') : n}</span>
      <div><h3>${title}</h3><p>${desc}</p><div class="actions">${actions}</div>${extra}</div>
    </div>`;
  const stages = `
    ${stage(1, a.sentPlan || hasPlan, 'Enviar ao Gemini',
      'Abre o compartilhamento com a foto. O pedido já fica copiado: no Gemini, cole e envie.',
      `<button class="btn primary" data-act="send-plan">${ic('send')} Enviar foto ao Gemini</button>`,
      `<details class="prompt"><summary>Ver o pedido</summary><pre>${esc(planPrompt(a))}</pre></details>`)}
    ${stage(2, hasPlan, 'Carregar o programa',
      hasPlan ? `Programa com ${total} etapas carregado. Cole outra resposta para refazer.` : 'No Gemini, toque em "Copiar" embaixo da resposta e volte para cá.',
      `<textarea id="answer" placeholder="Cole aqui a resposta do Gemini"></textarea>
       <div class="row"><button class="btn" data-act="paste">${ic('paste')} Colar</button><button class="btn primary" data-act="parse">Carregar</button></div>`)}
    ${stage(3, !!a.after, 'Prévia do resultado',
      'Na mesma conversa do Gemini, cole o segundo pedido. Salve a imagem gerada e escolha-a aqui.',
      `<button class="btn primary" data-act="send-image">${ic('spark')} Copiar pedido e abrir o Gemini</button>
       <label class="btn">${ic('image')} ${a.after ? 'Trocar' : 'Escolher'} imagem do depois<input class="sr-file" type="file" accept="image/*" id="afterFile"></label>`,
      `<details class="prompt"><summary>Ver o pedido</summary><pre>${esc(imagePrompt(a))}</pre></details>`)}`;
  const pipeHead = `<div class="pipe-head"><span class="gem">${ic('spark')}</span><div><span class="label">Assistente</span><h2>Gemini</h2></div></div>`;

  /* Console do ciclo */
  let consoleHtml = '';
  if (hasPlan && current) {
    const pct = done / total;
    consoleHtml = `
      <section class="panel console reveal ${timing ? 'timing' : ''}" id="console">
        <div class="dial" id="cDial">${ring(timing ? 0 : pct)}
          <div class="dial-center">
            <div class="led big" id="cLed">${timing ? '--:--' : leftMin ? leftMin : `${done}/${total}`}</div>
            <div class="unit" id="cUnit">${timing ? 'FOCO' : leftMin ? 'MIN RESTANTES' : 'ETAPAS'}</div>
          </div>
        </div>
        <div class="now">
          <span class="label">Etapa ${pad(curIdx + 1)} de ${pad(total)}</span>
          <h2 class="now-task" id="nowTask">${esc(current.text)}</h2>
          ${current.min ? `<span class="chip-led">${fmtMin(current.min)}</span>` : ''}
        </div>
        <div class="console-keys">
          <button class="key ${timing ? 'on' : ''}" data-act="focus" aria-pressed="${!!timing}">${ic('timer')}<span>${timing ? 'Parar' : 'Foco'}</span></button>
          <button class="btn primary xl" data-act="complete">${ic('check')} Concluir etapa</button>
          <button class="key" data-act="skip">${ic('skip')}<span>Pular</span></button>
        </div>
      </section>`;
  } else if (hasPlan) {
    consoleHtml = `
      <section class="panel console reveal">
        <div class="done-state">
          <div class="big-check">${ic('check')}</div>
          <span class="label">Ciclo concluído</span>
          <h2 style="margin-top:6px">${esc(name)} em ordem!</h2>
          <p class="hint" style="margin-top:8px">${total} etapas finalizadas</p>
        </div>
        <div class="row" style="margin-top:16px"><button class="btn" data-act="reset">${ic('reset')} Repetir ciclo</button><a class="btn primary" href="#nova">${ic('power')} Novo ciclo</a></div>
      </section>`;
  }

  const program = hasPlan ? `
    ${a.diagnosis || a.tip ? `<section class="panel reading reveal"><span class="label">Leitura do ambiente</span>
      ${a.diagnosis ? `<p>${esc(a.diagnosis)}</p>` : ''}${a.tip ? `<p class="tip"><b>Para manter:</b> ${esc(a.tip)}</p>` : ''}</section>` : ''}
    <div class="sec-head reveal"><h2>Programa</h2><span class="chip-led">${done}/${total}</span></div>
    <p class="hint reveal" style="text-align:left;margin:-4px 2px 10px">Deslize → para concluir · ← para remover</p>
    <ol class="program reveal">
      ${a.tasks.map((t, i) => `
        <li class="prog ${t.done ? 'done' : ''} ${current && t.id === current.id ? 'current' : ''}" data-id="${t.id}">
          <div class="prog-bg"><span class="bg-ok">${ic('check')}</span><span class="bg-del">${ic('trash')}</span></div>
          <div class="prog-face">
            <button class="prog-check" data-toggle="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'Desmarcar' : 'Concluir'}: ${esc(t.text)}">${ic('check')}</button>
            <span class="prog-num">${pad(i + 1)}</span>
            <span class="prog-text">${esc(t.text)}</span>
            ${t.min ? `<span class="prog-min">${fmtMin(t.min)}</span>` : '<span></span>'}
          </div>
        </li>`).join('')}
    </ol>
    <form class="add-task reveal" id="addTask"><input name="t" placeholder="Adicionar etapa" autocomplete="off" aria-label="Nova etapa"><button class="btn" aria-label="Adicionar">${ic('plus')}</button></form>
    <details class="panel gem-box reveal" style="margin-top:22px"><summary>${pipeHead}</summary>${stages}</details>` : '';

  app.innerHTML = `
    <header class="topbar reveal">
      <a class="icon-btn" href="#" aria-label="Voltar">${ic('back')}</a>
      <h1><span>${icon} ${esc(name)}<span class="sub">${fmtDate(a.createdAt)} · ${esc(a.time.toUpperCase())}</span></span></h1>
      ${soundBtn()}
    </header>
    ${viewer}
    ${hasPlan ? consoleHtml + program : `<section class="panel pipeline reveal">${pipeHead}${stages}</section>`}
    <div style="margin-top:30px;text-align:center"><button class="btn ghost danger" data-act="delete">${ic('trash')} Excluir ciclo</button></div>`;

  if (hasPlan && current && !timing) requestAnimationFrame(() => setRing($('#cDial'), done / total));
  if (timing) tickFocus();

  /* --- Comparador antes/depois --- */
  const cmp = $('.compare input[type=range]');
  if (cmp) {
    const setCmp = (v) => {
      $('.compare .after').style.clipPath = `inset(0 0 0 ${v}%)`;
      $('.compare .handle').style.left = `${v}%`;
    };
    cmp.addEventListener('input', () => setCmp(cmp.value));
    if (!reduceMotion && !renderDetail.demoed?.has(a.id)) {
      (renderDetail.demoed ??= new Set()).add(a.id);
      const keys = [[0, 50], [700, 82], [1500, 18], [2200, 50]];
      const t0 = performance.now();
      const step = (t) => {
        const el = t - t0;
        const k = keys.findIndex(([ms]) => ms > el);
        if (k === -1) { setCmp(50); cmp.value = 50; return; }
        const [m0, v0] = keys[k - 1], [m1, v1] = keys[k];
        const p = (el - m0) / (m1 - m0), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const v = v0 + (v1 - v0) * e;
        setCmp(v); cmp.value = v;
        requestAnimationFrame(step);
      };
      setTimeout(() => requestAnimationFrame(step), 500);
    }
  }

  /* --- Salvar e redesenhar --- */
  const save = async (patch) => {
    Object.assign(a, patch);
    await db.put(a);
    const y = scrollY;
    await render();
    scrollTo(0, y);
  };

  const setDone = async (tid, val) => {
    const t = a.tasks.find((x) => x.id === tid);
    if (!t) return;
    if (focusTimer?.tid === tid) stopFocus();
    t.done = val;
    const all = a.tasks.every((x) => x.done);
    if (val) all ? fx.done() : fx.ok(); else fx.tap();
    await save({ tasks: a.tasks });
    if (val && all) { confetti(); toast('Ciclo concluído! Cômodo em ordem 🎉', { ms: 5000 }); }
    else if (val) {
      $(`.prog[data-id="${tid}"]`)?.classList.add('flash');
      $('#nowTask')?.classList.add('swap');
    }
  };

  const removeTask = async (tid) => {
    const i = a.tasks.findIndex((x) => x.id === tid);
    if (i < 0) return;
    const [removed] = a.tasks.splice(i, 1);
    if (focusTimer?.tid === tid) stopFocus();
    fx.del();
    await save({ tasks: a.tasks });
    toast('Etapa removida', {
      ms: 5000, action: 'Desfazer',
      onAction: async () => {
        const fresh = await db.get(a.id);
        fresh.tasks.splice(i, 0, removed);
        await db.put(fresh);
        render();
      },
    });
  };

  /* --- Gestos de deslizar nas etapas --- */
  $$('.prog').forEach((li) => {
    const face = $('.prog-face', li);
    let x0 = 0, y0 = 0, dx = 0, mode = null, armed = false;
    face.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; mode = 'pending'; armed = false;
    });
    face.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (mode === 'pending') {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) { mode = 'swipe'; li.classList.add('dragging'); face.setPointerCapture(e.pointerId); }
        else if (Math.abs(my) > 10) { mode = null; return; }
        else return;
      }
      dx = mx;
      li.dataset.dir = dx > 0 ? 'r' : 'l';
      face.style.setProperty('--dx', `${dx}px`);
      const nowArmed = Math.abs(dx) > 90;
      if (nowArmed !== armed) { armed = nowArmed; li.toggleAttribute('data-armed', armed); if (armed) fx.tick(); }
    });
    const end = () => {
      if (mode !== 'swipe') { mode = null; return; }
      mode = null; li.classList.remove('dragging');
      if (armed && dx > 0) {
        face.style.setProperty('--dx', '110%');
        const t = a.tasks.find((x) => x.id === li.dataset.id);
        setTimeout(() => setDone(li.dataset.id, !t.done), 180);
      } else if (armed && dx < 0) {
        face.style.setProperty('--dx', '-110%');
        setTimeout(() => removeTask(li.dataset.id), 180);
      } else {
        face.style.setProperty('--dx', '0px');
      }
    };
    face.addEventListener('pointerup', end);
    face.addEventListener('pointercancel', end);
  });

  const photoFile = new File([a.before], `${a.room}.jpg`, { type: 'image/jpeg' });

  /* --- Ações --- */
  app.onclick = async (e) => {
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const t = a.tasks.find((x) => x.id === tog.dataset.toggle); return setDone(t.id, !t.done); }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    switch (btn.dataset.act) {
      case 'complete': return current && setDone(current.id, true);
      case 'skip': {
        if (!current || total < 2) return;
        a.tasks.splice(curIdx, 1); a.tasks.push(current);
        if (focusTimer?.tid === current.id) stopFocus();
        fx.tick();
        await save({ tasks: a.tasks });
        $('#nowTask')?.classList.add('swap');
        return;
      }
      case 'focus': {
        if (timing) { stopFocus(); fx.tap(); return save({}); }
        stopFocus();
        const dur = (current.min || 10) * 60000;
        focusTimer = { aid: a.id, tid: current.id, dur, end: Date.now() + dur, iv: setInterval(tickFocus, 250) };
        fx.start();
        toast(`Foco de ${fmtMin(current.min || 10)} iniciado`, { ms: 2000 });
        return save({});
      }
      case 'reset': {
        a.tasks.forEach((t) => (t.done = false));
        fx.start();
        return save({ tasks: a.tasks });
      }
      case 'send-plan': {
        const text = planPrompt(a);
        copyText(text); // sem await: o compartilhamento precisa acontecer logo após o toque
        if (navigator.canShare?.({ files: [photoFile] })) {
          try {
            await navigator.share({ files: [photoFile], text });
            toast('Escolha o Gemini. Se o pedido não aparecer, toque no campo e cole.', { ms: 6000 });
            return save({ sentPlan: true });
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }
        const link = document.createElement('a');
        link.href = blobUrl(a.before); link.download = photoFile.name; link.click();
        window.open(GEMINI_URL, '_blank');
        toast('Pedido copiado e foto salva. No Gemini, anexe a foto e cole o pedido.', { ms: 7000 });
        a.sentPlan = true; await db.put(a);
        return;
      }
      case 'send-image': {
        copyText(imagePrompt(a));
        window.open(GEMINI_URL, '_blank');
        toast('Pedido copiado! Cole na mesma conversa do Gemini.', { ms: 5000 });
        a.sentImage = true; await db.put(a);
        return;
      }
      case 'paste': {
        try {
          const txt = await navigator.clipboard.readText();
          if (txt) { $('#answer').value = txt; fx.tap(); } else toast('A área de transferência está vazia.');
        } catch { toast('Toque e segure no campo de texto e escolha "Colar".'); $('#answer').focus(); }
        return;
      }
      case 'parse': {
        const raw = $('#answer').value.trim();
        if (!raw) return toast('Cole a resposta do Gemini primeiro.');
        const plan = parsePlan(raw);
        if (!plan.tasks.length) return toast('Não encontrei etapas numeradas. Confira se colou a resposta inteira.', { ms: 5000 });
        stopFocus();
        fx.start();
        await save({ ...plan, sentPlan: true });
        toast(`Programa carregado: ${plan.tasks.length} etapas`);
        $('#console')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        return;
      }
      case 'delete': {
        if (!confirm('Excluir este ciclo e as fotos dele?')) return;
        if (focusTimer?.aid === a.id) stopFocus();
        fx.del();
        await db.del(a.id);
        location.hash = '';
        return;
      }
    }
  };

  app.onchange = async (e) => {
    if (e.target.id === 'afterFile' && e.target.files[0]) {
      try {
        const { blob } = await compress(e.target.files[0]);
        renderDetail.demoed?.delete(a.id);
        fx.ok();
        await save({ after: blob });
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        toast('Arraste a linha para comparar o antes e o depois.');
      } catch (err) { toast(err.message); }
    }
  };

  $('#addTask')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.t.value.trim();
    if (!text) return;
    fx.tap();
    save({ tasks: [...a.tasks, { id: uid(), text, min: null, done: false }] });
  });
}

/* Atualiza o visor durante o modo foco */
function tickFocus() {
  if (!focusTimer) return;
  const left = Math.max(0, focusTimer.end - Date.now());
  const led = $('#cLed'), dialEl = $('#cDial');
  if (led && $('#console.timing')) {
    const s = Math.ceil(left / 1000);
    led.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    setRing(dialEl, 1 - left / focusTimer.dur);
  }
  if (left <= 0) {
    const { aid, tid } = focusTimer;
    stopFocus();
    fx.alarm();
    toast('⏰ Tempo! Terminou esta etapa?', {
      ms: 10000, action: 'Concluir',
      onAction: async () => {
        const rec = await db.get(aid);
        const t = rec?.tasks.find((x) => x.id === tid);
        if (t) { t.done = true; await db.put(rec); fx.ok(); render(); }
      },
    });
    if (location.hash === `#a/${aid}`) render();
  }
}

/* =========================================================
   Início
   ========================================================= */

navigate();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
