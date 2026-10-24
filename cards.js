'use strict';
/* ---------- credit cards: what was spent this / last month and what is still to pay off ---------- */
const monthStart = (y, m) => new Date(y, m, 1);

function cardMonth(name, a, b) {
  const own = S.tx.filter(t => t.source === name && new Date(t.date) >= a && new Date(t.date) < b);
  const spent = own.filter(t => !t.income && !t.transfer).reduce((s, t) => s + t.amount, 0);   // refunds are negative already
  const paid = own.filter(t => t.transfer).reduce((s, t) => s + t.amount, 0);
  const back = own.filter(t => t.income).reduce((s, t) => s + t.amount, 0);                     // cashback lands on the card
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
    // last month's bill is paid off by payments made last month or this month
    const left = Math.max(0, p.spent - p.back - p.paid - m.paid);
    return `<div class="row" style="align-items:flex-start"><div style="flex:1"><b>${esc(c.name)}</b>
      <div class="m">${mName(prev)}: потрачено ${fmt(p.spent)}${p.back ? `, кешбэк ${fmt(p.back)}` : ''} · погашено ${fmt(p.paid + m.paid)}</div>
      <div class="m">${mName(cur)}: потрачено ${fmt(m.spent)} — к оплате в следующем месяце</div></div>
      <div style="text-align:right"><div class="amt" style="color:${left > 0.005 ? 'var(--bad)' : '#16a34a'}">${left > 0.005 ? fmt(left) : '✓ погашено'}</div>
      <button class="del" style="color:var(--acc);font-size:13px" data-pay="${esc(c.name)}">отметить оплату</button></div></div>`;
  }).join('');
}

$('credit').onclick = e => {
  const name = e.target.dataset.pay; if (!name) return;
  const v = parseFloat(String(prompt(`Сколько внесли на «${name}»?`) || '').replace(',', '.').replace(/\s/g, ''));
  if (!(v > 0)) return;
  S.tx.push({ id: uid(), date: new Date().toISOString(), amount: v, source: name, category: 'Погашение кредитки', merchant: '', note: 'внесено вручную', transfer: true, income: false, origin: 'manual' });
  save(); render();
};

// redraw together with the statistics
const _render = render;
render = function () { _render(); renderCredit(); };
render();
