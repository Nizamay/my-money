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
const famDay = t => new Date(t.given || t.date);
// entries made before this rule sat on the 1st of their month: move them to the day they were given
S.tx.forEach(t => { if (t.origin === 'cash' && t.category === 'Семья' && t.given && t.date !== t.given) { t.date = t.given; save(); } });
const famIn = t => famDay(t) >= cashStart();
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
const forMonth = t => t.forMonth || t.date.slice(0, 7);
const toFamily = () => S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && famIn(t)).reduce((s, t) => s + t.amount, 0);
const spentMe = () => S.tx.filter(t => t.origin === 'cash' && t.category !== 'Семья' && sinceStart(t)).reduce((s, t) => s + t.amount, 0);
// money lent from cash: not spending — it is expected back; a returned loan is cash in hand again
S.loans = S.loans || [];
// repair: an earlier re-read wiped the loan mark off transfers lent from the bank
// repair: a purchase saved from its confirmation code while the real purchase SMS (with fees) is also saved
{ const codes = S.tx.filter(t => t.note === 'по коду подтверждения');
  const twins = codes.filter(c => S.tx.some(x => sameBuy(c, x)));
  if (twins.length) { S.tx = S.tx.filter(t => !twins.includes(t)); save(); setTimeout(() => toast('Убраны двойные записи: ' + twins.length), 800); } }
S.loans.forEach(l => { const t = l.txId && S.tx.find(x => x.id === l.txId); if (t && t.kind !== 'loan') { t.kind = 'loan'; t.category = 'В долг'; save(); } });
const lent = () => S.loans.filter(l => !l.txId && new Date(l.date) >= cashStart()).reduce((s, l) => s + l.amount, 0);
const returned = () => S.loans.filter(l => !l.txId && l.back && new Date(l.back) >= cashStart()).reduce((s, l) => s + l.amount, 0);
const toSavings = () => S.sav.reduce((s, f) => s + f.ops.filter(o => o.amount > 0 && o.cash !== false && new Date(o.date) >= cashStart()).reduce((a, o) => a + o.amount, 0), 0);

function renderCash() {
  const got = cashIn(), sav = toSavings(), fam = toFamily(), me = spentMe();
  const db = debitBalance(), owed = S.loans.filter(l => !l.back).reduce((s, l) => s + l.amount, 0);
  const salDate = cashStart().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const per = S.cashPer || 'salary';
  $('c-top').innerHTML = `<div class="seg" id="c-per" style="margin-bottom:8px">${[['salary', 'С зарплаты'], ['month', 'Месяц'], ['3m', '3 мес'], ['all', 'Всё']]
      .map(([k, l]) => `<button data-per="${k}" class="${k === per ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mut">${per === 'all' ? 'За всё время' : 'С ' + salDate} · ${cashPerLabel()}</div>
    <div class="mut">Снятий за период: ${S.tx.filter(t => t.kind === 'cash' && sinceStart(t)).length}</div>
    <div class="row"><span>💵 <b>Кэш на руках</b><div class="m">снято ${fmt(got)} — осталось распределить</div></span><b>${fmt(Math.max(0, got - sav - fam - me - lent() + returned()))}</b></div>
    <div class="row"><span>🏦 В накопления</span><span>${fmt(sav)}</span></div>
    <div class="row"><span>👨‍👩‍👧 Семье</span><span>${fmt(fam)}</span></div>
    <div class="row"><span>🧍 Потратил сам</span><span>${fmt(me)}</span></div>
    <div class="row"><span>💳 Остаток на дебетовой карте<div class="m">${db.how}</div></span><span>${db.v == null ? '—' : fmt(db.v)} <button class="del" style="color:var(--acc);font-size:13px" id="c-bal">✎</button></span></div>
    <div class="row"><span>🤝 Дал в долг</span><span>${fmt(owed)}</span></div>
    <details class="unalloc"><summary class="row" style="cursor:pointer;list-style:none"><b>Не распределено ▾</b><b style="color:var(--acc)">${db.v == null ? '—' : fmt(db.v + owed)}</b></summary>
      <div class="row m"><span>💳 На дебетовой карте</span><span>${db.v == null ? '—' : fmt(db.v)}</span></div>
      ${S.loans.filter(l => !l.back).map(l => `<div class="row m"><span>🤝 ${esc(l.who)} · ${new Date(l.date).toLocaleDateString('ru-RU')}</span><span>${fmt(l.amount)}</span></div>`).join('') || '<div class="row m"><span>🤝 Долгов нет</span><span>0</span></div>'}
    </details>
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
    const got = S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name && famIn(t)).reduce((s, t) => s + t.amount, 0);
    return `<div class="row"><span data-m="${m.id}" style="cursor:pointer">${esc(m.name)}<div class="m">с зарплаты: ${fmt(got)}</div></span>
      <button class="btn" style="width:auto;padding:6px 14px;margin:0" data-give="${m.id}">Дать</button>
      <button class="del" style="color:var(--acc)" data-m="${m.id}" title="суммы">✎</button><button class="del" data-delm="${m.id}" title="удалить">×</button></div>
      ${openMember === m.id ? '<div id="f-inline"></div>' : ''}`;
  }).join('') || '<p class="mut">Добавьте членов семьи</p>';
  const m = S.family.find(x => x.id === openMember);
  $('f-hist').style.display = m ? '' : 'none';
  if (m) $('f-hist').innerHTML = `<h3>${esc(m.name)} — история</h3>` + (S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name)
    .sort((a, b) => forMonth(b).localeCompare(forMonth(a)) || b.date.localeCompare(a.date)).map(t => `<div class="row"><div>на ${monthLabel(forMonth(t))}<div class="m">${esc(t.note || 'кэш')}${t.given ? ' · дал ' + new Date(t.given).toLocaleDateString('ru-RU') : ''}</div></div>
      <b>${fmt(t.amount)}</b><button class="del" style="color:var(--acc)" data-etx="${t.id}">✎</button><button class="del" data-dtx="${t.id}">×</button></div>`).join('') || '<p class="mut">Пока ничего</p>')
    + `<button class="btn ghost" data-ren="${m.id}">Переименовать</button>`;
  // shown right under the member (the #f-list rows are rebuilt each time, so the html is copied, not moved)
  if (m && $('f-inline')) { $('f-inline').innerHTML = $('f-hist').innerHTML; $('f-inline').className = 'card'; $('f-inline').style.margin = '6px 0 10px'; $('f-hist').style.display = 'none'; }
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

// debit balance: the last balance the bank reported in an SMS (or the one the user typed), moved by every
// debit operation after it — spending and withdrawals down, income and refunds up; holds, codes and bills ignored
function debitBalance() {
  const deb = new Set(S.sources.filter(s => s.type === 'debit').map(s => s.name));
  // a card payoff paid from the debit account may be filed under the credit card it paid — it still left the debit account
  const debKeys = S.sources.filter(s => s.type === 'debit').flatMap(s => s.key.split('|')).map(k => k.trim()).filter(k => /^\d{3,}$/.test(k));
  const fromDebit = t => isXfer(t) && t.raw && debKeys.some(k => t.raw.includes(k));
  const mine = S.tx.filter(t => (deb.has(t.source) || fromDebit(t)) && t.kind !== 'hold' && t.kind !== 'otp' && t.kind !== 'statement');
  const smsAnchor = mine.filter(t => t.bal != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  const man = S.debitAnchor;
  let v, from, how;
  if (man && (!smsAnchor || man.date >= smsAnchor.date)) { v = man.v; from = man.date; how = 'сверено вами ' + new Date(man.date).toLocaleDateString('ru-RU'); }
  else if (smsAnchor) { v = smsAnchor.bal; from = smsAnchor.date; how = 'по SMS от ' + new Date(smsAnchor.date).toLocaleDateString('ru-RU'); }
  else return { v: null, how: 'банк не пишет остаток в SMS — нажмите ✎ и впишите' };
  mine.filter(t => t.date > from).forEach(t => { if (!t.loanBack) v += t.income ? t.amount : -t.amount; });
  // a debt marked «Вернули» comes back onto the debit card
  S.loans.filter(l => l.back && l.back > from).forEach(l => { v += l.amount; });
  return { v: Math.round(v * 100) / 100, how };
}

// «Дать» / ✎: amount, for which month (no day), comment
function famSheet(m, t) {
  const n = new Date(), months = [];
  for (let i = 2; i >= -12; i--) { const d = new Date(n.getFullYear(), n.getMonth() + i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  // after the salary the money is for the coming month
  const sal = salaryDate(), def = t ? forMonth(t) : (sal && sal.getDate() >= 20 && (n - sal) < 20 * 864e5 ? months[1] : months[2]);
  if (t && !months.includes(def)) months.push(def);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:#0007;z-index:20;display:flex;align-items:flex-end';
  box.innerHTML = `<div class="card" style="width:100%;margin:0;border-radius:16px 16px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom))">
    <h3>${t ? '✎ Изменить' : 'Дать'}: ${esc(m.name)}</h3>
    <input id="g-v" type="number" inputmode="decimal" placeholder="Сумма, SAR" value="${t ? t.amount : ''}">
    <label class="mut">На какой месяц</label>
    <select id="g-m">${months.map(x => `<option value="${x}"${x === def ? ' selected' : ''}>на ${monthLabel(x)}</option>`).join('')}</select>
    <input id="g-n" placeholder="На что (необязательно)" value="${t ? esc(t.note || '') : ''}">
    <button class="btn" id="g-ok">${t ? 'Сохранить' : 'Записать'}</button><button class="btn ghost" id="g-x">Отмена</button></div>`;
  document.body.appendChild(box);
  const q = s => box.querySelector(s);
  q('#g-x').onclick = () => box.remove();
  box.onclick = e => { if (e.target === box) box.remove(); };
  q('#g-ok').onclick = () => {
    const v = parseFloat(String(q('#g-v').value).replace(',', '.')); if (!(v > 0)) return q('#g-v').focus();
    const ym = q('#g-m').value, [y, mo] = ym.split('-').map(Number), date = new Date(y, mo - 1, 1, 12).toISOString();
    if (t) Object.assign(t, { amount: v, forMonth: ym, date: t.given || date, note: q('#g-n').value.trim() });
    // money entered for a past month is history: it does not touch the current cash period
    const curYM = new Date().toISOString().slice(0, 7);
    const given = ym < curYM ? undefined : new Date().toISOString();
    if (!t) S.tx.push({ id: uid(), date: given || date, forMonth: ym, given, amount: v, source: 'Кэш', category: 'Семья', merchant: m.name, note: q('#g-n').value.trim(), origin: 'cash', income: false });
    box.remove(); save(); renderCash(); render();
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
  if (e.target.id === 'c-bal') {
    const a = prompt('Сколько сейчас на дебетовой карте (SAR)? Посмотрите в приложении банка. Пусто — считать по SMS');
    if (a === null) return;
    const v = parseFloat(a.replace(',', '.').replace(/[^\d.-]/g, ''));
    S.debitAnchor = isFinite(v) && a.trim() ? { v, date: new Date().toISOString() } : null; save(); renderCash(); return;
  }
  if (e.target.dataset.per) { S.cashPer = e.target.dataset.per; save(); renderCash(); return; }
  if (e.target.id === 'c-wd') {   // a withdrawal the bank sent no SMS about
    const v = askSum('Сколько сняли наличными?'); if (!v) return;
    S.tx.push({ id: uid(), date: new Date().toISOString(), amount: v, source: 'Кэш', category: 'Наличные', merchant: 'Снятие наличных', kind: 'cash', origin: 'manual', income: false });
    save(); renderCash(); render();
  }
  if (e.target.id === 'c-loan') return loanSheet();
  if (e.target.dataset.back) { const l = S.loans.find(x => x.id === e.target.dataset.back); if (confirm(`${l.who} вернул(а) ${fmt(l.amount)}? Сумма прибавится к остатку на дебетовой карте.`)) {
    l.back = new Date().toISOString();
    const inc = S.tx.find(t => t.income && Math.abs(t.amount - l.amount) < 0.01 && Math.abs(new Date(t.date) - new Date(l.back)) < 3 * 864e5);
    if (inc) inc.loanBack = l.id;
    save(); renderCash(); renderSav();
  } return; }
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
  if (ds.give) famSheet(S.family.find(x => x.id === ds.give));
  else if (ds.m || e.target.closest('[data-m]')) { const id = ds.m || e.target.closest('[data-m]').dataset.m; openMember = openMember === id ? null : id; renderCash(); }
  else if (ds.etx) { const t = S.tx.find(x => x.id === ds.etx); if (t) famSheet(S.family.find(x => x.name === t.merchant) || { name: t.merchant }, t); }
  else if (ds.dtx) { if (confirm('Удалить запись?')) { S.tx = S.tx.filter(t => t.id !== ds.dtx); save(); renderCash(); render(); } }
  else if (ds.delm) {
    const m = S.family.find(x => x.id === ds.delm); if (!m) return;
    if (!confirm(`Удалить «${m.name}» из списка?`)) return;
    const mine = S.tx.filter(t => t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name);
    if (mine.length && confirm(`Удалить и все записи «${m.name}» (${mine.length})? Отмена — записи останутся в тратах.`)) S.tx = S.tx.filter(t => !mine.includes(t));
    S.family = S.family.filter(x => x !== m); openMember = null; save(); renderCash(); render();
  }
  else if (ds.ren) { const m = S.family.find(x => x.id === ds.ren); const n = (prompt('Новое название', m.name) || '').trim(); if (n && n !== m.name) {
    S.tx.forEach(t => { if (t.origin === 'cash' && t.category === 'Семья' && t.merchant === m.name) t.merchant = n; }); m.name = n; save(); renderCash(); render(); } }
};
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.t === 'sav') renderCash(); });
renderCash();
render();   // statistics again, after the loan / family repairs above
