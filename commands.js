const { Markup } = require('telegraf');
const { listLogs, getStats, getBoatTotals } = require('./src/db');

function fmtNum(n) {
  if (n === null || n === undefined) return 'N/A';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function fmtEntry(r) {
  const icon = r.fuel_type === 'petrol' ? '🟢' : '🔵';
  return `${r.log_date} · ${icon} ${r.boat_name} — ${fmtNum(r.quantity)} ${r.unit || 'Ltrs'}`;
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Today', 'MENU_TODAY'), Markup.button.callback('🆕 Latest', 'MENU_LATEST')],
    [Markup.button.callback('🟢 Petrol', 'MENU_PETROL'), Markup.button.callback('🔵 Diesel', 'MENU_DIESEL')],
    [Markup.button.callback('⛴️ Totals per boat', 'MENU_BOATS')],
    [Markup.button.callback('🗓 Last 7 days', 'MENU_WEEK'), Markup.button.callback('🗓 Last 30 days', 'MENU_MONTH')],
    [Markup.button.callback('📊 Stats', 'MENU_STATS'), Markup.button.callback('🖥 Dashboard', 'MENU_DASHBOARD')],
    [Markup.button.callback('❓ Help', 'MENU_HELP')],
  ]);
}

function summarize(rows) {
  const p = rows.filter(r => r.fuel_type === 'petrol').reduce((a, r) => a + Number(r.quantity || 0), 0);
  const d = rows.filter(r => r.fuel_type === 'diesel').reduce((a, r) => a + Number(r.quantity || 0), 0);
  return `⛽ Petrol: ${fmtNum(p)} L · Diesel: ${fmtNum(d)} L`;
}

async function sendToday(ctx) {
  const today = ymd(new Date());
  const rows = await listLogs({ start: today, end: today });
  if (!rows.length) return ctx.reply('No fuel entries logged today yet. Send a chit photo to log some.');
  await ctx.reply(`📅 Today — ${today}\n\n` + rows.map(fmtEntry).join('\n') + `\n\n${summarize(rows)}`);
}

async function sendLatest(ctx) {
  const rows = (await listLogs({})).slice(0, 15);
  if (!rows.length) return ctx.reply('No entries logged yet.');
  await ctx.reply('🆕 Latest entries:\n\n' + rows.map(fmtEntry).join('\n'));
}

async function sendByType(ctx, type) {
  const rows = (await listLogs({ type })).slice(0, 15);
  if (!rows.length) return ctx.reply(`No ${type} entries logged yet.`);
  await ctx.reply(`${type === 'petrol' ? '🟢 Petrol' : '🔵 Diesel'} — latest entries:\n\n` + rows.map(fmtEntry).join('\n'));
}

async function sendRange(ctx, days, label) {
  const end = new Date();
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const rows = await listLogs({ start: ymd(start), end: ymd(end) });
  if (!rows.length) return ctx.reply(`No entries logged in the ${label}.`);
  const limited = rows.slice(0, 25);
  let msg =
    `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${rows.length} entries\n${summarize(rows)}\n\n` +
    limited.map(fmtEntry).join('\n');
  if (rows.length > limited.length) msg += `\n\n...and ${rows.length - limited.length} more. See the dashboard.`;
  await ctx.reply(msg);
}

async function sendBoats(ctx) {
  const totals = await getBoatTotals({});
  if (!totals.length) return ctx.reply('No entries logged yet.');
  const petrol = totals.filter(t => t.fuel_type === 'petrol');
  const diesel = totals.filter(t => t.fuel_type === 'diesel');
  const fmtList = arr => arr.map(t => `  ${t.boat_name}: ${fmtNum(t.litres)} L`).join('\n') || '  (none)';
  await ctx.reply(
    '⛴️ *Total litres per boat*\n\n🟢 *Petrol*\n' + fmtList(petrol) + '\n\n🔵 *Diesel*\n' + fmtList(diesel),
    { parse_mode: 'Markdown' }
  );
}

async function sendStats(ctx) {
  const s = await getStats();
  await ctx.reply(
    `📊 Log stats\nTotal entries: ${s.total}\n🟢 Petrol: ${fmtNum(s.petrolLitres)} L\n🔵 Diesel: ${fmtNum(s.dieselLitres)} L`
  );
}

async function sendDashboard(ctx) {
  const url = process.env.DASHBOARD_URL || process.env.WEBHOOK_URL || '(dashboard URL not configured)';
  await ctx.reply(
    `🖥 Dashboard: ${url}\nLog in with your admin username and password to view, edit, filter, or export (Excel/PDF).`
  );
}

async function sendHelp(ctx) {
  await ctx.reply(
    'ℹ️ *How this bot works*\n\n' +
      '1. Send a photo of a FUEL CHIT — no caption needed.\n' +
      '2. I OCR it, and for every boat with a written quantity I log an entry (boat, litres, ' +
      'Petrol/Diesel, and the section date).\n' +
      '3. One chit logs several boats at once. The *same photo twice* is ignored, and a row that ' +
      'exactly matches an existing date+boat+qty is skipped.\n' +
      '4. Dates come from the chit; if none is readable I use the photo date, else today (flagged). ' +
      'Send as a *File* to preserve the photo date.\n' +
      '5. Export from the dashboard to an Excel formatted exactly like your Dive Centre sheet ' +
      '(Petrol & Diesel side by side, with per-column TOTAL and a per-boat totals sheet).\n' +
      '6. Chit photos auto-delete after 60 days; the logged numbers are kept forever.\n' +
      '7. Correct anything anytime in the dashboard.\n\n' +
      '*Commands*\n/today /latest — recent entries\n/petrol /diesel — by fuel\n/boats — totals per boat\n' +
      '/week /month — history\n/stats /dashboard — totals & web link'
  , { parse_mode: 'Markdown' });
}

function isAdmin(ctx) {
  const adminUsername = process.env.TELEGRAM_ADMIN_USERNAME;
  if (!adminUsername) return true;
  return !!(ctx.from && ctx.from.username && ctx.from.username.toLowerCase() === adminUsername.toLowerCase());
}

module.exports = {
  mainMenuKeyboard,
  sendToday,
  sendLatest,
  sendByType,
  sendRange,
  sendBoats,
  sendStats,
  sendDashboard,
  sendHelp,
  isAdmin,
  fmtEntry,
};
