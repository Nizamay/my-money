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
const toSavings = () => S.sav.reduce((s, f) => s + f.ops.filter(o => o.amount > 0 && o.cash !== false && new Date(o.date) >= cashStart()).reduce((a, o) => a + o.amount, 0), 0);

function renderCash() {
  const got = cashIn(), sav = toSavings(), fam = toFamily(), me = spentMe(), left = got - sav - fam - me;
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
    <div class="row"><b>На руках, не распределено</b><b style="color:${left < -0.005 ? 'var(--bad)' : 'var(--acc)'}">${fmt(left)}</b></div>
    <div class="grid2"><button class="btn ghost" id="c-wd">＋ Снял кэш</button><button class="btn ghost" id="c-me">🧍 Потратил сам</button></div>`;

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
      <b>${fmt(t.amount)}</b><button class="del" data-dtx="${t.id}">×</button></div>`).join('') || '<p class="mut">Пока ничего</p>')
    + `<button class="btn ghost" style="color:var(--bad);border-color:var(--bad)" data-delm="${m.id}">Удалить из списка</button>`;
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
$('c-top').onclick = e => {
  if (e.target.dataset.per) { S.cashPer = e.target.dataset.per; save(); renderCash(); return; }
  if (e.target.id === 'c-wd') {   // a withdrawal the bank sent no SMS about
    const v = askSum('Сколько сняли наличными?'); if (!v) return;
    S.tx.push({ id: uid(), date: new Date().toISOString(), amount: v, source: 'Кэш', category: 'Наличные', merchant: 'Снятие наличных', kind: 'cash', origin: 'manual', income: false });
    save(); renderCash(); render();
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
  else if (ds.dtx) { if (confirm('Удалить запись?')) { S.tx = S.tx.filter(t => t.id !== ds.dtx); save(); renderCash(); render(); } }
  else if (ds.delm) { if (confirm('Убрать из списка? История останется в операциях.')) { S.family = S.family.filter(x => x.id !== ds.delm); openMember = null; save(); renderCash(); } }
};
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.t === 'sav') renderCash(); });
renderCash();
