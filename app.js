/* ===================== NOVA — PWA ===================== */
/* Tout vit en localStorage. Aucun serveur requis. */

const STORAGE_KEY = 'nova_state_v1';
const STAGE_LABELS = { lead: 'Piste', contact: 'Contact', negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu' };
const trashSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>`;
const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>`;

function defaultState() {
  return {
    missions: [], deals: [], watches: [], cash: [],
    brain: [], alphonseHistory: [],
    dark: true,
    lockEnabled: false, lockMethod: null, lockCredentialId: null, pinHash: null,
    dailyReminder: false, lastReminderDate: null,
    ai: { mode: 'local', endpoint: '', model: '', key: '' }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed, { ai: Object.assign(defaultState().ai, parsed.ai || {}) });
  } catch {
    return defaultState();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast('Sauvegarde impossible — stockage plein ?'); }
}

let state = load();

/* ---------- helpers ---------- */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
function formatEUR(n) { return eurFmt.format(n || 0); }
function emptyHTML(title, sub) { return `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`; }

/* ---------- moteur local (équivalent NovaEngine) ---------- */
function scoreWatch(w) {
  return (w.originality || 0) + (w.brandFit || 0) - Math.max(0, ((w.estimatedCost || 0) - (w.targetPrice || 0)) / 10);
}
function cashBalance(s) { return s.cash.reduce((sum, c) => sum + (c.income ? c.amount : -c.amount), 0); }

function nextAction(s) {
  const openMissions = s.missions.filter(m => !m.done);
  const topMission = [...openMissions].sort((a, b) => b.priority - a.priority)[0];
  const topDeal = [...s.deals].sort((a, b) => b.value * b.probability - a.value * a.probability)[0];
  const topWatch = [...s.watches].sort((a, b) => scoreWatch(b) - scoreWatch(a))[0];
  const balance = cashBalance(s);

  const candidates = [];
  if (balance < 0) candidates.push({ score: 999, text: `Solde négatif (${formatEUR(balance)}) — direction Money OS` });
  if (topMission) candidates.push({ score: topMission.priority * 10, text: `Mission prioritaire : « ${topMission.title} »` });
  if (topDeal) candidates.push({ score: (topDeal.value * topDeal.probability) / 100, text: `Relance « ${topDeal.title} » (${Math.round(topDeal.probability * 100)}% de proba)` });
  if (topWatch) candidates.push({ score: scoreWatch(topWatch) / 2, text: `Concept à faire avancer : « ${topWatch.name} »` });

  if (!candidates.length) return "Rien d'urgent — ajoute une mission, un deal ou une note pour démarrer.";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].text;
}

function localAnswer(question, s) {
  const q = question.toLowerCase();
  if (/priorit|action|quoi faire|next/.test(q)) return nextAction(s);
  if (/argent|solde|cash|budget/.test(q)) {
    const b = cashBalance(s);
    return `Solde actuel : ${formatEUR(b)}. ${b < 0 ? 'Tu es dans le rouge.' : 'Tu es dans le positif.'}`;
  }
  if (/montre|watch|concept/.test(q)) {
    if (!s.watches.length) return 'Aucun concept de montre enregistré pour le moment.';
    const best = [...s.watches].sort((a, b) => scoreWatch(b) - scoreWatch(a))[0];
    return `Le concept le mieux placé est « ${best.name} », score ${scoreWatch(best).toFixed(0)}.`;
  }
  if (/deal|business|opportunit/.test(q)) {
    if (!s.deals.length) return 'Aucune opportunité en cours.';
    const best = [...s.deals].sort((a, b) => b.value * b.probability - a.value * a.probability)[0];
    return `La plus prometteuse : « ${best.title} », valeur pondérée ${formatEUR(best.value * best.probability)}.`;
  }
  if (s.brain.length) return `Pas de réponse toute faite à ça. Dernière note : « ${s.brain[s.brain.length - 1]} »`;
  return "Pas de réponse toute faite à ça — le moteur local est volontairement simple. Configure un LLM distant dans Réglages pour aller plus loin.";
}

async function remoteAnswer(question, s) {
  const ai = s.ai;
  if (!ai.endpoint || !ai.model || !ai.key) throw new Error('réglages IA incomplets');
  const system = `Tu es Alphonse, copilote de NOVA. Réponds en français, de façon concise et actionnable. Contexte : missions=${s.missions.filter(m => !m.done).length}/${s.missions.length}; deals=${s.deals.length}; watches=${s.watches.length}; solde=${cashBalance(s).toFixed(0)}€.`;
  const messages = [{ role: 'system', content: system }];
  s.alphonseHistory.slice(-12).forEach(t => messages.push({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text }));
  messages.push({ role: 'user', content: question });

  const res = await fetch(ai.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` },
    body: JSON.stringify({ model: ai.model, messages, temperature: 0.4 })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('réponse vide');
  return text.trim();
}

async function askAlphonse(question, s) {
  if (s.ai.mode === 'local') return { text: localAnswer(question, s), source: 'Local' };
  try {
    const text = await remoteAnswer(question, s);
    return { text, source: 'Distant' };
  } catch (e) {
    if (s.ai.mode === 'remote') {
      return { text: `Le LLM distant est injoignable (${e.message}). Réponse locale : ${localAnswer(question, s)}`, source: 'Local (repli)' };
    }
    return { text: localAnswer(question, s), source: 'Local' }; // hybride : repli silencieux
  }
}

/* ---------- DOM refs ---------- */
const mainEl = document.getElementById('main');
const nextActionEl = document.getElementById('nextAction');
const toastEl = document.getElementById('toast');
const sheetBackdrop = document.getElementById('sheetBackdrop');
const sheet = document.getElementById('sheet');
const lockScreen = document.getElementById('lockScreen');
const lockSub = document.getElementById('lockSub');
const pinDots = document.getElementById('pinDots');
const pinKeypad = document.getElementById('pinKeypad');
const btnBioUnlock = document.getElementById('btnBioUnlock');
const chatLog = document.getElementById('chatLog');
const thinkingRow = document.getElementById('thinkingRow');
const chatInput = document.getElementById('chatInput');
const noteInput = document.getElementById('noteInput');
const toggleDark = document.getElementById('toggleDark');
const toggleLock = document.getElementById('toggleLock');
const toggleReminder = document.getElementById('toggleReminder');
const aiEndpoint = document.getElementById('aiEndpoint');
const aiModel = document.getElementById('aiModel');
const aiKey = document.getElementById('aiKey');
const importFile = document.getElementById('importFile');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function applyTheme() {
  if (state.dark) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
}

/* ---------- render ---------- */
function render() {
  nextActionEl.textContent = nextAction(state);
  renderRadar(); renderBusiness(); renderWatchScreen(); renderMoney(); renderChat(); renderNotes(); renderSettings();
  applyTheme();
}

function renderRadar() {
  document.getElementById('radarOpen').textContent = state.missions.filter(m => !m.done).length;
  document.getElementById('radarDone').textContent = state.missions.filter(m => m.done).length;
  const list = document.getElementById('radarList');
  if (!state.missions.length) { list.innerHTML = emptyHTML('Aucune mission', 'Ajoute la première chose à faire.'); return; }
  const sorted = [...state.missions].sort((a, b) => Number(a.done) - Number(b.done) || b.priority - a.priority);
  list.innerHTML = sorted.map(m => `
    <div class="item">
      <div class="check ${m.done ? 'done' : ''}" data-check="mission:${m.id}">${checkSvg}</div>
      <div class="item-body">
        <div class="item-title ${m.done ? 'done' : ''}">${esc(m.title)}</div>
        <div class="item-meta">${m.category ? esc(m.category) + ' · ' : ''}Priorité ${m.priority}/5${m.due ? ' · ' + esc(m.due) : ''}</div>
      </div>
      <button class="icon-btn" data-del="mission:${m.id}" aria-label="Supprimer">${trashSvg}</button>
    </div>`).join('');
}

function renderBusiness() {
  document.getElementById('bizCount').textContent = state.deals.length;
  const weighted = state.deals.reduce((s, d) => s + d.value * d.probability, 0);
  document.getElementById('bizValue').textContent = formatEUR(weighted);
  const list = document.getElementById('bizList');
  if (!state.deals.length) { list.innerHTML = emptyHTML('Aucune opportunité', 'Ajoute un deal à suivre.'); return; }
  const sorted = [...state.deals].sort((a, b) => b.value * b.probability - a.value * a.probability);
  list.innerHTML = sorted.map(d => `
    <div class="item">
      <div class="item-body">
        <div class="item-title">${esc(d.title)}</div>
        <div class="item-meta">${STAGE_LABELS[d.stage] || d.stage} · ${Math.round(d.probability * 100)}% · ${formatEUR(d.value)}</div>
      </div>
      <div class="item-score">${formatEUR(d.value * d.probability)}</div>
      <button class="icon-btn" data-del="deal:${d.id}" aria-label="Supprimer">${trashSvg}</button>
    </div>`).join('');
}

function renderWatchScreen() {
  const list = document.getElementById('watchList');
  if (!state.watches.length) { list.innerHTML = emptyHTML('Aucun concept', 'Dessine ta prochaine montre.'); return; }
  const sorted = [...state.watches].sort((a, b) => scoreWatch(b) - scoreWatch(a));
  list.innerHTML = sorted.map(w => `
    <div class="item">
      <div class="item-body">
        <div class="item-title">${esc(w.name)}</div>
        <div class="item-meta">${esc(w.movement || '—')} · ${esc(w.accentStyle || 'Steel')} · marge ${formatEUR((w.targetPrice || 0) - (w.estimatedCost || 0))}</div>
      </div>
      <div class="item-score">${scoreWatch(w).toFixed(0)}</div>
      <button class="icon-btn" data-del="watch:${w.id}" aria-label="Supprimer">${trashSvg}</button>
    </div>`).join('');
}

function renderMoney() {
  const inSum = state.cash.filter(c => c.income).reduce((s, c) => s + c.amount, 0);
  const outSum = state.cash.filter(c => !c.income).reduce((s, c) => s + c.amount, 0);
  const bal = inSum - outSum;
  document.getElementById('moneyBalance').textContent = formatEUR(bal);
  document.getElementById('moneyIn').textContent = formatEUR(inSum);
  document.getElementById('moneyOut').textContent = formatEUR(outSum);
  document.getElementById('moneyBalanceCard').className = 'stat ' + (bal < 0 ? 'bad' : 'good');
  const list = document.getElementById('moneyList');
  if (!state.cash.length) { list.innerHTML = emptyHTML('Aucun mouvement', 'Ajoute une entrée ou une sortie.'); return; }
  const sorted = [...state.cash].reverse();
  list.innerHTML = sorted.map(c => `
    <div class="item">
      <div class="item-body">
        <div class="item-title">${esc(c.title)}</div>
        <div class="item-meta">${esc(c.category || '—')}</div>
      </div>
      <div class="item-score" style="color:${c.income ? 'var(--good)' : 'var(--bad)'}">${c.income ? '+' : '-'}${formatEUR(c.amount)}</div>
      <button class="icon-btn" data-del="cash:${c.id}" aria-label="Supprimer">${trashSvg}</button>
    </div>`).join('');
}

function renderChat() {
  chatLog.innerHTML = state.alphonseHistory.map(t => `
    <div class="bubble-row ${t.role === 'user' ? 'user' : 'alphonse'}">
      <div class="bubble">
        ${t.role !== 'user' && t.source ? `<div class="bubble-source">${esc(t.source)}</div>` : ''}
        ${esc(t.text).replace(/\n/g, '<br>')}
      </div>
    </div>`).join('');
  const screen = document.getElementById('screen-brain');
  if (!screen.hidden) mainEl.scrollTop = mainEl.scrollHeight;
}

function renderNotes() {
  const list = document.getElementById('noteList');
  if (!state.brain.length) { list.innerHTML = ''; return; }
  list.innerHTML = [...state.brain].reverse().map((n, i) => {
    const realIndex = state.brain.length - 1 - i;
    return `<div class="card" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
      <div style="font-size:14px;">${esc(n)}</div>
      <button class="icon-btn" data-delnote="${realIndex}" aria-label="Supprimer">${trashSvg}</button>
    </div>`;
  }).join('');
}

function renderSettings() {
  toggleDark.checked = state.dark;
  toggleLock.checked = state.lockEnabled;
  toggleReminder.checked = state.dailyReminder;
  document.querySelectorAll('#aiModeChips .chip').forEach(b => b.classList.toggle('on', b.dataset.mode === state.ai.mode));
  aiEndpoint.value = state.ai.endpoint;
  aiModel.value = state.ai.model;
  aiKey.value = state.ai.key;
}

/* ---------- tabs ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== `screen-${name}`; });
  mainEl.scrollTop = 0;
  if (name === 'brain') renderChat();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
document.getElementById('btnSettings').addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== 'screen-settings'; });
  mainEl.scrollTop = 0;
});

/* ---------- item actions (delegation) ---------- */
mainEl.addEventListener('click', (e) => {
  const chk = e.target.closest('[data-check]');
  if (chk) { const [type, id] = chk.dataset.check.split(':'); toggleCheck(type, id); return; }
  const del = e.target.closest('[data-del]');
  if (del) { const [type, id] = del.dataset.del.split(':'); deleteItem(type, id); return; }
  const delnote = e.target.closest('[data-delnote]');
  if (delnote) { state.brain.splice(Number(delnote.dataset.delnote), 1); save(); renderNotes(); return; }
  const add = e.target.closest('[data-add]');
  if (add) { openSheet(add.dataset.add); }
});

function toggleCheck(type, id) {
  if (type === 'mission') { const m = state.missions.find(x => x.id === id); if (m) m.done = !m.done; }
  save(); renderRadar(); nextActionEl.textContent = nextAction(state);
}
function deleteItem(type, id) {
  if (type === 'mission') state.missions = state.missions.filter(x => x.id !== id);
  if (type === 'deal') state.deals = state.deals.filter(x => x.id !== id);
  if (type === 'watch') state.watches = state.watches.filter(x => x.id !== id);
  if (type === 'cash') state.cash = state.cash.filter(x => x.id !== id);
  save(); render();
}

/* ---------- add sheet ---------- */
function chipVal(rowId) {
  const on = document.querySelector(`#${rowId} .chip.on`);
  return on ? on.dataset.val : null;
}
function wireChipRows() {
  sheet.querySelectorAll('.chip-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      b.classList.add('on');
    });
  });
}
function closeSheet() { sheetBackdrop.hidden = true; sheet.innerHTML = ''; }
sheetBackdrop.addEventListener('click', (e) => { if (e.target === sheetBackdrop) closeSheet(); });

function openSheet(type) {
  const forms = {
    mission: `
      <div class="sheet-handle"></div><div class="sheet-title">Nouvelle mission</div>
      <div class="field"><label>Titre</label><input type="text" id="f_title" placeholder="Ce qu'il faut faire"></div>
      <div class="field"><label>Catégorie</label><input type="text" id="f_category" placeholder="Optionnel"></div>
      <div class="field"><label>Priorité</label><div class="chip-row" id="f_priority">${[1, 2, 3, 4, 5].map(p => `<button class="chip ${p === 3 ? 'on' : ''}" data-val="${p}">${p}</button>`).join('')}</div></div>
      <div class="field"><label>Échéance</label><input type="text" id="f_due" placeholder="Optionnel, ex : vendredi"></div>
      <button class="btn" id="f_submit">Ajouter</button>`,
    deal: `
      <div class="sheet-handle"></div><div class="sheet-title">Nouvelle opportunité</div>
      <div class="field"><label>Titre</label><input type="text" id="f_title" placeholder="Nom du deal"></div>
      <div class="field"><label>Valeur estimée (€)</label><input type="number" id="f_value" placeholder="0"></div>
      <div class="field"><label>Probabilité</label><div class="chip-row" id="f_probability">${[0.2, 0.4, 0.6, 0.8, 1].map(p => `<button class="chip ${p === 0.4 ? 'on' : ''}" data-val="${p}">${Math.round(p * 100)}%</button>`).join('')}</div></div>
      <div class="field"><label>Étape</label><div class="chip-row" id="f_stage">${Object.entries(STAGE_LABELS).map(([k, l]) => `<button class="chip ${k === 'lead' ? 'on' : ''}" data-val="${k}">${l}</button>`).join('')}</div></div>
      <button class="btn" id="f_submit">Ajouter</button>`,
    watch: `
      <div class="sheet-handle"></div><div class="sheet-title">Nouveau concept</div>
      <div class="field"><label>Nom</label><input type="text" id="f_name" placeholder="Nom du concept"></div>
      <div class="field"><label>Mouvement</label><input type="text" id="f_movement" placeholder="NH35, quartz…"></div>
      <div class="field"><label>Style</label><div class="chip-row" id="f_accent">${['Steel', 'Gold', 'Black', 'Bronze'].map(a => `<button class="chip ${a === 'Steel' ? 'on' : ''}" data-val="${a}">${a}</button>`).join('')}</div></div>
      <div class="field"><label>Prix cible (€)</label><input type="number" id="f_price" placeholder="0"></div>
      <div class="field"><label>Coût estimé (€)</label><input type="number" id="f_cost" placeholder="0"></div>
      <div class="field"><label>Originalité (0-100)</label><input type="number" id="f_orig" placeholder="70"></div>
      <div class="field"><label>ADN marque (0-100)</label><input type="number" id="f_fit" placeholder="70"></div>
      <button class="btn" id="f_submit">Ajouter</button>`,
    cash: `
      <div class="sheet-handle"></div><div class="sheet-title">Mouvement</div>
      <div class="field"><label>Libellé</label><input type="text" id="f_title" placeholder="Ex : facture, prime…"></div>
      <div class="field"><label>Montant (€)</label><input type="number" id="f_amount" placeholder="0"></div>
      <div class="field"><label>Catégorie</label><input type="text" id="f_category" placeholder="Optionnel"></div>
      <div class="field"><label>Type</label><div class="chip-row" id="f_income"><button class="chip on" data-val="false">Sortie</button><button class="chip" data-val="true">Entrée</button></div></div>
      <button class="btn" id="f_submit">Ajouter</button>`
  };
  sheet.innerHTML = forms[type] || '';
  wireChipRows();
  document.getElementById('f_submit').addEventListener('click', () => submitSheet(type));
  sheetBackdrop.hidden = false;
}

function submitSheet(type) {
  if (type === 'mission') {
    const title = document.getElementById('f_title').value.trim();
    if (!title) return toast('Titre requis');
    state.missions.push({ id: uid(), title, done: false, priority: Number(chipVal('f_priority')) || 3, category: document.getElementById('f_category').value.trim(), due: document.getElementById('f_due').value.trim() });
  } else if (type === 'deal') {
    const title = document.getElementById('f_title').value.trim();
    if (!title) return toast('Titre requis');
    state.deals.push({ id: uid(), title, value: Number(document.getElementById('f_value').value) || 0, probability: Number(chipVal('f_probability')) || 0.4, stage: chipVal('f_stage') || 'lead' });
  } else if (type === 'watch') {
    const name = document.getElementById('f_name').value.trim();
    if (!name) return toast('Nom requis');
    state.watches.push({
      id: uid(), name, movement: document.getElementById('f_movement').value.trim(), accentStyle: chipVal('f_accent') || 'Steel',
      targetPrice: Number(document.getElementById('f_price').value) || 0, estimatedCost: Number(document.getElementById('f_cost').value) || 0,
      originality: Number(document.getElementById('f_orig').value) || 70, brandFit: Number(document.getElementById('f_fit').value) || 70
    });
  } else if (type === 'cash') {
    const title = document.getElementById('f_title').value.trim();
    if (!title) return toast('Libellé requis');
    state.cash.push({ id: uid(), title, amount: Math.abs(Number(document.getElementById('f_amount').value) || 0), category: document.getElementById('f_category').value.trim(), income: chipVal('f_income') === 'true' });
  }
  save(); render(); closeSheet(); toast('Ajouté');
}

/* ---------- chat / notes ---------- */
async function sendChat() {
  const q = chatInput.value.trim();
  if (!q) return;
  chatInput.value = '';
  state.alphonseHistory.push({ id: uid(), role: 'user', text: q, ts: Date.now() });
  save(); renderChat();
  thinkingRow.hidden = false;
  const reply = await askAlphonse(q, state);
  thinkingRow.hidden = true;
  state.alphonseHistory.push({ id: uid(), role: 'alphonse', text: reply.text, source: reply.source, ts: Date.now() });
  if (state.alphonseHistory.length > 120) state.alphonseHistory = state.alphonseHistory.slice(-120);
  save(); renderChat();
}
document.getElementById('btnSend').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

document.getElementById('btnSaveNote').addEventListener('click', () => {
  const t = noteInput.value.trim();
  if (!t) return;
  state.brain.push(t);
  if (state.brain.length > 200) state.brain = state.brain.slice(-200);
  noteInput.value = '';
  save(); renderNotes(); toast('Enregistré');
});

/* ---------- settings ---------- */
toggleDark.addEventListener('change', () => { state.dark = toggleDark.checked; save(); applyTheme(); });

document.getElementById('aiModeChips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.ai.mode = b.dataset.mode; renderSettings();
});
document.getElementById('btnSaveAi').addEventListener('click', () => {
  state.ai.endpoint = aiEndpoint.value.trim();
  state.ai.model = aiModel.value.trim();
  state.ai.key = aiKey.value.trim();
  save(); toast('Réglages IA enregistrés');
});

document.getElementById('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `nova-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnImport').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      state = Object.assign(defaultState(), imported);
      save(); render(); toast('Sauvegarde importée');
    } catch { toast('Fichier invalide'); }
  };
  reader.readAsText(file);
  importFile.value = '';
});
document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('Tout effacer ? Cette action est irréversible.')) return;
  state = defaultState(); save(); render(); toast('Réinitialisé');
});

/* ---------- rappel quotidien (best-effort, app ouverte uniquement) ---------- */
toggleReminder.addEventListener('change', async () => {
  state.dailyReminder = toggleReminder.checked;
  if (state.dailyReminder && 'Notification' in window) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications refusées par le navigateur'); state.dailyReminder = false; toggleReminder.checked = false; }
  }
  save();
});
function checkDailyReminder() {
  if (!state.dailyReminder) return;
  const today = new Date().toDateString();
  if (state.lastReminderDate === today) return;
  state.lastReminderDate = today;
  save();
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('NOVA', { body: nextAction(state), icon: 'icons/icon-192.png' });
  }
}

/* ---------- verrou (WebAuthn si dispo, sinon code PIN local) ---------- */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function abToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToAb(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }

async function registerBiometric() {
  if (!window.PublicKeyCredential) return null;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();
    if (!available) return null;
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'NOVA' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'nova-local', displayName: 'NOVA' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000
      }
    });
    return cred ? abToB64(cred.rawId) : null;
  } catch (e) { console.warn('WebAuthn indisponible', e); return null; }
}
async function verifyBiometric(credIdB64) {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b64ToAb(credIdB64), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    return !!assertion;
  } catch { return false; }
}
function promptPinSetup() {
  return new Promise((resolve) => {
    sheet.innerHTML = `
      <div class="sheet-handle"></div><div class="sheet-title">Choisis un code à 4 chiffres</div>
      <div class="field"><input type="password" inputmode="numeric" maxlength="4" id="f_pin" placeholder="••••"></div>
      <button class="btn" id="f_submit">Valider</button>`;
    sheetBackdrop.hidden = false;
    document.getElementById('f_submit').addEventListener('click', () => {
      const v = document.getElementById('f_pin').value.trim();
      closeSheet();
      resolve(/^\d{4}$/.test(v) ? v : null);
    });
  });
}
async function setupLock() {
  const credId = await registerBiometric();
  if (credId) {
    state.lockEnabled = true; state.lockMethod = 'webauthn'; state.lockCredentialId = credId; state.pinHash = null;
    save(); toast('Verrou activé (empreinte / Face ID)');
    return;
  }
  const pin = await promptPinSetup();
  if (!pin) { toggleLock.checked = false; return; }
  state.lockEnabled = true; state.lockMethod = 'pin'; state.pinHash = await sha256(pin); state.lockCredentialId = null;
  save(); toast('Verrou activé (code)');
}
toggleLock.addEventListener('change', () => {
  if (toggleLock.checked) setupLock();
  else { state.lockEnabled = false; state.lockMethod = null; state.lockCredentialId = null; state.pinHash = null; save(); }
});

let pinBuffer = '';
function buildKeypad() {
  pinKeypad.innerHTML = '';
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach((k) => {
    const b = document.createElement('button');
    b.textContent = k;
    if (!k) b.style.visibility = 'hidden';
    else b.addEventListener('click', () => handlePinKey(k));
    pinKeypad.appendChild(b);
  });
}
function updatePinDots() { pinDots.querySelectorAll('span').forEach((s, i) => s.classList.toggle('filled', i < pinBuffer.length)); }
async function handlePinKey(k) {
  if (k === '⌫') { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += k; updatePinDots();
  if (pinBuffer.length === 4) {
    const hash = await sha256(pinBuffer);
    if (hash === state.pinHash) unlockApp();
    else { lockSub.textContent = 'Code incorrect'; setTimeout(() => { pinBuffer = ''; updatePinDots(); lockSub.textContent = 'Entre ton code'; }, 500); }
  }
}
function unlockApp() { lockScreen.hidden = true; checkDailyReminder(); }
async function tryUnlock() {
  if (state.lockMethod === 'webauthn' && state.lockCredentialId) {
    const ok = await verifyBiometric(state.lockCredentialId);
    if (ok) unlockApp();
    else lockSub.textContent = 'Authentification échouée — réessaie';
  }
}
btnBioUnlock.addEventListener('click', tryUnlock);

function bootLock() {
  if (!state.lockEnabled) { checkDailyReminder(); return; }
  lockScreen.hidden = false;
  if (state.lockMethod === 'pin') {
    pinDots.hidden = false; pinKeypad.hidden = false; btnBioUnlock.hidden = true;
    buildKeypad(); lockSub.textContent = 'Entre ton code';
  } else {
    tryUnlock();
  }
}

/* ---------- boot ---------- */
render();
bootLock();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
