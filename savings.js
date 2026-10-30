'use strict';
/* ---------- savings: funds (копилки), each topped up / withdrawn by hand ---------- */
S.sav = S.sav || [];
const bal = f => f.ops.reduce((s, o) => s + o.amount, 0);   // kept in SAR; each op also remembers what was typed
let openFund = null;

// SAR per unit; USD is pegged. RUB: a USD→RUB rate the user typed (e.g. from Google) wins;
// otherwise the market mid-rate, refreshed every 6 h when online (two sources, the last known one offline)
S.rates = S.rates || { USD: 3.75, RUB: 0.047, t: 0 };
const applyManual = () => { if (S.rates.manualUsdRub) S.rates.RUB = S.rates.USD / S.rates.manualUsdRub; };
applyManual();
const SAV_CUR = ['SAR', 'USD', 'RUB'];
const toSar = (v, c) => c === 'SAR' ? v : v * S.rates[c];
const fromSar = (v, c) => c === 'SAR' ? v : v / S.rates[c];
const n2 = v => (Math.round(v * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: v >= 1000 ? 0 : 2 });
const tri = v => SAV_CUR.map(c => n2(fromSar(v, c)) + ' ' + c).join(' · ');
function refreshRates() {
  if (S.rates.manualUsdRub) return;
  const set = (usdRub, src) => { if (!(usdRub > 1)) return false; S.rates = { USD: 3.75, RUB: 3.75 / usdRub, t: Date.now(), src }; save(); renderSav(); return true; };
  fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json').then(r => r.json())
    .then(j => set(j && j.usd && j.usd.rub, 'рыночный'))
    .catch(() => false)
    .then(ok => ok || fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json()).then(j => set(j && j.rates && j.rates.RUB, 'рыночный')))
    .catch(() => {});
}
if (Date.now() - S.rates.t > 6 * 36e5) refreshRates();

function renderSav() {
  const funds = S.sav, total = funds.reduce((s, f) => s + bal(f), 0);
  $('v-total').innerHTML = SAV_CUR.map(c => `<div>${n2(fromSar(total, c))} ${c}</div>`).join('')
    + `<small class="mut" style="font-weight:400">1 USD = ${n2(S.rates.USD)} SAR · <b>1 USD = ${n2(S.rates.USD / S.rates.RUB)} RUB</b>
       ${S.rates.manualUsdRub ? '· ваш курс' : S.rates.t ? '· рыночный от ' + new Date(S.rates.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '· примерный'}
       <button class="del" style="color:var(--acc);font-size:13px" id="v-rate">изменить курс</button></small>`;

  // share of each fund
  const arr = funds.map((f, i) => [f, bal(f), COLORS[i % COLORS.length]]).filter(x => x[1] > 0);
  const sum = arr.reduce((s, x) => s + x[1], 0);
  let ang = -Math.PI / 2, d = '';
  const p = (r, t) => (100 + r * Math.cos(t)).toFixed(2) + ' ' + (100 + r * Math.sin(t)).toFixed(2);
  arr.forEach(([f, v, c]) => {
    const fr = v / sum, a2 = ang + fr * Math.PI * 2, big = fr > .5 ? 1 : 0;
    d += fr >= .9999 ? `<circle cx="100" cy="100" r="70" fill="none" stroke="${c}" stroke-width="40"/>`
      : `<path data-f="${f.id}" d="M${p(90, ang)} A90 90 0 ${big} 1 ${p(90, a2)} L${p(50, a2)} A50 50 0 ${big} 0 ${p(50, ang)}Z" fill="${c}"/>`;
    ang = a2;
  });
  d += `<text x="100" y="104" text-anchor="middle" style="font-size:15px;fill:var(--fg);font-weight:600">${sum ? fmt(sum) : 'пусто'}</text>`;
  $('v-donut').innerHTML = d;
  $('v-legend').innerHTML = arr.map(([f, v, c]) => `<div data-f="${f.id}"><i style="background:${c}"></i>${esc(f.name)}<span class="mut">${Math.round(v / sum * 100)}%</span><span class="v">${tri(v)}</span></div>`).join('');

  $('v-list').innerHTML = funds.length ? funds.map(f => {
    const b = bal(f), pct = f.goal ? Math.min(100, Math.round(b / f.goal * 100)) : null;
    return `<div class="row"><div style="flex:1"><div data-f="${f.id}" style="cursor:pointer">${esc(f.name)}</div>
      <div class="m">${tri(b)}${f.goal ? ` · цель ${fmt(f.goal)} · ${pct}%` : ''}</div>
      ${f.goal ? `<div style="height:5px;background:var(--line);border-radius:3px;margin-top:4px"><div style="width:${pct}%;height:5px;background:var(--acc);border-radius:3px"></div></div>` : ''}</div>
      <button class="del" style="color:#16a34a" data-plus="${f.id}">＋</button><button class="del" data-minus="${f.id}">－</button></div>`;
  }).join('') : '<p class="mut">Создайте первую копилку ниже</p>';

  const f = funds.find(x => x.id === openFund);
  $('v-hist').style.display = f ? '' : 'none';
  if (f) $('v-hist').innerHTML = `<h3>${esc(f.name)} — история</h3>` +
    (f.ops.slice().reverse().map(o => `<div class="row"><div>${esc(o.note || (o.amount > 0 ? 'Пополнение' : 'Снятие'))}<div class="m">${new Date(o.date).toLocaleDateString('ru-RU')}</div></div>
      <b class="${o.amount > 0 ? 'inc' : ''}">${o.amount > 0 ? '+' : '−'}${o.cur && o.cur !== 'SAR' ? n2(Math.abs(o.orig)) + ' ' + o.cur + ' <span class="m">(' + fmt(Math.abs(o.amount)) + ')</span>' : fmt(Math.abs(o.amount))}</b><button class="del" data-dop="${o.id}">×</button></div>`).join('') || '<p class="mut">Операций нет</p>') +
    `<div class="grid2"><button class="btn ghost" data-ren="${f.id}">Переименовать / цель</button><button class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-delf="${f.id}">Удалить копилку</button></div>`;
}

// top-up / withdrawal sheet: amount, currency (SAR by default), comment
const curSel = id => `<select id="${id}" style="width:auto">${SAV_CUR.map(c => `<option${c === 'SAR' ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
// «изменить курс»: type 1 USD = … RUB (as Google shows it); empty = back to the market rate
document.addEventListener('click', e => {
  if (e.target.id !== 'v-rate') return;
  const cur = n2(S.rates.USD / S.rates.RUB).replace(/\s/g, '');
  const a = prompt('1 USD = … RUB (впишите курс из Google). Пусто — снова рыночный курс', S.rates.manualUsdRub || cur);
  if (a === null) return;
  const v = parseFloat(a.replace(',', '.').replace(/[^\d.]/g, ''));
  if (v > 1) { S.rates.manualUsdRub = v; applyManual(); } else { delete S.rates.manualUsdRub; S.rates.t = 0; refreshRates(); }
  save(); renderSav();
});

function move(id, sign) {
  const f = S.sav.find(x => x.id === id); if (!f) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:#0007;z-index:20;display:flex;align-items:flex-end';
  box.innerHTML = `<div class="card" style="width:100%;margin:0;border-radius:16px 16px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom))">
    <h3>${sign > 0 ? 'Пополнить' : 'Снять из'} «${esc(f.name)}»</h3>
    <div style="display:flex;gap:8px"><input id="m-v" type="number" inputmode="decimal" placeholder="Сумма" style="flex:1">${curSel('m-c')}</div>
    <input id="m-n" placeholder="Комментарий (необязательно)">
    <div class="m" id="m-eq"></div>
    <button class="btn" id="m-ok">${sign > 0 ? 'Пополнить' : 'Снять'}</button><button class="btn ghost" id="m-x">Отмена</button></div>`;
  document.body.appendChild(box);
  const q = s => box.querySelector(s);
  const eq = () => { const v = parseFloat(q('#m-v').value) || 0, c = q('#m-c').value; q('#m-eq').textContent = v ? '= ' + tri(toSar(v, c)) : ''; };
  q('#m-v').oninput = q('#m-c').onchange = eq; q('#m-v').focus();
  q('#m-x').onclick = () => box.remove();
  box.onclick = e => { if (e.target === box) box.remove(); };
  q('#m-ok').onclick = () => {
    const v = parseFloat(String(q('#m-v').value).replace(',', '.')), cur = q('#m-c').value;
    if (!(v > 0)) return q('#m-v').focus();
    f.ops.push({ id: uid(), date: new Date().toISOString(), amount: sign * Math.round(toSar(v, cur) * 100) / 100, orig: sign * v, cur, note: q('#m-n').value.trim() });
    box.remove(); save(); renderSav(); if (window.renderCash) renderCash();
  };
}

$('v-add').onclick = () => {
  const name = $('v-name').value.trim(); if (!name) return alert('Название копилки');
  const goal = Math.round(toSar(parseFloat($('v-goal').value) || 0, $('v-gcur').value) * 100) / 100;   // the goal is kept in SAR
  S.sav.push({ id: uid(), name, goal, ops: [] }); save();
  $('v-name').value = $('v-goal').value = ''; $('v-gcur').value = 'SAR'; renderSav();
};
document.getElementById('t-sav').onclick = e => {
  const t = e.target.closest('[data-plus],[data-minus],[data-f],[data-dop],[data-ren],[data-delf]'); if (!t) return;
  const ds = t.dataset;
  if (ds.plus) move(ds.plus, 1);
  else if (ds.minus) move(ds.minus, -1);
  else if (ds.f) { openFund = openFund === ds.f ? null : ds.f; renderSav(); }
  else if (ds.dop) { const f = S.sav.find(x => x.id === openFund); if (confirm('Удалить запись?')) { f.ops = f.ops.filter(o => o.id !== ds.dop); save(); renderSav(); } }
  else if (ds.ren) { const f = S.sav.find(x => x.id === ds.ren); const n = prompt('Название', f.name); if (n) f.name = n.trim();
    const g = prompt('Цель (пусто — без цели)', f.goal || ''); f.goal = parseFloat(g) || 0; save(); renderSav(); }
  else if (ds.delf) { const f = S.sav.find(x => x.id === ds.delf); if (confirm(`Удалить копилку «${f.name}» со всей историей?`)) { S.sav = S.sav.filter(x => x !== f); openFund = null; save(); renderSav(); } }
};
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.t === 'sav') renderSav(); });
renderSav();
