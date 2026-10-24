'use strict';
/* ---------- screenshots of SMS → text (OCR on the phone) → review → transactions ---------- */
const OCR_LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
// a line that opens a new bank message
const HEAD = /^(international\s+pos|pos purchase|online purchase|outgoing transfer|incoming transfer|credit transfer|bill payment|transaction reversal|purchase|one time password|otp code|reason:|you are successfully|dear customer|شراء|إيداع|تحويل)/i;
// iOS chrome around the bubbles: clock, headers, day separators, input box
const NOISE = /^(\d{1,2}:\d{2}|messages|see all|text message.*|.*in messages|today.*|yesterday.*|(mon|tues|wednes|thurs|fri|satur|sun)day.*|\d{1,2}\/\d{1,2}\/\d{4}|[<>©@®]+)$/i;

let pend = [];   // [{t, use}]

function srcOptions() {
  const names = [...new Set(S.sources.map(s => s.name))];
  $('o-src').innerHTML = '<option value="">Определить по скриншоту</option>' + names.map(n => `<option>${esc(n)}</option>`).join('');
}

function loadOcr() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = OCR_LIB; s.onload = ok; s.onerror = () => bad(new Error('нет интернета для загрузки распознавания')); document.head.appendChild(s); });
}

function splitMessages(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !NOISE.test(l));
  const out = []; let cur = [];
  for (const l of lines) { if (HEAD.test(l) && cur.length) { out.push(cur.join('\n')); cur = []; } cur.push(l); }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

function senderOf(text) {
  // the conversation title (a line that is just the bank's name)
  for (const l of text.split(/\r?\n/)) {
    const w = l.trim().replace(/[^\p{L}\d ]/gu, '').trim().toLowerCase();
    const s = S.sources.find(s => s.name.toLowerCase() === w);
    if (s) return s.name;
  }
  return '';
}

$('o-file').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const st = $('o-status');
  try {
    st.textContent = 'Загружаю распознавание…'; await loadOcr();
    const w = await Tesseract.createWorker('eng');
    const found = [];
    for (let i = 0; i < files.length; i++) {
      st.textContent = `Распознаю ${i + 1} из ${files.length}…`;
      const { data: { text } } = await w.recognize(files[i]);
      const from = $('o-src').value || senderOf(text);
      const got = splitMessages(text).map(b => parseSms(b, from)).filter(Boolean);
      // one screenshot = one conversation: messages that named no bank take the bank the others named
      const known = new Set(S.sources.map(s => s.name)), cnt = {};
      got.forEach(t => { if (known.has(t.source)) cnt[t.source] = (cnt[t.source] || 0) + 1; });
      const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      if (top) got.forEach(t => { if (!known.has(t.source)) t.source = top; });
      found.push(...got);
    }
    await w.terminate();
    st.textContent = `Найдено операций: ${found.length}`;
    review(found);
  } catch (err) { st.textContent = 'Ошибка: ' + err.message; }
  e.target.value = '';
};

// pasted SMS go through the same review
$('s-parse').onclick = () => {
  const found = [];
  $('s-text').value.split(/\n\s*\n|\s*#{3,}\s*/).forEach(block => {
    let from = '', text = block.trim(); const m = text.match(/^(?:от|from)\s*:\s*(.+)\n/i);
    if (m) { from = m[1].trim(); text = text.slice(m[0].length); }
    const t = parseSms(text, from); if (t) found.push(t);
  });
  $('s-text').value = '';
  $('s-out').innerHTML = found.length ? '' : '<p class="mut">Операций не найдено</p>';
  review(found);
};

function review(list, skipped = []) {
  const seen = new Set();
  pend = list.filter(t => { const k = t.amount + '|' + t.date.slice(0, 16); if (seen.has(k)) return false; seen.add(k); return true; })
    // a code-only purchase is dropped when the real purchase SMS (same amount, within a day) is there too
    .filter(t => t.kind !== 'otp' || !list.concat(S.tx).some(x => x !== t && x.kind !== 'otp' && !x.income && !isXfer(x) && Math.abs(x.amount) === t.amount && Math.abs(new Date(x.date) - new Date(t.date)) < 864e5))
    .map(t => ({ t, use: !isDup(t) && t.kind !== 'otp' }));
  if (!pend.length) { $('review').style.display = 'none'; return; }
  const known = new Set(S.sources.map(s => s.name));
  const uSrc = [...new Set(pend.map(p => p.t.source).filter(s => !known.has(s)))];
  const rulesHit = m => S.rules.some(r => r.key.split('|').some(k => k.trim() && m.toLowerCase().includes(k.trim().toLowerCase())));
  const uCat = [...new Set(pend.filter(p => !p.t.income && !isInfo(p.t) && !isXfer(p.t) && p.t.merchant && !rulesHit(p.t.merchant)).map(p => p.t.merchant))];
  const catOf = m => (pend.find(p => p.t.merchant === m) || {}).t.category;
  const srcList = [...known].map(n => `<option value="${esc(n)}">`).join('');
  $('review').style.display = '';
  $('review').innerHTML = `<h3>Проверка: ${pend.length} операций</h3>
    ${uSrc.length ? `<p class="mut">Неизвестные источники — что это?</p><datalist id="dl-known">${srcList}</datalist>` + uSrc.map(s =>
      `<div class="grid2"><div style="padding-top:14px">${esc(s)}</div><input data-us="${esc(s)}" list="dl-known" placeholder="напр. anb"></div>`).join('') : ''}
    ${uCat.length ? '<p class="mut">Новые магазины / получатели — какая категория? (запомнится)</p>' + uCat.map(m =>
      `<div class="grid2" data-urow="${esc(m)}"><div style="padding-top:14px"><button class="del" data-drop="${esc(m)}" title="убрать">✕</button> ${esc(m)}</div><select data-uc="${esc(m)}" data-blank="— категория —">${catOptions(catOf(m) === 'Без категории' ? '' : catOf(m), '— категория —')}</select></div>`).join('') : ''}
    <div id="r-rows">${pend.map((p, i) => `<div class="row"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-i="${i}" ${p.use ? 'checked' : ''} style="width:auto;margin:0">
      <span>${catIcon(p.t.category)} ${esc(p.t.merchant || p.t.category)}<div class="m">${esc(p.t.category)}${p.t.kind === 'otp' ? ' · ⚠️ только код подтверждения — отметьте, если покупка была' : isInfo(p.t) || isXfer(p.t) ? ' (не трата)' : ''} · ${new Date(p.t.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(p.t.source)}${p.t.note ? ' · ' + esc(p.t.note) : ''}${isDup(p.t) ? ' · уже есть' : ''}</div></span></label>
      <b class="${p.t.income || p.t.amount < 0 ? 'inc' : ''}">${p.t.income || p.t.amount < 0 ? '+' : '−'}${fmt(Math.abs(p.t.amount))}</b></div>`).join('')}</div>
    ${skipped.length ? `<details style="margin:10px 0"><summary class="mut">Не распознано SMS: ${skipped.length} (коды, реклама, уведомления — проверьте, нет ли там трат)</summary>`
      + skipped.map(x => `<div class="m" style="border-bottom:1px solid var(--line);padding:6px 0;white-space:pre-wrap">${esc(x.slice(0, 160))}</div>`).join('') + '</details>' : ''}
    <button class="btn" id="r-go">Распределить и сохранить</button>
    <button class="btn ghost" id="r-cancel">Отмена</button>`;
  $('r-rows').onchange = e => { const i = e.target.dataset.i; if (i != null) pend[+i].use = e.target.checked; };
  $('review').onclick = e => {
    const m = e.target.dataset.drop; if (m == null) return;
    pend.forEach((p, i) => { if (p.t.merchant === m) { p.use = false; const c = document.querySelector(`#r-rows [data-i="${i}"]`); if (c) c.checked = false; } });
    e.target.closest('[data-urow]').remove();
  };
  $('r-cancel').onclick = () => { pend = []; $('review').style.display = 'none'; };
  $('r-go').onclick = commit;
}

function commit() {
  document.querySelectorAll('#review [data-us]').forEach(inp => {
    const orig = inp.dataset.us, name = inp.value.trim(); if (!name) return;
    const s = S.sources.find(s => s.name === name);
    if (s) { if (!s.key.split('|').includes(orig)) s.key += '|' + orig; } else S.sources.push({ name, key: orig, cat: '' });
    pend.forEach(p => { if (p.t.source === orig) p.t.source = name; });
  });
  document.querySelectorAll('#review [data-uc]').forEach(inp => {
    const m = inp.dataset.uc, cat = inp.value.trim(); if (!cat) return;
    S.rules.unshift({ key: m, cat });
    pend.forEach(p => { if (p.t.merchant === m) p.t.category = cat; });
  });
  let n = 0;
  pend.forEach(p => {
    if (!p.use || isDup(p.t)) return;
    if (p.t.kind === 'otp') { delete p.t.kind; p.t.note = 'по коду подтверждения'; }   // the user says the purchase happened
    if (isXfer(p.t)) { p.t.income = false; p.t.payTo = cardFor(p.t) || askCard(); }
    if (isInfo(p.t)) p.t.payTo = cardFor(p.t);
    S.tx.push(p.t); n++;
  });
  save(); pend = []; $('review').style.display = 'none';
  toast('Добавлено операций: ' + n); render(); renderSet(); srcOptions();
}

srcOptions();
