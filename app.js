'use strict';
/* ---------- storage ---------- */
const KEY = 'mymoney.v1';
const DEF = { tx: [], sources: [], rules: [], sav: [], cats: [], cur: '₽', onlyKnown: false };
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
if (S.seeded < 3) {
  const old = S.sources.filter(s => !/^(anb|sab)$/i.test(s.name));
  S.sources = [
    { name: 'anb кредитка', key: '7982', cat: '', type: 'credit' },
    { name: 'anb дебетовая', key: '2150|0012', cat: '', type: 'debit' },
    { name: 'SAB кредитка', key: '2276|sab', cat: '', type: 'credit' }].concat(old);
  S.tx.forEach(t => {
    const r = (t.raw || '').toLowerCase();
    if (/7982/.test(r)) t.source = 'anb кредитка';
    else if (/2150|0012/.test(r)) t.source = 'anb дебетовая';
    else if (/2276/.test(r) || /^sab$/i.test(t.source)) t.source = 'SAB кредитка';
  });
  S.seeded = 3;
}
if (S.seeded < 4) {
  S.rules.unshift({ key: 'Traffic Violations|violation', cat: 'Штрафы' }, { key: 'MOI Payments|Absher|أبشر', cat: 'Госуслуги' });
  S.seeded = 4;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Не удалось сохранить: ' + e.message); } };
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// «Скрыть суммы»: every amount on screen becomes •••• (for showing the app to others)
const HIDE = '••••';
const fmt = n => S.hide ? HIDE + ' ' + S.cur : (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + S.cur;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

/* ---------- SMS parser ---------- */
// 1 250,50 · 1,250.00 · 45.5
const NUM = '(\\d{1,3}(?:,\\d{3})+(?=\\.\\d)|\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,](\\d{1,2}))?';
const CUR = '(?:sar|ر\\.?\\s?س|ريال|رس|₽|руб\\.?|р\\.|р\\b|rub|rur|\\$|usd|€|eur|₸|kzt|тг|uah|₴|грн|byn|gel|₾|amd|uzs|сум|try|₺|aed)';
const INCOME = /(credit transfer|зачислен|пополнен|поступлен|перевод от|credited|cashback|кешбэк|кэшбэк|deposit|incoming|received|salary|إيداع|ايداع|وارد|راتب)/i;
// a refund / reversal cancels a purchase: stored as a negative expense so totals net out
const REFUND = /(возврат|refund|revers|استرداد|مسترد)/i;
// paying off a credit card moves money between own cards: neither an expense nor an income
const PAYOFF_CAT = 'Погашение кредитки';
// a payoff is a transfer whether the SMS said so or the user filed it under PAYOFF_CAT
const isXfer = t => !!t.transfer || t.category === PAYOFF_CAT;
// a card statement ("statement has been issued … Amount Due … Due Date") is a bill, not money moving
const STATEMENT = /statement (?:has been )?issued|كشف حساب|выписка сформирована/i;
// "UBER * PENDING" is a hold the bank releases later — neither the hold nor its reversal is spending
const HOLD = /pending/i;
// a confirmation code that names a shop ("OTP … Amount: SAR 2084 At: www.extra.com") may be the only trace of a purchase:
// it is offered in the review unticked, never counted on its own
const CASH = /withdraw|\batm\b|سحب|صراف|снятие налич|банкомат/i;
// a bank transfer marked as a loan is still my money (owed to me), so it is not spending either
const isInfo = t => t.kind === 'statement' || t.kind === 'hold' || t.kind === 'otp' || t.kind === 'cash' || t.kind === 'loan';
// well-known shops and services → a suggested category (the user's own rules always win)
const KNOWN = [
  [/\bub(?:e)?r\b|careem|bolt|jeeny|taxi/i, 'Такси'],
  [/hungerstation|talabat|jahez|mrsool|keeta|toyou|chefz|deliveroo|\bkfc|mcdonald|hardee|burger|shawarma|pizza|domino|starbucks|dunkin|tim hortons|barn|cafe|coffee|kudu|albaik|americana|restaurant|\bshake/i, 'Кафе и рестораны'],
  [/lulu|panda|danube|tamimi|carrefour|othaim|farm|nesto|bindawood|supermarket|hypermarket|grocery|meat/i, 'Продукты'],
  [/noon|amazon|mumzworld|namshi|shein|temu|aliexpress|ikea|jarir|extra\b|sharaf|centrepoint|miniso/i, 'Покупки'],
  [/landmark|h&m|zara|adidas|nike|max fashion|splash|decathlon|redtag|sun & sand|shoe/i, 'Одежда'],
  [/zain|stc|mobily|virgin mobile|salam|lebara|du\b|etisalat/i, 'Связь'],
  [/insurance|shory|tawuniya|bupa|tameeni|medgulf/i, 'Страховка'],
  [/hotel|booking|airbnb|marriott|hilton|flynas|saudia|flyadeal|airline|emirates|almosafer/i, 'Путешествия'],
  [/pharmacy|nahdi|al-dawaa|dawaa|hospital|clinic|dental|medical/i, 'Здоровье'],
  [/aldrees|sasco|petromin|naft|fuel|petrol|bapco|adnoc|enoc/i, 'Топливо'],
  [/netflix|spotify|apple\.com|icloud|google|youtube|shahid|osn|disney|chatgpt|openai/i, 'Подписки'],
  [/cinema|vox|muvi|theme|park|bowling|game/i, 'Развлечения'],
  [/gym|fitness|sport/i, 'Спорт'],
];
// food delivery saved earlier under «Доставка еды» moves to cafes, rules too
if (S.tx.some(t => t.category === 'Доставка еды') || S.rules.some(r => r.cat === 'Доставка еды')) {
  S.tx.forEach(t => { if (t.category === 'Доставка еды') t.category = 'Кафе и рестораны'; });
  S.rules.forEach(r => { if (r.cat === 'Доставка еды') r.cat = 'Кафе и рестораны'; });
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}
const guessCat = m => (KNOWN.find(k => k[0].test(m || '')) || [])[1] || '';
// which credit card a payoff went to: its digits in the SMS (paid from the debit account 0012)
function cardFor(t) {
  const r = t.raw || '';
  const c = S.sources.find(s => s.type === 'credit' && s.name !== t.source && s.key.split('|').some(k => /^\d{3,}$/.test(k.trim()) && r.includes(k.trim())));
  if (c) return c.name;
  return S.sources.some(s => s.name === t.source && s.type === 'credit') ? t.source : '';
}
const PAYOFF = /(credit card:?\s*(?:payment|credited)|credit card[^\n]{0,60}\n?[^\n]{0,40}was credited|credit card payment|card payment|payment to (?:your |the )?(?:credit )?card|card repayment|payment received|سداد|تسديد|погашени)/i;
const NOT_TX = /(код|code|пароль|password|не сообщайте)/i;
const OTP = /(violation has been issued|otp|one time password|одноразов|رمز التحقق|رمز|كلمة المرور|logged in)/i;
const CUT = /(баланс|остаток|доступно|дост\.|balance|avl|available|ост\.|бал\.|الرصيد|رصيد|المتاح)/i;
const FX = { AED: 1.02, BHD: 9.95, QAR: 1.03, KWD: 12.2, OMR: 9.74, USD: 3.75, EUR: 4.1, GBP: 4.9, EGP: 0.077, TRY: 0.11, RUB: 0.047, JOD: 5.29 };
const toNum = (a, b) => parseFloat(a.replace(/[ ,  ]/g, '') + (b ? '.' + b : ''));
const latinDigits = s => s.replace(/[٠-٩]/g, c => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, c => c.charCodeAt(0) - 0x6f0).replace(/٫/g, '.').replace(/٬/g, ',');

function parseSms(text, from = '') {
  const raw = latinDigits(text.trim());
  const otp = OTP.test(raw) && /(?:^|\s)at\s*:/i.test(raw) && /amount/i.test(raw) && !/violation/i.test(raw);
  if (!raw || (OTP.test(raw) && !otp) || !otp && NOT_TX.test(raw) && !/(покупк|оплат|списан|purchase|payment|شراء|دفع)/i.test(raw)) return null;
  // drop the balance figure (anb puts "Balance:" mid-message, before Total amount / At / On)
  const balM = raw.match(new RegExp(CUT.source + '[^\\d\\n]{0,15}' + NUM, 'i'));
  const bal = balM ? toNum(balM[2], balM[3]) : undefined;
  const body = raw.replace(new RegExp(CUT.source + '[^\\d\\n]{0,15}' + NUM + '(?:\\s?' + CUR + ')?', 'gi'), ' ')
    // card / account / IBAN / invoice numbers are never amounts ("VISA Card:7982", "From:0012", "(2276)")
    .replace(/(card|iban|account|acc(?:\s*no)?|invoice number|from|to|بطاقة|حساب|карта|счет|счёт)\s*:?\s*[*x\d][*x\d ]*/gi, '$1 ')
    .replace(/\(\s*\d{4}\s*\)/g, ' ');
  let amount = null, m, note = '';
  // abroad: "Amount:BHD 5 … Total amount:SAR 50.95" — the card's own total wins, the foreign amount goes to the note
  const tot = new RegExp('(?:total amount|total|الإجمالي|المبلغ الإجمالي|итого)(?:\\s+in)?[:\\s]*(?:' + CUR + '[:\\s]*)?' + NUM, 'i');
  if ((m = body.match(tot))) {
    amount = toNum(m[1], m[2]);
    const f = body.match(new RegExp('(?:amount[:\\s]*|\\sfor\\s+)([A-Z]{3})\\s?' + NUM, 'i'));
    if (f && !/^sar$/i.test(f[1])) note = f[1].toUpperCase() + ' ' + toNum(f[2], f[3]);
  }
  // a foreign amount with no SAR total: SAR = foreign × exchange rate + fees (never the fee alone, never the foreign figure as SAR)
  if (amount == null && (m = body.match(new RegExp('amount[:\\s]*(?!sar\\b)([A-Z]{3})\\s?' + NUM, 'i')))) {
    const fx = toNum(m[2], m[3]), cur = m[1].toUpperCase();
    const rate = (body.match(/exchange rate[:\s]*([\d.]+)/i) || [])[1];
    const fee = (body.match(new RegExp('fees?(?: and vat)?[:\\s]*(?:' + CUR + '[:\\s]*)?' + NUM, 'i')) || []);
    if (rate) { amount = Math.round((fx * parseFloat(rate) + (fee[1] ? toNum(fee[1], fee[2]) : 0)) * 100) / 100; note = cur + ' ' + fx + ' (по курсу ' + rate + ')'; }
    else if (FX[cur]) { amount = Math.round(fx * FX[cur] * 100) / 100; note = cur + ' ' + fx + ' (≈ по курсу ' + FX[cur] + ')'; }
    else { amount = fx; note = cur + ' ' + fx + ' (не SAR)'; }
  }
  // "Amount: SAR 45.00" / "مبلغ: 45 ريال" → amount next to a currency → keyword before a number
  const lab = new RegExp('(?:amount|amt|مبلغ|المبلغ|بمبلغ|сумма)(?:\\s+in)?[:\\s]*(?:' + CUR + '[:\\s]*)?' + NUM, 'i');
  const kw = new RegExp('(?:покупка|оплата|списание|списано|расход|снятие|выдача|перевод|purchase|payment|spent|debit|pokupka|oplata)[^\\d*]{0,40}?' + NUM, 'i');
  if (amount == null && (m = body.match(lab))) {
    amount = toNum(m[1], m[2]);
    const fc = m[0].match(/\b(?!sar\b)([a-z]{3})\s*[\d]/i);
    if (fc && !note) note = fc[1].toUpperCase() + ' ' + amount + ' (не SAR)';
  }
  if (amount == null && (m = body.match(new RegExp(NUM + '\\s?' + CUR, 'i')))) amount = toNum(m[1], m[2]);
  if (amount == null && (m = body.match(new RegExp(CUR + '\\s?' + NUM, 'i')))) amount = toNum(m[1], m[2]);
  if (amount == null && (m = body.match(kw))) amount = toNum(m[1], m[2]);
  if (amount == null || !isFinite(amount) || amount <= 0) return null;

  // date inside SMS: 24.10.26 14:05 · 24/10/2026 · 2026-10-24 14:05 (a statement's due date is not when it happened)
  let date = new Date();
  const due = (raw.match(/due date[:\s]*(\d{4}-\d{2}-\d{2})/i) || [])[1] || '';
  const dated = raw.replace(/due date[:\s]*[\d-]+(?:\s+[\d:]+)?/i, ' ');
  const cands = [...dated.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/g)].map(m => [+m[1], +m[2], +m[3], m[4], m[5]])
    .concat([...dated.matchAll(/(?<![\d.,])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?![\d,])(?:\s+(\d{1,2}):(\d{2}))?/g)].filter(m => m[3] || m[4]).flatMap(m => [[m[3] ? +m[3] : date.getFullYear(), +m[2], +m[1], m[4], m[5]]]
      .concat(m[3] && m[3].length === 2 ? [[+m[1], +m[2], +m[3], m[4], m[5]]] : [])));
  // "26-10-25" reads as 26 Oct 2025 or 25 Oct 2026: of the readings that are not in the future, the most recent wins
  let best = null;
  for (let [y, mo, dd, hh, mi] of cands) {
    if (y < 100) y += 2000;
    const d = new Date(y, mo - 1, dd, hh ? +hh : 12, mi ? +mi : 0);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31 && d <= new Date(Date.now() + 864e5) && d > new Date(Date.now() - 400 * 864e5) && (!best || d > best)) best = d;
  }
  if (best) date = best;

  // merchant: taken from the SMS's own labels (At:, From:, Sender:, Provider: …), on one line or many;
  // a value that is only digits / masked numbers / card brands never names a shop
  // the labels banks put after a value; a value runs until one of them ("From: UBER * PENDING Card Number: …")
  const NEXT_LABEL = 'card(?: number)?|account(?: number)?|acc(?: no)?|date|on|amount|total amount|iban|bank|balance|country|exchange rate|fees(?: and vat)?|from|to|at|reference no|service|provider|name|via|sender|merchant';
  const lbl = names => {
    const x = raw.match(new RegExp('(?:^|\\s)(?:' + names + ')\\s*:\\s*(.{1,40}?)(?=\\s*(?:\\n|,|;|$)|\\s+(?:' + NEXT_LABEL + ')\\s*:)', 'i'));
    const v = x ? x[1].trim() : '';
    return /[A-Za-z؀-ۿ]/.test(v) && !/^(?:mada|visa|master\s*card|apple pay)\b/i.test(v) ? v : '';
  };
  let merchant = '';
  if ((m = raw.match(/^(.{2,25}?)\s+payments?\b[^]*?provider\s*:\s*([^\n]{2,40})/i))) merchant = m[1].trim() + ' · ' + m[2].trim();
  merchant = merchant || lbl('sender') || lbl('at|merchant|biller|لدى|عند|المتجر|التاجر') || lbl('from|من') || lbl('name')
    || (/transfer/i.test(raw) ? lbl('to') : '');
  if (!merchant && (m = body.match(/(?:\bв\b|магазин)\s+([^,;\n]{2,40}?)(?=[.,;\n]|\s+\d|$)/i))) merchant = m[1];
  if (!merchant && (m = body.match(/\bat\s+([A-Za-z][^,;\n]{1,40}?)(?=[.,;\n]|\s+\d|\s+for\s|$)/i))) merchant = m[1];   // "was used at UBER for SAR"
  if (!merchant && (m = body.match(/\b([A-Z][A-Z0-9*'&\-. ]{3,30})\b/))) merchant = m[1];
  if (PAYOFF.test(raw)) merchant = PAYOFF_CAT;
  merchant = merchant.replace(new RegExp(CUR, 'ig'), '').replace(/\s+/g, ' ').trim();
  if (/^[*\d\s.,:-]+$/.test(merchant)) merchant = '';   // a masked account number or an amount is not a merchant

  const hay = (from + ' ' + raw).toLowerCase();
  const src = S.sources.find(s => s.key.split('|').some(k => k.trim() && hay.includes(k.trim().toLowerCase())));
  if (!src && S.onlyKnown) return null;
  const rule = S.rules.find(r => r.key.split('|').some(k => k.trim() && hay.includes(k.trim().toLowerCase())));
  if (STATEMENT.test(raw)) {
    // SAB issues the statement ~24 days before the due date
    const dd = due ? new Date(due + 'T12:00:00') : null;
    return { id: uid(), date: (dd ? new Date(dd - 24 * 864e5) : date).toISOString(), amount, merchant: 'Счёт по карте', due,
      source: src ? src.name : (from || 'Другое'), category: 'Счёт по кредитке', kind: 'statement', note: due ? 'оплатить до ' + due : '',
      income: false, transfer: false, origin: 'sms', raw, h: hash(raw) };
  }
  if (REFUND.test(body)) amount = -amount;
  return {
    id: uid(), date: date.toISOString(), amount, merchant,
    source: src ? src.name : (from || 'Другое'),
    category: rule ? rule.cat : PAYOFF.test(body) ? PAYOFF_CAT : /outgoing transfer|تحويل صادر|исходящий перевод/i.test(body) ? 'Переводы'
      : !REFUND.test(body) && INCOME.test(body) ? (/cashback|кешбэк|кэшбэк/i.test(body) ? 'Кешбэк' : /salary|راتب|зарплат/i.test(body) ? 'Зарплата' : 'Поступления')
      : /withdraw|\batm\b|cash withdrawal|سحب|صراف|снятие налич|банкомат/i.test(body) ? 'Наличные'
      : HOLD.test(merchant) ? 'Блокировка (pending)' : guessCat(merchant) || (src && src.cat) || 'Без категории',
    kind: otp ? 'otp' : HOLD.test(merchant) ? 'hold' : !INCOME.test(body) && CASH.test(body) ? 'cash' : undefined,
    note, income: !PAYOFF.test(body) && !REFUND.test(body) && INCOME.test(body), transfer: PAYOFF.test(body), origin: 'sms', raw, h: hash(raw), bal
  };
}

// the real purchase behind a confirmation code: same card, within a day, the same amount or that amount plus fees (≤ 6 %)
const sameBuy = (code, x) => x !== code && x.kind !== 'otp' && x.note !== 'по коду подтверждения' && !x.income && !isXfer(x)
  && x.source.split(' ')[0] === code.source.split(' ')[0] && Math.abs(new Date(x.date) - new Date(code.date)) < 864e5
  && x.amount >= code.amount - 0.01 && x.amount <= code.amount * 1.06;
const isDup = t => S.tx.some(x => x.h === t.h || (x.origin === 'sms' && x.amount === t.amount && x.date.slice(0, 16) === t.date.slice(0, 16)));

function askCard() {
  const cards = S.sources.filter(s => s.type === 'credit').map(s => s.name);
  const a = prompt('Какую кредитку погасили? ' + cards.map((c, i) => `${i + 1} — ${c}`).join(', '), '1');
  return cards[+a - 1] || '';
}

function addSms(text, from) {
  const t = parseSms(text, from);
  if (!t) return { ok: false, msg: 'не похоже на трату' };
  if (isDup(t)) return { ok: false, msg: 'уже есть' };
  if (isXfer(t) || isInfo(t)) t.payTo = cardFor(t);
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
const COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b', '#0ea5e9', '#a855f7', '#14b8a6', '#eab308', '#f43f5e', '#6366f1', '#22c55e', '#d946ef', '#78716c', '#fb923c'];

function render() {
  const exp = S.tx.filter(t => !t.income && !isXfer(t) && !isInfo(t));
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
  const keyHit = t => !st.fKey || (st.fKey === 'Прочее' && st.rest ? st.rest.includes(t[st.split]) : t[st.split] === st.fKey);
  const inKey = keyHit;
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
  const incP = S.tx.filter(t => t.income && !isXfer(t) && !isInfo(t) && new Date(t.date) >= a && new Date(t.date) < b).reduce((s, t) => s + t.amount, 0);
  $('ptotal').textContent = `Расходы: ${fmt(tot)} · доходы: +${fmt(incP)} · в среднем ${fmt(tot / nB)} за ${{ day: 'день', week: 'неделю', month: 'месяц' }[st.group]}` + (st.fBucket ? ` · выбрано: ${fmt(byB[st.fBucket] || 0)}` : '');

  // donut
  const inBucket = t => !st.fBucket || bucketOf(new Date(t.date)) === st.fBucket;
  const groups = {}; inP.filter(inBucket).forEach(t => groups[t[st.split]] = (groups[t[st.split]] || 0) + t.amount);
  let arr = Object.entries(groups).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]);
  st.rest = null;
  st.rest = null;   // every category gets its own slice, no «Прочее»
  const total = arr.reduce((s, x) => s + x[1], 0);
  let ang = -Math.PI / 2, d = '';
  arr.forEach(([k, v], i) => {
    const fr = v / total, a2 = ang + fr * Math.PI * 2, big = fr > .5 ? 1 : 0;
    const p = (r, t) => (100 + r * Math.cos(t)).toFixed(2) + ' ' + (100 + r * Math.sin(t)).toFixed(2);
    const op = st.fKey && st.fKey !== k ? .25 : 1;
    d += fr >= .9999 ? `<circle data-k="${esc(k)}" cx="100" cy="100" r="70" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="40" opacity="${op}"/>`
      : `<path data-k="${esc(k)}" d="M${p(90, ang)} A90 90 0 ${big} 1 ${p(90, a2)} L${p(50, a2)} A50 50 0 ${big} 0 ${p(50, ang)}Z" fill="${COLORS[i % COLORS.length]}" opacity="${op}"/>`;
    ang = a2;
  });
  d += `<text x="100" y="104" text-anchor="middle" style="font-size:15px;fill:var(--fg);font-weight:600">${total ? fmt(total) : 'нет данных'}</text>`;
  $('donut').innerHTML = d;
  $('legend').innerHTML = arr.map(([k, v], i) => `<div data-k="${esc(k)}" style="opacity:${st.fKey && st.fKey !== k ? .4 : 1}"><i style="background:${COLORS[i % COLORS.length]}"></i>${st.split === 'category' ? catIcon(k) + ' ' : ''}${esc(k)}<span class="mut">${Math.round(v / total * 100)}%</span><span class="v">${fmt(v)}</span></div>`).join('');

  // list
  let f = '';
  if (st.fBucket) f += `<span class="chip" data-clr="b">${st.fBucket} ✕</span>`;
  if (st.fKey) f += `<span class="chip" data-clr="k">${esc(st.fKey === 'Прочее' && st.rest ? 'Прочее: ' + st.rest.join(', ') : st.fKey)} ✕</span>`;
  $('filters').innerHTML = f;
  const list = S.tx.filter(t => { const dd = new Date(t.date); return dd >= a && dd < b; })
    .filter(t => inBucket(t) && keyHit(t))
    .sort(st.sort === 'sum' ? (x, y) => Math.abs(y.amount) - Math.abs(x.amount) : st.sort === 'old' ? (x, y) => x.date.localeCompare(y.date) : (x, y) => y.date.localeCompare(x.date)).slice(0, 300);
  $('list').innerHTML = list.length ? list.map(t => `<div class="row"><div><div>${catIcon(t.category)} ${esc(t.merchant || t.note || t.category)}</div>
    <div class="m">${new Date(t.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(t.source)}${t.merchant && t.note ? " · " + esc(t.note) : ""} ·
    <select data-cat="${t.id}" style="width:auto;padding:2px;margin:0;font-size:12px">${catOptions(t.category)}</select>${t.merchant ? `<label style="font-size:11px;white-space:nowrap"><input type="checkbox" data-own="${t.id}" ${t.own ? 'checked' : ''} style="width:auto;margin:0 2px 0 6px">только эта</label>` : ''}</div></div>
    <div class="amt ${t.income ? 'inc' : ''}">${t.income || t.amount < 0 ? '+' : '−'}${fmt(Math.abs(t.amount))}</div><button class="del" data-del="${t.id}">×</button></div>`).join('')
    : '<p class="mut">Пока пусто</p>';

  // datalists
  const cats = allCats(), srcs = [...new Set(S.tx.map(t => t.source).concat(S.sources.map(s => s.name)))];
  $('dl-cat').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  $('dl-src').innerHTML = srcs.map(c => `<option value="${esc(c)}">`).join('');
}
// the standard list; the user's own categories (S.cats) come after it
const CATS = [['Продукты', '🛒'], ['Кафе и рестораны', '☕'], ['Доставка еды', '🍔'], ['Такси', '🚕'], ['Транспорт', '🚌'], ['Топливо', '⛽'],
  ['Авто', '🚗'], ['Дом', '🏠'], ['Коммунальные', '💡'], ['Интернет', '🌐'], ['Связь', '📱'], ['Здоровье', '💊'], ['Красота', '💇'],
  ['Одежда', '👕'], ['Покупки', '🛍️'], ['Развлечения', '🎬'], ['Спорт', '🏋️'], ['Путешествия', '✈️'], ['Образование', '🎓'],
  ['Дети', '🧸'], ['Семья', '👨‍👩‍👧'], ['Подарки', '🎁'], ['Подписки', '🧾'], ['Страховка', '🛡️'], ['Штрафы', '🚨'], ['Госуслуги', '🏛️'], ['Переводы', '💸'], ['В долг', '🤝'], ['Наличные', '💵'],
  ['Погашение кредитки', '💳'], ['Счёт по кредитке', '🧾'], ['Блокировка (pending)', '⏳'], ['Зарплата', '💰'], ['Кешбэк', '🎉'], ['Поступления', '📥'], ['Без категории', '❓']];
const catIcon = n => ((S.cats || []).find(c => c.name === n) || {}).icon || (CATS.find(c => c[0] === n) || [])[1] || '🏷️';
const allCats = () => [...new Set(CATS.map(c => c[0]).concat((S.cats || []).map(c => c.name),
  S.tx.map(t => t.category), S.rules.map(r => r.cat), S.sources.map(s => s.cat)).filter(Boolean))];
const catOptions = (cur, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '')
  + allCats().map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${catIcon(c)} ${esc(c)}</option>`).join('')
  + '<option value="__new">＋ Новая категория…</option>';
function newCat() {
  const name = (prompt('Название новой категории') || '').trim(); if (!name) return '';
  const icon = (prompt('Иконка (эмодзи), можно оставить пустым', '🏷️') || '🏷️').trim();
  S.cats = S.cats || []; if (!S.cats.some(c => c.name === name)) S.cats.push({ name, icon }); save();
  return name;
}
// any category <select>: "＋ Новая…" creates one and selects it
document.addEventListener('change', e => {
  const s = e.target; if (s.tagName !== 'SELECT' || s.value !== '__new' || s.dataset.cat) return;
  const n = newCat(); s.innerHTML = catOptions(n, s.dataset.blank); s.value = n;
}, true);

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
seg('sort', 'o', v => { st.sort = v; });   // operations: newest / oldest first, or biggest amount first
$('prev').onclick = () => { st.offset--; st.fBucket = null; render(); };
$('next').onclick = () => { st.offset++; st.fBucket = null; render(); };
$('bars').onclick = e => { const k = e.target.dataset.b; if (k) { st.fBucket = st.fBucket === k ? null : k; render(); } };
let pressed = false;   // a long press opened the editor: the click that follows must not filter
$('donut').onclick = $('legend').onclick = e => { if (pressed) { pressed = false; return; } const el = e.target.closest('[data-k]'); if (el) { st.fKey = st.fKey === el.dataset.k ? null : el.dataset.k; render(); } };

// long press on a category in the legend: rename it and change its icon (operations, rules and own list follow)
function editCat(name) {
  const n = (prompt('Название категории', name) || '').trim(); if (!n) return;
  const icon = (prompt('Иконка (эмодзи)', catIcon(name)) || catIcon(name)).trim();
  S.cats = S.cats || [];
  S.tx.forEach(t => { if (t.category === name) t.category = n; });
  S.rules.forEach(r => { if (r.cat === name) r.cat = n; });
  S.sources.forEach(x => { if (x.cat === name) x.cat = n; });
  const own = S.cats.find(c => c.name === name);
  if (own) { own.name = n; own.icon = icon; }
  else if (S.cats.some(c => c.name === n)) S.cats.find(c => c.name === n).icon = icon;
  else S.cats.push({ name: n, icon });   // a standard category gets an override with the new icon
  if (st.fKey === name) st.fKey = n;
  save(); render(); renderSet();
}
let pressT = null;
$('legend').addEventListener('touchstart', e => {
  const el = e.target.closest('[data-k]'); if (!el || st.split !== 'category') return;
  pressT = setTimeout(() => { pressed = true; editCat(el.dataset.k); }, 600);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(ev => $('legend').addEventListener(ev, () => clearTimeout(pressT), { passive: true }));
$('legend').addEventListener('contextmenu', e => {   // right click / long press on desktop
  const el = e.target.closest('[data-k]'); if (!el || st.split !== 'category') return;
  e.preventDefault(); editCat(el.dataset.k);
});
$('filters').onclick = e => { const c = e.target.dataset.clr; if (c === 'b') st.fBucket = null; if (c === 'k') st.fKey = null; render(); };
$('list').onclick = e => { const id = e.target.dataset.del; if (id && confirm('Удалить операцию?')) { S.tx = S.tx.filter(t => t.id !== id); save(); render(); } };
$('list').onchange = e => {
  const oid = e.target.dataset.own;
  if (oid) { const t = S.tx.find(x => x.id === oid); if (e.target.checked) t.own = true; else delete t.own; save(); return; }
  const id = e.target.dataset.cat; if (!id) return;
  let c = e.target.value; if (c === '__new') { c = newCat(); if (!c) return render(); }
  const t = S.tx.find(x => x.id === id); t.category = c;
  if (c === PAYOFF_CAT) { t.income = false; t.payTo = cardFor(t) || askCard(); }
  // «только эта» ticked: this purchase alone; otherwise the shop's purchases (except other «только эта» ones) and future ones follow
  if (t.merchant && !t.own) {
    S.rules.unshift({ key: t.merchant, cat: c });
    S.tx.forEach(x => { if (x.merchant === t.merchant && !x.own) x.category = c; });
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
/* ---------- «Подгрузить»: run the user's Shortcut, which reopens the app with the SMS ---------- */
// each card has its own Shortcut name (set in Settings); a bank-wide name saved earlier is the fallback
const bankOf = src => src.split(' ')[0];
const scName = src => (S.scNames || {})[src] || (S.scNames || {})[bankOf(src)] || 'История ' + bankOf(src);

function renderPull() {
  // one button per distinct Shortcut: cards sharing a Shortcut share a button
  const by = {};
  S.sources.forEach(s => { (by[scName(s.name)] = by[scName(s.name)] || []).push(s.name); });
  $('pull').innerHTML = Object.entries(by).map(([sc, names]) =>
    `<button data-pull="${esc(sc)}">⟳ ${esc(names.length > 1 ? bankOf(names[0]) : names[0])}</button>`).join('')
    + '<button data-paste="1" title="Вставить SMS из буфера">📋</button><button data-hide="1" title="Скрыть суммы">' + (S.hide ? '🙈' : '👁') + '</button><button data-reload="1" title="Обновить приложение">↻</button>';
}
$('pull').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.reload) return location.reload();
  if (b.dataset.paste) return pasteIntake();
  if (b.dataset.hide) return toggleHide();
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(b.dataset.pull);
};

function toggleHide() {
  S.hide = !S.hide; save();
  renderSet(); render(); if (window.renderSav) renderSav(); if (window.renderCash) renderCash();
  toast(S.hide ? 'Суммы скрыты' : 'Суммы видны');
}

function renderSet() {
  $('hide-btn').textContent = S.hide ? '🙈 Суммы скрыты — показать' : '👁 Скрыть суммы';
  renderPull();
  $('cat-list').innerHTML = (S.cats || []).map((c, i) => `<div class="row"><span>${c.icon} ${esc(c.name)}</span><button class="del" data-dc="${i}">×</button></div>`).join('') || '<p class="mut">Своих категорий нет</p>';
  // each bank shows what its Shortcut must be called and the exact Text line to paste into it
  const base = location.href.split('#')[0].split('?')[0];
  $('src-list').innerHTML = S.sources.map((s, i) => `<div class="row"><div style="min-width:0;flex:1">${esc(s.name)}<div class="m">${esc(s.key)} → ${esc(s.cat || '—')}</div>
    <details><summary class="m" style="color:var(--acc)">команда для этой карты</summary>
    <div class="m">Название команды (как в «Командах», точь-в-точь):</div>
    <input data-sc="${esc(s.name)}" value="${esc(scName(s.name))}">
    <div class="m">Строка для действия Text (в конец — URL Encoded Text):</div>
    <input readonly value="${esc(base)}#from=${encodeURIComponent(s.name.split(' ')[0])}&sms=" onclick="this.select()"></details></div>
    <button class="del" data-ds="${i}">×</button></div>`).join('') || '<p class="mut">Нет источников</p>';
  $('rule-list').innerHTML = S.rules.map((r, i) => `<div class="row"><div>${esc(r.key)}<div class="m">→ ${esc(r.cat)}</div></div><button class="del" data-dr="${i}">×</button></div>`).join('') || '<p class="mut">Нет правил</p>';
  $('cur').value = S.cur; $('only-known').checked = S.onlyKnown;
  $('hook').value = location.href.split('#')[0] + '#from=ОТПРАВИТЕЛЬ&sms=ТЕКСТ';
}
$('n-add').onclick = () => { const name = $('n-name').value.trim(), key = $('n-key').value.trim(); if (!name || !key) return alert('Название и ключ');
  S.sources.push({ name, key, cat: $('n-cat').value.trim(), type: $('n-type').value }); save(); $('n-name').value = $('n-key').value = $('n-cat').value = ''; renderSet(); };
$('r-add').onclick = () => { const key = $('r-key').value.trim(), cat = $('r-cat').value.trim(); if (!key || !cat) return;
  S.rules.push({ key, cat }); save(); $('r-key').value = $('r-cat').value = ''; renderSet(); };
$('src-list').onclick = e => { const i = e.target.dataset.ds; if (i != null) { S.sources.splice(+i, 1); save(); renderSet(); } };
$('src-list').addEventListener('change', e => {
  const b = e.target.dataset.sc; if (!b) return;
  S.scNames = S.scNames || {}; S.scNames[b] = e.target.value.trim(); save();
  renderPull(); toast('⟳ ' + b + ' запускает «' + scName(b) + '»');
});
$('cat-list').onclick = e => {
  const i = e.target.dataset.dc; if (i == null) return;
  const c = S.cats[+i]; if (!confirm(`Удалить категорию «${c.name}»?`)) return;
  S.cats.splice(+i, 1);
  S.tx.forEach(t => { if (t.category === c.name) t.category = 'Без категории'; });
  S.rules = S.rules.filter(r => r.cat !== c.name);
  save(); renderSet(); render();
};
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
  history.replaceState(null, '', location.pathname + location.search);
  if (bulkIntake(text, from)) return;
  const r = addSms(text, from);
  toast(r.ok ? `${r.t.income ? 'Доход' : 'Расход'} ${fmt(r.t.amount)} · ${r.t.source}` : 'SMS: ' + r.msg);
  render();
  // a tab the automation opened for one SMS closes itself when Safari allows it
  setTimeout(() => { try { window.close(); } catch (e) {} }, 2500);
}

// many SMS at once (Shortcuts "Find Messages" → joined with ###): show them for review
function bulkIntake(text, from) {
  const parts = text.split(/\n?\s*#{3,}\s*\n?/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  document.querySelector('nav [data-t="add"]').click();
  let found = [];
  try {
    const all = parts.map(x => parseSms(x, from));
    found = all.filter(Boolean);
    review(found, parts.filter((x, i) => !all[i]));
    window.scrollTo(0, 0);
  } catch (err) { alert('Ошибка разбора: ' + err.message); }
  toast(`Получено SMS: ${parts.length}, распознано операций: ${found.length}`);
  return true;
}

// the same without a new tab: the Shortcut copies the SMS, the user comes back and taps 📋
async function pasteIntake() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { return alert('Нет доступа к буферу обмена — разрешите «Вставить»'); }
  if (!text.trim()) return toast('Буфер обмена пуст');
  if (!bulkIntake(text, '')) { const r = addSms(text, ''); toast(r.ok ? `${r.t.income ? 'Доход' : 'Расход'} ${fmt(r.t.amount)} · ${r.t.source}` : 'SMS: ' + r.msg); render(); }
}
window.addEventListener('hashchange', intake);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
renderSet(); render();
window.addEventListener('load', intake);   // after scan.js (review) has loaded
window.addEventListener('resize', render);
