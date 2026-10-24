'use strict';
/* ---------- storage ---------- */
const KEY = 'mymoney.v1';
const DEF = { tx: [], sources: [], rules: [], sav: [], cur: '₽', onlyKnown: false };
let S;
try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = Object.assign({}, DEF); }
// first run: the two banks the SMS come from, riyals
if (!S.seeded) {
  if (!S.sources.length) S.sources = [{ name: 'anb', key: 'anb|arab national', cat: '' }, { name: 'SAB', key: 'sab|saudi awwal', cat: '' }];
  if (S.cur === '₽' && !S.tx.length) S.cur = 'SAR';
  S.seeded = 1;
}
if (S.seeded < 2) {
  if (!S.rules.some(r => /salam/i.test(r.key))) S.rules.push({ key: '055 SALAM|BILLER: SALAM', cat: 'Интернет' });
  S.seeded = 2;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Не удалось сохранить: ' + e.message); } };
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + S.cur;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/* ---------- SMS parser ---------- */
// 1 250,50 · 1,250.00 · 45.5
const NUM = '(\\d{1,3}(?:,\\d{3})+(?=\\.\\d)|\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,](\\d{1,2}))?';
const CUR = '(?:sar|ر\\.?\\s?س|ريال|رس|₽|руб\\.?|р\\.|р\\b|rub|rur|\\$|usd|€|eur|₸|kzt|тг|uah|₴|грн|byn|gel|₾|amd|uzs|сум|try|₺|aed)';
const INCOME = /(credit transfer|зачислен|пополнен|поступлен|перевод от|credited|cashback|кешбэк|кэшбэк|deposit|incoming|received|salary|إيداع|ايداع|وارد|راتب)/i;
// a refund / reversal cancels a purchase: stored as a negative expense so totals net out
const REFUND = /(возврат|refund|revers|استرداد|مسترد)/i;
const NOT_TX = /(код|code|пароль|password|не сообщайте)/i;
const OTP = /(otp|one time password|одноразов|رمز التحقق|رمز|كلمة المرور|logged in)/i;
const CUT = /(баланс|остаток|доступно|дост\.|balance|avl|available|ост\.|бал\.|الرصيد|رصيد|المتاح)/i;
const toNum = (a, b) => parseFloat(a.replace(/[ ,  ]/g, '') + (b ? '.' + b : ''));
const latinDigits = s => s.replace(/[٠-٩]/g, c => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, c => c.charCodeAt(0) - 0x6f0).replace(/٫/g, '.').replace(/٬/g, ',');

function parseSms(text, from = '') {
  const raw = latinDigits(text.trim());
  if (!raw || OTP.test(raw) || NOT_TX.test(raw) && !/(покупк|оплат|списан|purchase|payment|شراء|دفع)/i.test(raw)) return null;
  // drop the balance figure (anb puts "Balance:" mid-message, before Total amount / At / On)
  const body = raw.replace(new RegExp(CUT.source + '[^\\d\\n]{0,15}' + NUM + '(?:\\s?' + CUR + ')?', 'gi'), ' ')
    // card / account / IBAN / invoice numbers are never amounts ("VISA Card:7982", "From:0012", "(2276)")
    .replace(/(card|iban|account|acc|invoice number|from|to|بطاقة|حساب|карта|счет|счёт)\s*:?\s*[*x\d][*x\d ]*/gi, '$1 ')
    .replace(/\(\s*\d{4}\s*\)/g, ' ');
  let amount = null, m, note = '';
  // abroad: "Amount:BHD 5 … Total amount:SAR 50.95" — the card's own total wins, the foreign amount goes to the note
  const tot = new RegExp('(?:total amount|total|الإجمالي|المبلغ الإجمالي|итого)(?:\\s+in)?[:\\s]*(?:' + CUR + '[:\\s]*)?' + NUM, 'i');
  if ((m = body.match(tot))) {
    amount = toNum(m[1], m[2]);
    const f = body.match(new RegExp('(?:amount[:\\s]*|\\sfor\\s+)([A-Z]{3})\\s?' + NUM, 'i'));
    if (f && !/^sar$/i.test(f[1])) note = f[1].toUpperCase() + ' ' + toNum(f[2], f[3]);
  }
  // "Amount: SAR 45.00" / "مبلغ: 45 ريال" → amount next to a currency → keyword before a number
  const lab = new RegExp('(?:amount|amt|مبلغ|المبلغ|بمبلغ|сумма)(?:\\s+in)?[:\\s]*(?:' + CUR + '[:\\s]*)?' + NUM, 'i');
  const kw = new RegExp('(?:покупка|оплата|списание|списано|расход|снятие|выдача|перевод|purchase|payment|spent|debit|pokupka|oplata)[^\\d*]{0,40}?' + NUM, 'i');
  if (amount == null && (m = body.match(lab))) amount = toNum(m[1], m[2]);
  if (amount == null && (m = body.match(new RegExp(NUM + '\\s?' + CUR, 'i')))) amount = toNum(m[1], m[2]);
  if (amount == null && (m = body.match(new RegExp(CUR + '\\s?' + NUM, 'i')))) amount = toNum(m[1], m[2]);
  if (amount == null && (m = body.match(kw))) amount = toNum(m[1], m[2]);
  if (amount == null || !isFinite(amount) || amount <= 0) return null;

  // date inside SMS: 24.10.26 14:05 · 24/10/2026 · 2026-10-24 14:05
  let date = new Date();
  const cands = [...raw.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/g)].map(m => [+m[1], +m[2], +m[3], m[4], m[5]])
    .concat([...raw.matchAll(/(?<![\d.,])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?![\d,])(?:\s+(\d{1,2}):(\d{2}))?/g)].filter(m => m[3] || m[4]).flatMap(m => [[m[3] ? +m[3] : date.getFullYear(), +m[2], +m[1], m[4], m[5]]]
      .concat(m[3] && m[3].length === 2 ? [[+m[1], +m[2], +m[3], m[4], m[5]]] : [])));
  for (let [y, mo, dd, hh, mi] of cands) {
    if (y < 100) y += 2000;
    const d = new Date(y, mo - 1, dd, hh ? +hh : 12, mi ? +mi : 0);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31 && d <= new Date(Date.now() + 864e5) && d > new Date(Date.now() - 400 * 864e5)) { date = d; break; }
  }

  // merchant
  let merchant = '';
  if ((m = body.match(/sender[:\s]+([^\n]{2,40})/i))) merchant = m[1];
  else if ((m = body.match(/(?:\bв\b|\bat\b|магазин|merchant|biller|sender|(?<=transfer[^]*)\bto|لدى|عند|المتجر|التاجر|من(?=:))[:\s]+([^,;\n]{2,40}?)(?=[.,;\n]|\s+\d|\s+for\s|$)/i))) merchant = m[1];
  if (!merchant && (m = body.match(/\b([A-Z][A-Z0-9*'&\-. ]{3,30})\b/))) merchant = m[1];
  merchant = merchant.replace(new RegExp(CUR, 'ig'), '').replace(/\s+/g, ' ').trim();
  if (/^[*\d\s]+$/.test(merchant)) merchant = '';   // a masked account number is not a merchant

  const hay = (from + ' ' + raw).toLowerCase();
  const src = S.sources.find(s => s.key.split('|').some(k => k.trim() && hay.includes(k.trim().toLowerCase())));
  if (!src && S.onlyKnown) return null;
  const rule = S.rules.find(r => r.key.split('|').some(k => k.trim() && hay.includes(k.trim().toLowerCase())));
  if (REFUND.test(body)) amount = -amount;
  return {
    id: uid(), date: date.toISOString(), amount, merchant,
    source: src ? src.name : (from || 'Другое'),
    category: rule ? rule.cat : /outgoing transfer|تحويل صادر|исходящий перевод/i.test(body) ? 'Переводы'
      : /withdraw|\batm\b|cash|سحب|صراف|снятие налич|банкомат/i.test(body) ? 'Наличные' : (src && src.cat) || 'Без категории',
    note, income: !REFUND.test(body) && INCOME.test(body), origin: 'sms', raw, h: hash(raw)
  };
}

const isDup = t => S.tx.some(x => x.h === t.h || (x.origin === 'sms' && x.amount === t.amount && x.date.slice(0, 16) === t.date.slice(0, 16)));

function addSms(text, from) {
  const t = parseSms(text, from);
  if (!t) return { ok: false, msg: 'не похоже на трату' };
  if (isDup(t)) return { ok: false, msg: 'уже есть' };
  S.tx.push(t); save();
  return { ok: true, t };
}

/* ---------- stats state ---------- */
const st = { period: 'month', offset: 0, group: 'day', split: 'source', fBucket: null, fKey: null };

function periodRange() {
  const n = new Date(); let a, b, label;
  if (st.period === 'week') {
    const d = new Date(n.getFullYear(), n.getMonth(), n.getDate()); const wd = (d.getDay() + 6) % 7;
    a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd + 7 * st.offset); b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7);
    label = a.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' – ' + new Date(b - 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } else if (st.period === 'month') {
    a = new Date(n.getFullYear(), n.getMonth() + st.offset, 1); b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    label = a.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  } else if (st.period === 'year') {
    a = new Date(n.getFullYear() + st.offset, 0, 1); b = new Date(a.getFullYear() + 1, 0, 1); label = String(a.getFullYear());
  } else {
    const ds = S.tx.map(t => new Date(t.date)); a = ds.length ? new Date(Math.min(...ds)) : n; a = new Date(a.getFullYear(), a.getMonth(), 1);
    b = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1); label = 'Всё время';
  }
  return { a, b, label };
}
const bucketOf = d => {
  if (st.group === 'day') return ymd(d);
  if (st.group === 'month') return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const w = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7); return ymd(w);
};
function buckets(a, b) {
  const out = []; let d = new Date(a);
  if (st.group === 'week') d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);
  if (st.group === 'month') d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (d < b && out.length < 800) {
    out.push(bucketOf(d));
    d = st.group === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      : st.group === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}
const COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

function render() {
  const exp = S.tx.filter(t => !t.income);
  const now = new Date(), today = ymd(now);
  const wk = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  const mo = new Date(now.getFullYear(), now.getMonth(), 1);
  const sum = f => exp.filter(f).reduce((s, t) => s + t.amount, 0);
  $('k-day').textContent = fmt(sum(t => ymd(new Date(t.date)) === today));
  $('k-week').textContent = fmt(sum(t => new Date(t.date) >= wk));
  $('k-month').textContent = fmt(sum(t => new Date(t.date) >= mo));

  const { a, b, label } = periodRange();
  $('plabel').textContent = label;
  const inP = exp.filter(t => { const d = new Date(t.date); return d >= a && d < b; });

  // bars
  const keys = buckets(a, b), byB = {}; keys.forEach(k => byB[k] = 0);
  const inKey = t => !st.fKey || t[st.split] === st.fKey;
  inP.filter(inKey).forEach(t => { const k = bucketOf(new Date(t.date)); if (k in byB) byB[k] += t.amount; });
  const svg = $('bars'), W = svg.clientWidth || 340, H = 180, pad = 18;
  const max = Math.max(1, ...Object.values(byB)), bw = (W - 4) / Math.max(1, keys.length);
  let h = '';
  keys.forEach((k, i) => {
    const v = byB[k], bh = (H - pad - 8) * Math.max(0, v) / max, x = 2 + i * bw;
    const on = st.fBucket === k, dim = st.fBucket && !on;
    h += `<rect data-b="${k}" x="${x + bw * .12}" y="${H - pad - bh}" width="${Math.max(1, bw * .76)}" height="${Math.max(bh, v ? 1 : 0)}" rx="2" fill="${dim ? '#9ca3af55' : 'var(--acc)'}"/>`;
    h += `<rect data-b="${k}" x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"/>`;
    const step = Math.ceil(keys.length / 8);
    if (i % step === 0) {
      const lab = st.group === 'month' ? k.slice(5, 7) + '.' + k.slice(2, 4) : k.slice(8, 10) + '.' + k.slice(5, 7);
      h += `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${lab}</text>`;
    }
  });
  h += `<text x="${W - 2}" y="10" text-anchor="end">${fmt(max)}</text>`;
  svg.innerHTML = h;
  const tot = inP.filter(inKey).reduce((s, t) => s + t.amount, 0);
  const nB = keys.length || 1;
  $('ptotal').textContent = `Итого: ${fmt(tot)} · в среднем ${fmt(tot / nB)} за ${{ day: 'день', week: 'неделю', month: 'месяц' }[st.group]}` + (st.fBucket ? ` · выбрано: ${fmt(byB[st.fBucket] || 0)}` : '');

  // donut
  const inBucket = t => !st.fBucket || bucketOf(new Date(t.date)) === st.fBucket;
  const groups = {}; inP.filter(inBucket).forEach(t => groups[t[st.split]] = (groups[t[st.split]] || 0) + t.amount);
  let arr = Object.entries(groups).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]);
  if (arr.length > 9) { const rest = arr.slice(9).reduce((s, x) => s + x[1], 0); arr = arr.slice(0, 9).concat([['Прочее', rest]]); }
  const total = arr.reduce((s, x) => s + x[1], 0);
  let ang = -Math.PI / 2, d = '';
  arr.forEach(([k, v], i) => {
    const fr = v / total, a2 = ang + fr * Math.PI * 2, big = fr > .5 ? 1 : 0;
    const p = (r, t) => (100 + r * Math.cos(t)).toFixed(2) + ' ' + (100 + r * Math.sin(t)).toFixed(2);
    const op = st.fKey && st.fKey !== k ? .25 : 1;
    d += fr >= .9999 ? `<circle data-k="${esc(k)}" cx="100" cy="100" r="70" fill="none" stroke="${COLORS[i]}" stroke-width="40" opacity="${op}"/>`
      : `<path data-k="${esc(k)}" d="M${p(90, ang)} A90 90 0 ${big} 1 ${p(90, a2)} L${p(50, a2)} A50 50 0 ${big} 0 ${p(50, ang)}Z" fill="${COLORS[i]}" opacity="${op}"/>`;
    ang = a2;
  });
  d += `<text x="100" y="104" text-anchor="middle" style="font-size:15px;fill:var(--fg);font-weight:600">${total ? fmt(total) : 'нет данных'}</text>`;
  $('donut').innerHTML = d;
  $('legend').innerHTML = arr.map(([k, v], i) => `<div data-k="${esc(k)}" style="opacity:${st.fKey && st.fKey !== k ? .4 : 1}"><i style="background:${COLORS[i]}"></i>${esc(k)}<span class="mut">${Math.round(v / total * 100)}%</span><span class="v">${fmt(v)}</span></div>`).join('');

  // list
  let f = '';
  if (st.fBucket) f += `<span class="chip" data-clr="b">${st.fBucket} ✕</span>`;
  if (st.fKey) f += `<span class="chip" data-clr="k">${esc(st.fKey)} ✕</span>`;
  $('filters').innerHTML = f;
  const list = S.tx.filter(t => { const dd = new Date(t.date); return dd >= a && dd < b; })
    .filter(t => inBucket(t) && (!st.fKey || t[st.split] === st.fKey))
    .sort((x, y) => y.date.localeCompare(x.date)).slice(0, 300);
  $('list').innerHTML = list.length ? list.map(t => `<div class="row"><div><div>${esc(t.merchant || t.note || t.category)}</div>
    <div class="m">${new Date(t.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(t.source)}${t.merchant && t.note ? " · " + esc(t.note) : ""} ·
    <select data-cat="${t.id}" style="width:auto;padding:2px;margin:0;font-size:12px">${catOptions(t.category)}</select></div></div>
    <div class="amt ${t.income ? 'inc' : ''}">${t.income || t.amount < 0 ? '+' : '−'}${fmt(Math.abs(t.amount))}</div><button class="del" data-del="${t.id}">×</button></div>`).join('')
    : '<p class="mut">Пока пусто</p>';

  // datalists
  const cats = allCats(), srcs = [...new Set(S.tx.map(t => t.source).concat(S.sources.map(s => s.name)))];
  $('dl-cat').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  $('dl-src').innerHTML = srcs.map(c => `<option value="${esc(c)}">`).join('');
}
const allCats = () => [...new Set(['Продукты', 'Кафе', 'Транспорт', 'Дом', 'Здоровье', 'Одежда', 'Развлечения', 'Связь', 'Без категории']
  .concat(S.tx.map(t => t.category), S.rules.map(r => r.cat), S.sources.map(s => s.cat)).filter(Boolean))];
const catOptions = cur => allCats().map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">+ новая…</option>';

/* ---------- events: stats ---------- */
document.querySelector('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 't-' + b.dataset.t));
  if (b.dataset.t === 'stats') render();
  window.scrollTo(0, 0);
};
const seg = (id, attr, fn) => $(id).onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset[attr]); render();
};
seg('period', 'p', v => { st.period = v; st.offset = 0; st.fBucket = null; st.group = v === 'year' || v === 'all' ? 'month' : 'day';
  $('group').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.g === st.group)); });
seg('group', 'g', v => { st.group = v; st.fBucket = null; });
seg('split', 's', v => { st.split = v; st.fKey = null; });
$('prev').onclick = () => { st.offset--; st.fBucket = null; render(); };
$('next').onclick = () => { st.offset++; st.fBucket = null; render(); };
$('bars').onclick = e => { const k = e.target.dataset.b; if (k) { st.fBucket = st.fBucket === k ? null : k; render(); } };
$('donut').onclick = $('legend').onclick = e => { const el = e.target.closest('[data-k]'); if (el) { st.fKey = st.fKey === el.dataset.k ? null : el.dataset.k; render(); } };
$('filters').onclick = e => { const c = e.target.dataset.clr; if (c === 'b') st.fBucket = null; if (c === 'k') st.fKey = null; render(); };
$('list').onclick = e => { const id = e.target.dataset.del; if (id && confirm('Удалить операцию?')) { S.tx = S.tx.filter(t => t.id !== id); save(); render(); } };
$('list').onchange = e => {
  const id = e.target.dataset.cat; if (!id) return;
  let c = e.target.value; if (c === '__new') { c = prompt('Новая категория'); if (!c) return render(); }
  const t = S.tx.find(x => x.id === id); t.category = c;
  if (t.merchant && confirm(`Всегда относить «${t.merchant}» к «${c}»?`)) {
    S.rules.unshift({ key: t.merchant, cat: c });
    S.tx.forEach(x => { if (x.merchant === t.merchant) x.category = c; });
  }
  save(); render();
};

/* ---------- add ---------- */
$('a-date').value = ymd(new Date());
$('a-save').onclick = () => {
  const amount = parseFloat(String($('a-amt').value).replace(',', '.'));
  if (!(amount > 0)) return alert('Введите сумму');
  const [y, m, d] = $('a-date').value.split('-').map(Number), n = new Date();
  S.tx.push({ id: uid(), date: new Date(y, m - 1, d, n.getHours(), n.getMinutes()).toISOString(), amount,
    source: $('a-src').value.trim() || 'Наличные', category: $('a-cat').value.trim() || 'Без категории',
    note: $('a-note').value.trim(), merchant: '', origin: 'manual' });
  save(); $('a-amt').value = $('a-note').value = ''; toast('Сохранено: ' + fmt(amount));
};
$('s-parse').onclick = () => {
  const out = $('s-text').value.split(/\n\s*\n/).map(block => {
    let from = '', text = block.trim(); const m = text.match(/^(?:от|from)\s*:\s*(.+)\n/i);
    if (m) { from = m[1].trim(); text = text.slice(m[0].length); }
    const r = addSms(text, from);
    return r.ok ? `<div class="row"><span>${esc(r.t.source)} · ${esc(r.t.merchant || r.t.category)}</span><b>${r.t.income || r.t.amount < 0 ? '+' : '−'}${fmt(Math.abs(r.t.amount))}</b></div>`
      : `<div class="row mut"><span>${esc(text.slice(0, 50))}…</span><span>${r.msg}</span></div>`;
  });
  $('s-out').innerHTML = out.join(''); $('s-text').value = '';
};

/* ---------- CSV import ---------- */
let rows = [];
$('i-file').onchange = async e => { const f = e.target.files[0]; if (f) { $('i-text').value = await f.text(); $('i-prev').click(); } };
function splitCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const first = lines[0] || '';
  const delim = ['\t', ';', ','].sort((x, y) => first.split(y).length - first.split(x).length)[0];
  return lines.map(l => { const r = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { r.push(cur.trim()); cur = ''; } else cur += ch; }
    r.push(cur.trim()); return r; });
}
function parseDate(s) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], m[2] - 1, +m[3], 12);
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, m[2] - 1, +m[1], 12); }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((+s - 25569) * 864e5) + 12 * 36e5); // Excel serial
  return null;
}
const parseAmt = s => { const v = parseFloat(String(s).replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '')); return isFinite(v) ? v : null; };
$('i-prev').onclick = () => {
  rows = splitCsv($('i-text').value); if (!rows.length) return;
  const head = rows[0].map(h => h.toLowerCase()), hasHead = !parseDate(rows[0][0]) && !rows[0].some(c => parseAmt(c) !== null && /\d/.test(c) && !/[a-zа-я]/i.test(c));
  const guess = (re, def) => { const i = head.findIndex(h => re.test(h)); return hasHead && i >= 0 ? i : def; };
  const cols = rows[0].map((h, i) => hasHead ? h : 'Колонка ' + (i + 1));
  const sel = (id, def) => `<select id="${id}"><option value="-1">—</option>${cols.map((c, i) => `<option value="${i}"${i === def ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  $('i-map').innerHTML = `<p class="mut">Найдено строк: ${rows.length - (hasHead ? 1 : 0)}. Сопоставьте колонки:</p>
    <div class="grid2"><div>Дата${sel('m-d', guess(/дат|date/, 0))}</div><div>Сумма${sel('m-a', guess(/сум|amount|расход|руб/, 1))}</div>
    <div>Источник${sel('m-s', guess(/источ|карт|счет|счёт|source|account/, -1))}</div><div>Категория${sel('m-c', guess(/катег|category/, -1))}</div></div>
    Комментарий${sel('m-n', guess(/коммент|опис|note|desc|магаз/, -1))}
    <label class="mut"><input type="checkbox" id="m-h" style="width:auto" ${hasHead ? 'checked' : ''}> первая строка — заголовок</label>
    <button class="btn" id="i-go">Импортировать</button>`;
  $('i-go').onclick = () => {
    const g = id => +$(id).value, [di, ai, si, ci, ni] = ['m-d', 'm-a', 'm-s', 'm-c', 'm-n'].map(g);
    let ok = 0, bad = 0, dup = 0;
    rows.slice($('m-h').checked ? 1 : 0).forEach(r => {
      const d = parseDate(r[di]), a = parseAmt(r[ai]);
      if (!d || a === null || a === 0) { bad++; return; }
      const h = hash('imp|' + r.join('|')); if (S.tx.some(t => t.h === h)) { dup++; return; }
      S.tx.push({ id: uid(), date: d.toISOString(), amount: Math.abs(a), income: false,
        source: (si >= 0 && r[si]) || 'Импорт', category: (ci >= 0 && r[ci]) || 'Без категории',
        note: ni >= 0 ? r[ni] || '' : '', merchant: '', origin: 'import', h });
      ok++;
    });
    save(); $('i-map').innerHTML = `<p>Добавлено: <b>${ok}</b>, пропущено: ${bad}, дубликатов: ${dup}</p>`; $('i-text').value = '';
  };
};
$('b-exp').onclick = () => {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '﻿дата;сумма;тип;источник;категория;магазин;комментарий\n' + S.tx.slice().sort((x, y) => x.date.localeCompare(y.date))
    .map(t => [ymd(new Date(t.date)), String(t.amount).replace('.', ','), t.income ? 'доход' : 'расход', t.source, t.category, t.merchant, t.note].map(q).join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'расходы-' + ymd(new Date()) + '.csv'; a.click();
};

/* ---------- settings ---------- */
function renderSet() {
  $('src-list').innerHTML = S.sources.map((s, i) => `<div class="row"><div>${esc(s.name)}<div class="m">${esc(s.key)} → ${esc(s.cat || '—')}</div></div><button class="del" data-ds="${i}">×</button></div>`).join('') || '<p class="mut">Нет источников</p>';
  $('rule-list').innerHTML = S.rules.map((r, i) => `<div class="row"><div>${esc(r.key)}<div class="m">→ ${esc(r.cat)}</div></div><button class="del" data-dr="${i}">×</button></div>`).join('') || '<p class="mut">Нет правил</p>';
  $('cur').value = S.cur; $('only-known').checked = S.onlyKnown;
  $('hook').value = location.href.split('#')[0] + '#from=ОТПРАВИТЕЛЬ&sms=ТЕКСТ';
}
$('n-add').onclick = () => { const name = $('n-name').value.trim(), key = $('n-key').value.trim(); if (!name || !key) return alert('Название и ключ');
  S.sources.push({ name, key, cat: $('n-cat').value.trim() }); save(); $('n-name').value = $('n-key').value = $('n-cat').value = ''; renderSet(); };
$('r-add').onclick = () => { const key = $('r-key').value.trim(), cat = $('r-cat').value.trim(); if (!key || !cat) return;
  S.rules.push({ key, cat }); save(); $('r-key').value = $('r-cat').value = ''; renderSet(); };
$('src-list').onclick = e => { const i = e.target.dataset.ds; if (i != null) { S.sources.splice(+i, 1); save(); renderSet(); } };
$('rule-list').onclick = e => { const i = e.target.dataset.dr; if (i != null) { S.rules.splice(+i, 1); save(); renderSet(); } };
$('cur').onchange = () => { S.cur = $('cur').value.trim() || '₽'; save(); render(); };
$('only-known').onchange = () => { S.onlyKnown = $('only-known').checked; save(); };
$('wipe').onclick = () => { if (confirm('Удалить ВСЕ операции, источники и правила?') && confirm('Точно?')) { S = Object.assign({}, DEF, { tx: [] , sources: [], rules: [] }); save(); renderSet(); render(); } };

/* ---------- toast ---------- */
function toast(msg) {
  const t = document.createElement('div'); t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:12px;z-index:9;max-width:90%';
  document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}

/* ---------- SMS from iOS Shortcut: index.html#from=...&sms=... ---------- */
function intake() {
  if (!location.hash.includes('sms=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const from = p.get('from') || '', text = p.get('sms') || '';
  // many SMS at once (Shortcuts "Find Messages" → joined with ###): show them for review
  const parts = text.split(/\n?\s*#{3,}\s*\n?/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    history.replaceState(null, '', location.pathname + location.search);
    document.querySelector('nav [data-t="add"]').click();
    review(parts.map(x => parseSms(x, from)).filter(Boolean));
    $('review').scrollIntoView();
    toast(`Получено SMS: ${parts.length}`);
    return;
  }
  const r = addSms(text, from);
  toast(r.ok ? `${r.t.income ? 'Доход' : 'Расход'} ${fmt(r.t.amount)} · ${r.t.source}` : 'SMS: ' + r.msg);
  history.replaceState(null, '', location.pathname + location.search);
  render();
}
window.addEventListener('hashchange', intake);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
renderSet(); render();
window.addEventListener('load', intake);   // after scan.js (review) has loaded
window.addEventListener('resize', render);
