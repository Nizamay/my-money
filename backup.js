'use strict';
/* ---------- backup: the whole state as one JSON file in Files / iCloud Drive, and restore from it ---------- */
const BK_KEY = 'mymoney.lastBackup';
const lastBk = () => { try { return +localStorage.getItem(BK_KEY) || 0; } catch (e) { return 0; } };

// ask Safari not to evict our storage under pressure (granted silently or not at all)
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

function bkInfo() {
  const t = lastBk(), days = t ? Math.floor((Date.now() - t) / 864e5) : null;
  $('bk-last').textContent = t ? `Последняя копия: ${new Date(t).toLocaleDateString('ru-RU')} (${days} дн. назад)` : 'Копий ещё не было';
  const warn = S.tx.length > 0 && (days === null || days >= 7);
  $('bk-warn').style.display = warn ? '' : 'none';
  if (warn) $('bk-warn').innerHTML = `<div class="row" style="border:0"><span>💾 ${days === null ? 'Нет резервной копии' : `Копии не было ${days} дн.`} — сохраните данные в Файлы</span>
    <button class="del" style="color:var(--acc);font-size:15px" id="bk-now">Сохранить</button></div>`;
}

async function bkSave() {
  const name = 'my-money-' + ymd(new Date()) + '.json';
  const file = new File([JSON.stringify(Object.assign({ app: 'my-money', saved: new Date().toISOString() }, S))], name, { type: 'application/json' });
  try {
    // iPhone: the share sheet has «Сохранить в Файлы»
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: name });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); }
  } catch (e) { if (e.name === 'AbortError') return; alert('Не удалось сохранить: ' + e.message); return; }
  try { localStorage.setItem(BK_KEY, String(Date.now())); } catch (e) {}
  toast('Копия сохранена'); bkInfo();
}

$('bk-save').onclick = bkSave;
$('bk-warn').onclick = e => { if (e.target.id === 'bk-now') bkSave(); };
$('bk-load').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let d; try { d = JSON.parse(await f.text()); } catch (err) { return alert('Это не файл копии'); }
  if (!d || !Array.isArray(d.tx)) return alert('Это не файл копии');
  const add = d.tx.filter(t => !S.tx.some(x => x.id === t.id));
  if (!confirm(`В копии ${d.tx.length} операций, новых для телефона: ${add.length}. Добавить их, а также копилки, правила и категории?`)) return;
  S.tx.push(...add);
  const merge = (k, id) => (d[k] || []).forEach(x => { if (!(S[k] = S[k] || []).some(y => y[id] === x[id])) S[k].push(x); });
  merge('sources', 'name'); merge('rules', 'key'); merge('cats', 'name'); merge('sav', 'id');
  if (d.cur) S.cur = d.cur;
  save(); render(); renderSet(); if (window.renderSav) renderSav(); bkInfo();
  toast('Восстановлено операций: ' + add.length);
};

// manual-add form gets the same category list
$('a-cat').innerHTML = catOptions('', '— категория —');
bkInfo();
