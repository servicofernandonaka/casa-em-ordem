'use strict';

/* ============ Dados fixos ============ */

const ROOMS = [
  ['quarto', '🛏️', 'Quarto'], ['sala', '🛋️', 'Sala'], ['cozinha', '🍳', 'Cozinha'],
  ['banheiro', '🚿', 'Banheiro'], ['lavanderia', '🧺', 'Lavanderia'], ['escritorio', '💻', 'Escritório'],
  ['infantil', '🧸', 'Quarto das crianças'], ['armario', '🚪', 'Armário / guarda-roupa'],
  ['garagem', '🚗', 'Garagem / depósito'], ['outro', '📦', 'Outro'],
];
const TIMES = ['15 minutos', '30 minutos', '1 hora', '2 horas', 'meio dia'];
const STYLES = [
  ['pratico', 'Prático', 'prático e funcional, fácil de manter no dia a dia'],
  ['minimalista', 'Minimalista', 'minimalista, com o mínimo de objetos à vista'],
  ['aconchegante', 'Aconchegante', 'aconchegante, organizado mas com cara de lar'],
];
const GEMINI_URL = 'https://gemini.google.com/app';

const roomOf = (id) => ROOMS.find((r) => r[0] === id) || ROOMS[ROOMS.length - 1];
const styleOf = (id) => STYLES.find((s) => s[0] === id) || STYLES[0];

/* ============ Pedidos (prompts) para o Gemini ============ */

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

/* ============ Leitura da resposta do Gemini ============ */

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

/* ============ Banco de dados no celular (IndexedDB) ============ */

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

/* ============ Utilitários ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);

let urls = [];
const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function loadImage(blob) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Não consegui abrir essa imagem.'));
    im.src = URL.createObjectURL(blob);
  });
}

// Reduz a foto (fotos de celular têm 3–12 MB) mantendo boa qualidade.
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

/* ============ Telas ============ */

const app = $('#app');

async function render() {
  freeUrls();
  const hash = location.hash.slice(1);
  try {
    if (hash === 'nova') return renderNew();
    if (hash.startsWith('a/')) return await renderDetail(hash.slice(2));
    return await renderHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card empty"><p>Algo deu errado: ${esc(e.message)}</p><a class="btn" href="#">Voltar ao início</a></div>`;
  }
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---- Início ---- */

async function renderHome() {
  const items = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
  const list = items.map((a) => {
    const [, icon, name] = roomOf(a.room);
    const total = a.tasks.length, done = a.tasks.filter((t) => t.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const status = !total ? 'Falta pedir o plano ao Gemini' : done === total ? 'Concluída 🎉' : `${done} de ${total} tarefas`;
    return `<a class="card item" href="#a/${a.id}">
      <img src="${blobUrl(a.after || a.before)}" alt="">
      <div>
        <strong>${icon} ${esc(name)}</strong>
        <div class="meta">${fmtDate(a.createdAt)} · ${status}</div>
        ${total ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}
      </div>
    </a>`;
  }).join('');

  app.innerHTML = `
    <div class="brand"><img src="icons/icon-192.png" alt=""><h1>Casa em Ordem</h1></div>
    <a class="btn primary block" href="#nova">📷 Nova arrumação</a>
    ${items.length ? `<div class="list">${list}</div>` : `
      <div class="card empty" style="margin-top:16px">
        <h2>Vamos arrumar um cômodo?</h2>
        <ol>
          <li>Tire uma foto do cômodo bagunçado.</li>
          <li>Envie para o seu Gemini com o pedido pronto que o app monta.</li>
          <li>Cole a resposta aqui e ganhe um checklist passo a passo.</li>
          <li>Peça ao Gemini a imagem de como vai ficar e compare o antes e depois.</li>
        </ol>
      </div>`}`;
}

/* ---- Nova arrumação ---- */

function renderNew() {
  const chip = (name, value, label, checked) =>
    `<label class="chip"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#" aria-label="Voltar">←</a><h1>Nova arrumação</h1></div>
    <form id="f">
      <label class="photo-pick" id="pick">
        <input class="sr-file" type="file" name="photo" accept="image/*">
        <span class="big">📷</span>
        <strong>Tirar ou escolher foto</strong>
        <span class="muted small">Fotografe o cômodo inteiro, de um canto, com boa luz</span>
      </label>
      <div class="field"><span class="label">Que cômodo é?</span>
        <div class="chips">${ROOMS.map(([id, ic, n], i) => chip('room', id, `${ic} ${n}`, i === 0)).join('')}</div></div>
      <div class="field"><span class="label">Quanto tempo você tem?</span>
        <div class="chips">${TIMES.map((t, i) => chip('time', t, t, i === 1)).join('')}</div></div>
      <div class="field"><span class="label">Estilo</span>
        <div class="chips">${STYLES.map(([id, n], i) => chip('style', id, n, i === 0)).join('')}</div></div>
      <div class="field"><label for="notes">Algo mais? <span class="muted small">(opcional)</span></label>
        <textarea id="notes" name="notes" placeholder="Ex.: as roupas se acumulam na cadeira; não posso comprar móveis; tenho criança pequena"></textarea></div>
      <div class="field"><button class="btn primary block" id="go" disabled>Continuar</button></div>
    </form>`;

  let photo = null;
  const form = $('#f'), pick = $('#pick'), go = $('#go');

  form.photo.addEventListener('change', async () => {
    const file = form.photo.files[0];
    if (!file) return;
    try {
      go.disabled = true;
      photo = await compress(file);
      pick.classList.add('has-photo');
      pick.querySelectorAll(':scope > :not(input)').forEach((n) => n.remove());
      pick.insertAdjacentHTML('beforeend', `<img src="${blobUrl(photo.blob)}" alt="Foto escolhida">`);
      go.disabled = false;
    } catch (e) { toast(e.message); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!photo) return toast('Escolha uma foto primeiro.');
    const a = {
      id: uid(), createdAt: Date.now(),
      room: form.room.value, time: form.time.value, style: form.style.value, notes: form.notes.value,
      before: photo.blob, w: photo.w, h: photo.h, after: null,
      diagnosis: '', tip: '', tasks: [], sentPlan: false, sentImage: false,
    };
    await db.put(a);
    navigator.storage?.persist?.();
    location.hash = `a/${a.id}`;
  });
}

/* ---- Detalhe de uma arrumação ---- */

async function renderDetail(id) {
  const a = await db.get(id);
  if (!a) { location.hash = ''; return; }
  const [, icon, name] = roomOf(a.room);
  const hasPlan = a.tasks.length > 0;
  const total = a.tasks.length, done = a.tasks.filter((t) => t.done).length;
  const totalMin = a.tasks.reduce((s, t) => s + (t.min || 0), 0);
  const leftMin = a.tasks.reduce((s, t) => s + (t.done ? 0 : t.min || 0), 0);

  const visual = a.after
    ? `<div class="compare" style="aspect-ratio:${a.w}/${a.h}">
         <img src="${blobUrl(a.before)}" alt="Antes">
         <div class="after" style="clip-path:inset(0 0 0 50%)"><img src="${blobUrl(a.after)}" alt="Depois"></div>
         <div class="handle" style="left:50%"></div>
         <span class="tag l">Antes</span><span class="tag r">Depois</span>
         <input type="range" min="0" max="100" value="50" aria-label="Comparar antes e depois">
       </div>`
    : `<div class="photo"><img src="${blobUrl(a.before)}" alt="Foto do cômodo"></div>`;

  const step = (n, isDone, title, desc, actions, extra = '') => `
    <div class="card step ${isDone ? 'done' : ''}">
      <div class="num">${isDone ? '✓' : n}</div>
      <div><h3>${title}</h3><p>${desc}</p><div class="actions">${actions}</div>${extra}</div>
    </div>`;

  const steps = `
    <div class="steps">
      ${step(1, a.sentPlan || hasPlan, 'Peça o plano ao Gemini',
        'Envia a foto para o app do Gemini. O pedido já fica copiado: no Gemini, é só colar e enviar.',
        `<button class="btn ${hasPlan ? '' : 'primary'}" data-act="send-plan">✨ Enviar foto ao Gemini</button>`,
        `<details class="prompt"><summary>Ver o pedido</summary><pre>${esc(planPrompt(a))}</pre></details>`)}
      ${step(2, hasPlan, 'Cole a resposta aqui',
        hasPlan ? 'Checklist criado. Se quiser refazer, cole uma nova resposta.' : 'No Gemini, toque em "Copiar" embaixo da resposta e volte para cá.',
        `<textarea id="answer" placeholder="Cole aqui a resposta do Gemini"></textarea>
         <div class="row"><button class="btn grow" data-act="paste">📋 Colar</button><button class="btn primary grow" data-act="parse">Criar checklist</button></div>`)}
      ${step(3, !!a.after, 'Veja como vai ficar',
        'Na mesma conversa do Gemini, cole o segundo pedido. Depois salve a imagem gerada e escolha-a aqui.',
        `<button class="btn ${hasPlan && !a.after ? 'primary' : ''}" data-act="send-image">🖼️ Copiar pedido e abrir o Gemini</button>
         <label class="btn">📥 ${a.after ? 'Trocar' : 'Escolher'} imagem do depois<input class="sr-file" type="file" accept="image/*" id="afterFile"></label>`,
        `<details class="prompt"><summary>Ver o pedido</summary><pre>${esc(imagePrompt(a))}</pre></details>`)}
    </div>`;

  const checklist = hasPlan ? `
    <div class="section-title"><h2>Checklist</h2><span class="muted small">${done}/${total}${totalMin ? ` · ${leftMin ? `faltam ~${fmtMin(leftMin)}` : 'pronto'}` : ''}</span></div>
    <div class="progress"><span style="width:${Math.round((done / total) * 100)}%"></span></div>
    ${a.diagnosis ? `<div class="diag" style="margin-top:14px"><strong>Diagnóstico.</strong> ${esc(a.diagnosis)}</div>` : ''}
    ${done === total ? '<div class="celebrate">🎉 Tudo feito! Que tal tirar uma foto do resultado?</div>' : ''}
    <ul class="tasks">
      ${a.tasks.map((t) => `
        <li class="task ${t.done ? 'done' : ''}">
          <input type="checkbox" id="t-${t.id}" data-task="${t.id}" ${t.done ? 'checked' : ''}>
          <label for="t-${t.id}">${esc(t.text)}${t.min ? `<span class="min">${fmtMin(t.min)}</span>` : ''}</label>
          <button class="icon-btn del" data-del="${t.id}" aria-label="Remover tarefa">✕</button>
        </li>`).join('')}
    </ul>
    <form class="add-task" id="addTask"><input name="t" placeholder="Adicionar tarefa" autocomplete="off"><button class="btn">+</button></form>
    ${a.tip ? `<div class="tip"><strong>Para manter:</strong> ${esc(a.tip)}</div>` : ''}` : '';

  app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#" aria-label="Voltar">←</a><h1>${icon} ${esc(name)}</h1><span class="muted small">${fmtDate(a.createdAt)}</span></div>
    ${visual}
    ${hasPlan ? checklist + `<div class="section-title"><h2>Passos com o Gemini</h2></div>` : ''}
    ${steps}
    <div style="margin-top:28px;text-align:center"><button class="btn ghost danger" data-act="delete">Excluir esta arrumação</button></div>`;

  // Comparador antes/depois
  const range = $('.compare input[type=range]');
  if (range) range.addEventListener('input', () => {
    $('.compare .after').style.clipPath = `inset(0 0 0 ${range.value}%)`;
    $('.compare .handle').style.left = `${range.value}%`;
  });

  const save = async (patch, rerender = true) => {
    Object.assign(a, patch);
    await db.put(a);
    if (rerender) { const y = scrollY; await render(); scrollTo(0, y); }
  };

  const photoFile = new File([a.before], `${a.room}.jpg`, { type: 'image/jpeg' });

  app.onclick = async (e) => {
    const btn = e.target.closest('[data-act],[data-del]');
    if (!btn) return;

    if (btn.dataset.del) {
      return save({ tasks: a.tasks.filter((t) => t.id !== btn.dataset.del) });
    }

    switch (btn.dataset.act) {
      case 'send-plan': {
        const text = planPrompt(a);
        copyText(text); // sem await: o compartilhamento precisa acontecer logo após o toque
        if (navigator.canShare?.({ files: [photoFile] })) {
          try {
            await navigator.share({ files: [photoFile], text });
            toast('Escolha o Gemini. Se o pedido não aparecer, toque no campo e cole.', 6000);
            return save({ sentPlan: true });
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }
        // Sem compartilhamento: baixa a foto e abre o Gemini
        const link = document.createElement('a');
        link.href = blobUrl(a.before); link.download = photoFile.name; link.click();
        window.open(GEMINI_URL, '_blank');
        toast('Pedido copiado e foto salva. No Gemini, anexe a foto e cole o pedido.', 7000);
        return save({ sentPlan: true }, false);
      }
      case 'send-image': {
        copyText(imagePrompt(a));
        window.open(GEMINI_URL, '_blank');
        toast('Pedido copiado! Cole na mesma conversa do Gemini.', 5000);
        return save({ sentImage: true }, false);
      }
      case 'paste': {
        try {
          const txt = await navigator.clipboard.readText();
          if (txt) $('#answer').value = txt; else toast('A área de transferência está vazia.');
        } catch { toast('Toque e segure no campo de texto e escolha "Colar".'); $('#answer').focus(); }
        return;
      }
      case 'parse': {
        const raw = $('#answer').value.trim();
        if (!raw) return toast('Cole a resposta do Gemini primeiro.');
        const plan = parsePlan(raw);
        if (!plan.tasks.length) return toast('Não encontrei tarefas numeradas. Confira se colou a resposta inteira.', 5000);
        await save({ ...plan, sentPlan: true });
        toast(`Checklist criado com ${plan.tasks.length} tarefas!`);
        return;
      }
      case 'delete': {
        if (!confirm('Excluir esta arrumação e as fotos dela?')) return;
        await db.del(a.id);
        location.hash = '';
        return;
      }
    }
  };

  app.onchange = async (e) => {
    if (e.target.dataset.task) {
      const t = a.tasks.find((x) => x.id === e.target.dataset.task);
      t.done = e.target.checked;
      const all = a.tasks.every((x) => x.done);
      await save({ tasks: a.tasks });
      if (all) toast('🎉 Parabéns, cômodo arrumado!');
    } else if (e.target.id === 'afterFile' && e.target.files[0]) {
      try {
        const { blob } = await compress(e.target.files[0]);
        await save({ after: blob });
        window.scrollTo(0, 0);
        toast('Arraste a barra para comparar o antes e depois.');
      } catch (err) { toast(err.message); }
    }
  };

  $('#addTask')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.t.value.trim();
    if (text) save({ tasks: [...a.tasks, { id: uid(), text, min: null, done: false }] });
  });
}

/* ============ Início ============ */

render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
