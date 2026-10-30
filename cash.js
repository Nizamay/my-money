'use strict';
/* ---------- Кэш: cash withdrawn since the last salary and where it went —
   savings (kept), family (spent by the family, counts as my expense), or spent by me ---------- */
S.family = S.family || [];
let openMember = null;

// the cash period: since the latest salary (default), this month, the last 3 months, or everything
const salaryDate = () => S.tx.filter(t => t.income && (t.raw ? /salary|راتب|зарплат/i.test(t.raw) : t.category === 'Зарплата')).map(t => new Date(t.date)).sort((a, b) => b - a)[0];
function cashStart() {
  const n = new Date(), per = S.cashPer || 'salary';
  if (per === 'all') return new Date(0);
  if (per === '3m') return new Date(n.getFullYear(), n.getMonth() - 2, 1);
  if (per === 'month') return new Date(n.getFullYear(), n.getMonth(), 1);
  return salaryDate() || new Date(n.getFullYear(), n.getMonth(), 1);
}
const cashPerLabel = () => ({ salary: salaryDate() ? 'с последней зарплаты' : 'с начала месяца (зарплаты ещё нет)', month: 'этот месяц', '3m': 'последние 3 месяца', all: 'всё время' })[S.cashPer || 'salary'];
const sinceStart = t => new Date(t.date) >= cashStart();
const cashIn = () => S.tx.filter(t => t.kind === 'cash' && sinceStart(t)).reduce((s, t) => s + t.amount, 0);
const toFamily = () => S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && sinceStart(t)).reduce((s, t) => s + t.amount, 0);
const spentMe = () => S.tx.filter(t => t.origin === 'cash' && t.category !== 'Семья' && sinceStart(t)).reduce((s, t) => s + t.amount, 0);
// money lent from cash: not spending — it is expected back; a returned loan is cash in hand again
S.loans = S.loans || [];
const lent = () => S.loans.filter(l => !l.txId && new Date(l.date) >= cashStart()).reduce((s, l) => s + l.amount, 0);
const returned = () => S.loans.filter(l => !l.txId && l.back && new Date(l.back) >= cashStart()).reduce((s, l) => s + l.amount, 0);
const toSavings = () => S.sav.reduce((s, f) => s + f.ops.filter(o => o.amount > 0 && o.cash !== false && new Date(o.date) >= cashStart()).reduce((a, o) => a + o.amount, 0), 0);

function renderCash() {
  const got = cashIn(), sav = toSavings(), fam = toFamily(), me = spentMe(), ln = lent(), rt = returned(), left = got + rt - sav - fam - me - ln;
  const salDate = cashStart().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const per = S.cashPer || 'salary';
  $('c-top').innerHTML = `<div class="seg" id="c-per" style="margin-bottom:8px">${[['salary', 'С зарплаты'], ['month', 'Месяц'], ['3m', '3 мес'], ['all', 'Всё']]
      .map(([k, l]) => `<button data-per="${k}" class="${k === per ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mut">${per === 'all' ? 'За всё время' : 'С ' + salDate} · ${cashPerLabel()}</div>
    <div class="mut">Снятий за период: ${S.tx.filter(t => t.kind === 'cash' && sinceStart(t)).length}</div>
    <div class="row"><span>💵 Снято кэша</span><b>${fmt(got)}</b></div>
    <div class="row"><span>🏦 В накопления</span><span>${fmt(sav)}</span></div>
    <div class="row"><span>👨‍👩‍👧 Семье</span><span>${fmt(fam)}</span></div>
    <div class="row"><span>🧍 Потратил сам</span><span>${fmt(me)}</span></div>
    <div class="row"><b>На руках, не распределено</b><b style="color:var(--acc)">${fmt(Math.max(0, left))}</b></div>
    ${left < -0.005 ? `<div class="m" style="color:#b45309">⚠️ Распределено на ${fmt(-left)} больше, чем снято за период: часть денег, видимо, из прошлого периода или не из снятого кэша. Выберите период шире или отметьте пополнение копилки как «не из снятого кэша».</div>` : ''}
    <div class="grid2"><button class="btn ghost" id="c-wd">＋ Снял кэш</button><button class="btn ghost" id="c-me">🧍 Потратил сам</button></div>`;

  // debts live with the savings: the money is still mine
  const open = S.loans.filter(l => !l.back);
  $('v-loans').innerHTML = `<h3>🤝 Мне должны</h3>` + (open.map(l =>
      `<div class="row"><div>${esc(l.who)}<div class="m">${new Date(l.date).toLocaleDateString('ru-RU')} · ${l.txId ? '🏦 банковский перевод' : '💵 кэш'}</div></div><b>${fmt(l.amount)}</b>
       <button class="btn" style="width:auto;padding:6px 12px;margin:0" data-back="${l.id}">Вернули</button><button class="del" data-dloan="${l.id}">×</button></div>`).join('')
    || '<p class="mut">Никто не должен</p>')
    + (open.length ? `<div class="m">Всего должны: ${fmt(open.reduce((s, l) => s + l.amount, 0))}</div>` : '')
    + '<button class="btn ghost" id="c-loan">🤝 Дал в долг</button>';

  // family members with what each got in this period
  $('f-list').innerHTML = S.family.map(m => {
    const got = S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name && sinceStart(t)).reduce((s, t) => s + t.amount, 0);
    return `<div class="row"><span data-m="${m.id}" style="cursor:pointer">${esc(m.name)}<div class="m">с зарплаты: ${fmt(got)}</div></span>
      <button class="btn" style="width:auto;padding:6px 14px;margin:0" data-give="${m.id}">Дать</button></div>`;
  }).join('') || '<p class="mut">Добавьте членов семьи</p>';
  const m = S.family.find(x => x.id === openMember);
  $('f-hist').style.display = m ? '' : 'none';
  if (m) $('f-hist').innerHTML = `<h3>${esc(m.name)} — история</h3>` + (S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name)
    .sort((a, b) => b.date.localeCompare(a.date)).map(t => `<div class="row"><div>${esc(t.note || 'кэш')}<div class="m">${new Date(t.date).toLocaleDateString('ru-RU')}</div></div>
      <b>${fmt(t.amount)}</b><button class="del" style="color:var(--acc)" data-etx="${t.id}">✎</button><button class="del" data-dtx="${t.id}">×</button></div>`).join('') || '<p class="mut">Пока ничего</p>')
    + `<button class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-delm="${m.id}">Удалить из списка</button>`;
}

// «Дал в долг»: from cash, or one of my bank transfers (it then stops counting as spending)
function loanSheet() {
  const linked = new Set(S.loans.map(l => l.txId).filter(Boolean));
  const xs = S.tx.filter(t => !t.income && !linked.has(t.id) && (t.category === 'Переводы' || /transfer/i.test(t.raw || '')) && t.amount > 0)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:#0007;z-index:20;display:flex;align-items:flex-end';
  box.innerHTML = `<div class="card" style="width:100%;margin:0;border-radius:16px 16px 0 0;max-height:85vh;overflow:auto;padding-bottom:calc(16px + env(safe-area-inset-bottom))">
    <h3>🤝 Дал в долг</h3>
    <input id="l-who" placeholder="Кому">
    <div class="seg" id="l-src"><button data-s="cash" class="on">💵 Из кэша</button><button data-s="bank">🏦 Банковский перевод</button></div>
    <div id="l-cash"><input id="l-v" type="number" inputmode="decimal" placeholder="Сумма, SAR"></div>
    <div id="l-bank" style="display:none"><p class="mut">Какой перевод — это долг?</p>${xs.map(t => `<label class="row" style="gap:8px"><input type="radio" name="l-tx" value="${t.id}" style="width:auto;margin:0">
      <span style="flex:1">${esc(t.merchant || t.note || t.category)}<div class="m">${new Date(t.date).toLocaleDateString('ru-RU')} · ${esc(t.source)}</div></span><b>${fmt(t.amount)}</b></label>`).join('') || '<p class="mut">Переводов нет</p>'}</div>
    <button class="btn" id="l-ok">Записать долг</button><button class="btn ghost" id="l-x">Отмена</button></div>`;
  document.body.appendChild(box);
  const q = s => box.querySelector(s); let src = 'cash';
  q('#l-src').onclick = e => { const b = e.target.closest('button'); if (!b) return; src = b.dataset.s;
    q('#l-src').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    q('#l-cash').style.display = src === 'cash' ? '' : 'none'; q('#l-bank').style.display = src === 'bank' ? '' : 'none'; };
  q('#l-bank').onchange = () => { const t = S.tx.find(x => x.id === (box.querySelector('[name=l-tx]:checked') || {}).value); if (t && !q('#l-who').value) q('#l-who').value = t.merchant || ''; };
  q('#l-x').onclick = () => box.remove();
  box.onclick = e => { if (e.target === box) box.remove(); };
  q('#l-ok').onclick = () => {
    const who = q('#l-who').value.trim(); if (!who) return q('#l-who').focus();
    if (src === 'cash') {
      const v = parseFloat(String(q('#l-v').value).replace(',', '.')); if (!(v > 0)) return q('#l-v').focus();
      S.loans.push({ id: uid(), who, amount: v, date: new Date().toISOString(), back: null });
    } else {
      const t = S.tx.find(x => x.id === (box.querySelector('[name=l-tx]:checked') || {}).value); if (!t) return;
      t.kind = 'loan'; t.category = 'В долг';
      S.loans.push({ id: uid(), who, amount: t.amount, date: t.date, back: null, txId: t.id });
    }
    box.remove(); save(); renderCash(); renderSav(); render();
  };
}

const askSum = q => { const v = parseFloat(String(prompt(q) || '').replace(',', '.').replace(/\s/g, '')); return v > 0 ? v : 0; };
const cashTx = (amount, category, merchant, note) => {
  S.tx.push({ id: uid(), date: new Date().toISOString(), amount, source: 'Кэш', category, merchant, note, origin: 'cash', income: false });
  save(); renderCash(); render();
};

$('c-seg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  $('c-seg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('c-sav').style.display = b.dataset.c === 'sav' ? '' : 'none';
  $('c-fam').style.display = b.dataset.c === 'fam' ? '' : 'none';
};
$('v-loans').onclick = $('c-top').onclick = e => {
  if (e.target.dataset.per) { S.cashPer = e.target.dataset.per; save(); renderCash(); return; }
  if (e.target.id === 'c-wd') {   // a withdrawal the bank sent no SMS about
    const v = askSum('Сколько сняли наличными?'); if (!v) return;
    S.tx.push({ id: uid(), date: new Date().toISOString(), amount: v, source: 'Кэш', category: 'Наличные', merchant: 'Снятие наличных', kind: 'cash', origin: 'manual', income: false });
    save(); renderCash(); render();
  }
  if (e.target.id === 'c-loan') return loanSheet();
  if (e.target.dataset.back) { const l = S.loans.find(x => x.id === e.target.dataset.back); if (confirm(`${l.who} вернул(а) ${fmt(l.amount)}?`)) { l.back = new Date().toISOString(); save(); renderCash(); renderSav(); } return; }
  if (e.target.dataset.dloan) {
    if (!confirm('Удалить запись о долге?')) return;
    const l = S.loans.find(x => x.id === e.target.dataset.dloan), t = l && l.txId && S.tx.find(x => x.id === l.txId);
    if (t) { delete t.kind; t.category = 'Переводы'; }   // the transfer becomes an ordinary transfer again
    S.loans = S.loans.filter(x => x !== l); save(); renderCash(); renderSav(); render(); return;
  }
  if (e.target.id === 'c-me') {
    const v = askSum('Сколько потратили из кэша?'); if (!v) return;
    const cats = allCats().filter(c => !['Семья', 'Наличные', 'Зарплата', 'Кешбэк', 'Поступления', 'Погашение кредитки', 'Счёт по кредитке', 'Блокировка (pending)'].includes(c));
    const a = prompt('Категория: ' + cats.map((c, i) => `${i + 1} ${c}`).join(', '), '1');
    const cat = cats[+a - 1] || 'Без категории';
    cashTx(v, cat, 'Кэш', prompt('На что? (необязательно)') || '');
  }
};
$('f-add').onclick = () => {
  const name = $('f-name').value.trim(); if (!name) return;
  S.family.push({ id: uid(), name }); save(); $('f-name').value = ''; renderCash();
};
$('c-fam').onclick = e => {
  const ds = e.target.dataset;
  if (ds.give) { const m = S.family.find(x => x.id === ds.give); const v = askSum(`Сколько дали: ${m.name}?`); if (v) cashTx(v, 'Семья', m.name, prompt('На что? (необязательно)') || ''); }
  else if (ds.m || e.target.closest('[data-m]')) { const id = ds.m || e.target.closest('[data-m]').dataset.m; openMember = openMember === id ? null : id; renderCash(); }
  else if (ds.etx) {
    const t = S.tx.find(x => x.id === ds.etx); if (!t) return;
    const v = parseFloat(String(prompt('Сумма', t.amount) || '').replace(',', '.')); if (!(v > 0)) return;
    const note = prompt('На что', t.note || ''); if (note === null) return;
    const dt = prompt('Дата (ДД.ММ.ГГГГ)', new Date(t.date).toLocaleDateString('ru-RU')); if (dt === null) return;
    const m = dt.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    t.amount = v; t.note = note.trim(); if (m) t.date = new Date(+m[3], m[2] - 1, +m[1], 12).toISOString();
    save(); renderCash(); render();
  }
  else if (ds.dtx) { if (confirm('Удалить запись?')) { S.tx = S.tx.filter(t => t.id !== ds.dtx); save(); renderCash(); render(); } }
  else if (ds.delm) { if (confirm('Убрать из списка? История останется в операциях.')) { S.family = S.family.filter(x => x.id !== ds.delm); openMember = null; save(); renderCash(); } }
};
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.t === 'sav') renderCash(); });
renderCash();
