'use strict';
/* ---------- credit cards: what was spent this / last month and what is still to pay off ---------- */
const monthStart = (y, m) => new Date(y, m, 1);

/* ---------- re-read saved SMS with the current parser: operations saved by an older version get
   the right time, amount, shop and kind; a category the user chose is kept ---------- */
const PARSER_VER = 37;
function reparseAll() {
  let n = 0;
  S.tx.forEach(t => {
    if (t.origin !== 'sms' || !t.raw) return;
    const r = parseSms(t.raw, t.source.split(' ')[0]); if (!r) return;
    const keep = t.kind === 'loan' ? { kind: 'loan', category: t.category } : null;   // a transfer the user marked as a loan stays a loan
    const before = JSON.stringify([t.date, t.amount, t.merchant, t.kind, t.income, t.transfer]);
    Object.assign(t, { date: r.date, amount: r.amount, merchant: r.merchant, note: r.note || t.note, kind: r.kind, income: r.income, transfer: r.transfer, due: r.due, bal: r.bal });
    if (keep) { Object.assign(t, keep); return; }
    if (!t.category || t.category === 'Без категории' || isInfo(r) || isXfer(r)) t.category = r.category;
    if (isXfer(t) || isInfo(t)) t.payTo = t.payTo || cardFor(t);
    if (before !== JSON.stringify([t.date, t.amount, t.merchant, t.kind, t.income, t.transfer])) n++;
  });
  S.parserVer = PARSER_VER; save();
  return n;
}
if (S.parserVer !== PARSER_VER && S.tx.length) { const n = reparseAll(); if (n) setTimeout(() => toast('Исправлено операций: ' + n), 500); }

// operations saved before holds were recognised: a PENDING charge and its reversal are not spending
if (S.tx.some(t => !t.kind && HOLD.test(t.merchant || ''))) {
  S.tx.forEach(t => { if (!t.kind && HOLD.test(t.merchant || '')) { t.kind = 'hold'; t.category = 'Блокировка (pending)'; } });
  save();
}

// payoffs to a card in [a, b); SAB sends both "Payment" and "Credited" for one payoff — same amount within 3 h counts once
function paidTo(name, a, b) {
  const xs = S.tx.filter(t => isXfer(t) && (t.payTo === name || (!t.payTo && t.source === name)) && new Date(t.date) >= a && new Date(t.date) < b)
    .sort((x, y) => x.date.localeCompare(y.date));
  let sum = 0; const seen = [];
  xs.forEach(t => { const tm = +new Date(t.date); if (seen.some(s => s.a === t.amount && Math.abs(s.t - tm) < 3 * 36e5)) return; seen.push({ a: t.amount, t: tm }); sum += t.amount; });
  return sum;
}

function cardMonth(name, a, b) {
  const inP = t => new Date(t.date) >= a && new Date(t.date) < b;
  const own = S.tx.filter(t => t.source === name && inP(t));
  const spent = own.filter(t => !t.income && !isXfer(t) && !isInfo(t)).reduce((s, t) => s + t.amount, 0);   // refunds are negative already
  // payoffs usually leave the debit account 0012, so they are found by where they went
  const paid = paidTo(name, a, b);
  const back = own.filter(t => t.income && !isXfer(t)).reduce((s, t) => s + t.amount, 0);                     // cashback lands on the card
  return { spent, paid, back };
}

function renderCredit() {
  const cards = S.sources.filter(s => s.type === 'credit');
  const box = $('credit'); box.style.display = cards.length ? '' : 'none';
  if (!cards.length) return;
  const n = new Date(), cur = monthStart(n.getFullYear(), n.getMonth()), prev = monthStart(n.getFullYear(), n.getMonth() - 1), next = monthStart(n.getFullYear(), n.getMonth() + 1);
  const mName = d => d.toLocaleDateString('ru-RU', { month: 'long' });
  box.innerHTML = '<h3>Кредитки к погашению</h3>' + cards.map(c => {
    const p = cardMonth(c.name, prev, cur), m = cardMonth(c.name, cur, next);
    // the bank's own statement wins: amount due minus what was paid since it was issued
    const st = S.tx.filter(t => t.kind === 'statement' && (t.payTo || t.source) === c.name).sort((x, y) => y.date.localeCompare(x.date))[0];   // a hold or a code is not a statement
    const stPaid = st ? paidTo(c.name, new Date(+new Date(st.date) - 3 * 864e5), new Date(8.64e15)) : 0;
    const left = st ? Math.max(0, st.amount - stPaid) : Math.max(0, p.spent - p.back - p.paid - m.paid);
    const stLine = st ? `<div class="m">🧾 счёт банка: ${fmt(st.amount)}${st.due ? ', оплатить до ' + new Date(st.due + 'T12:00').toLocaleDateString('ru-RU') : ''} · внесено ${fmt(stPaid)}</div>` : '';
    return `<div class="row" style="align-items:flex-start"><div style="flex:1"><b>${esc(c.name)}</b>
      <div class="m">${mName(prev)}: потрачено ${fmt(p.spent)}${p.back ? `, кешбэк ${fmt(p.back)}` : ''} · погашено ${fmt(p.paid + m.paid)}</div>
      <div class="m">${mName(cur)}: потрачено ${fmt(m.spent)} — к оплате в следующем месяце</div>${stLine}</div>
      <div style="text-align:right"><div class="amt" style="color:${left > 0.005 ? 'var(--bad)' : '#16a34a'}">${left > 0.005 ? fmt(left) : '✓ погашено'}</div>
      <button class="del" style="color:var(--acc);font-size:13px" data-pay="${esc(c.name)}">отметить оплату</button></div></div>`;
  }).join('');
}

$('credit').onclick = e => {
  const name = e.target.dataset.pay; if (!name) return;
  const v = parseFloat(String(prompt(`Сколько внесли на «${name}»?`) || '').replace(',', '.').replace(/\s/g, ''));
  if (!(v > 0)) return;
  S.tx.push({ id: uid(), date: new Date().toISOString(), amount: v, source: name, category: 'Погашение кредитки', merchant: '', note: 'внесено вручную', transfer: true, payTo: name, income: false, origin: 'manual' });
  save(); render();
};

// redraw together with the statistics
const _render = render;
render = function () { _render(); renderCredit(); };
render();

$('reparse').onclick = () => { const n = reparseAll(); render(); toast('Исправлено операций: ' + n); };
