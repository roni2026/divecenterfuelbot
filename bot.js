const crypto = require('crypto');

const { parseChit, BOATS } = require('./src/parser');
const { ocrImage } = require('./src/ocr');
const { getCaptureDateTime } = require('./src/exif');
const {
  insertLog,
  findByImageHash,
  findDuplicateEntry,
  uploadImage,
  deleteOldImages,
} = require('./src/db');
const {
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
} = require('./commands');

const IMAGE_RETENTION_DAYS = 60;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}
function fmtNum(n) {
  if (n === null || n === undefined) return 'N/A';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

async function setupBotMenu(bot) {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Show the main menu' },
    { command: 'today', description: "Today's fuel entries" },
    { command: 'latest', description: 'Most recent entries' },
    { command: 'petrol', description: 'Recent petrol entries' },
    { command: 'diesel', description: 'Recent diesel entries' },
    { command: 'boats', description: 'Total litres per boat' },
    { command: 'week', description: 'Last 7 days' },
    { command: 'month', description: 'This month so far' },
    { command: 'stats', description: 'Totals logged' },
    { command: 'dashboard', description: 'Web dashboard link' },
    { command: 'cleanup', description: 'Delete chit photos older than 60 days (admin)' },
    { command: 'help', description: 'How this bot works' },
  ]);
}

function registerBot(bot) {
  const welcome =
    '⛴️ *Dive Centre Fuel Log*\n\n' +
    'Send me a photo of a *FUEL CHIT* and I will read each boat’s litres, detect Petrol vs ' +
    'Diesel, and log every filled-in row with its date.\n\n' +
    'One chit can log several Coral boats at once. Sending the *same ' +
    'photo twice* is ignored. Export anytime to an Excel formatted just like your Dive Centre sheet.\n\n' +
    'Tip: to keep the real chit date, send the photo as a *File* (📎 → File) so its date metadata survives.\n\n' +
    'Use the menu below or the command list (☰).';

  bot.start(ctx => ctx.reply(welcome, { parse_mode: 'Markdown', ...mainMenuKeyboard() }));
  bot.help(sendHelp);
  bot.command('menu', ctx => ctx.reply('Main menu:', mainMenuKeyboard()));

  bot.command('today', sendToday);
  bot.command('latest', sendLatest);
  bot.command('petrol', ctx => sendByType(ctx, 'petrol'));
  bot.command('diesel', ctx => sendByType(ctx, 'diesel'));
  bot.command('boats', sendBoats);
  bot.command('week', ctx => sendRange(ctx, 7, 'last 7 days'));
  bot.command('month', ctx => sendRange(ctx, 30, 'last 30 days'));
  bot.command('stats', sendStats);
  bot.command('dashboard', sendDashboard);

  bot.command('cleanup', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('Only the admin can run this.');
    await ctx.reply(`Deleting archived chit photos older than ${IMAGE_RETENTION_DAYS} days...`);
    try {
      const count = await deleteOldImages(IMAGE_RETENTION_DAYS);
      await ctx.reply(`Done. Removed ${count} old photo(s). All log entries were kept.`);
    } catch (e) {
      console.error(e);
      await ctx.reply('Cleanup failed: ' + e.message);
    }
  });

  bot.action('MENU_TODAY', async ctx => { await ctx.answerCbQuery(); await sendToday(ctx); });
  bot.action('MENU_LATEST', async ctx => { await ctx.answerCbQuery(); await sendLatest(ctx); });
  bot.action('MENU_PETROL', async ctx => { await ctx.answerCbQuery(); await sendByType(ctx, 'petrol'); });
  bot.action('MENU_DIESEL', async ctx => { await ctx.answerCbQuery(); await sendByType(ctx, 'diesel'); });
  bot.action('MENU_BOATS', async ctx => { await ctx.answerCbQuery(); await sendBoats(ctx); });
  bot.action('MENU_WEEK', async ctx => { await ctx.answerCbQuery(); await sendRange(ctx, 7, 'last 7 days'); });
  bot.action('MENU_MONTH', async ctx => { await ctx.answerCbQuery(); await sendRange(ctx, 30, 'last 30 days'); });
  bot.action('MENU_STATS', async ctx => { await ctx.answerCbQuery(); await sendStats(ctx); });
  bot.action('MENU_DASHBOARD', async ctx => { await ctx.answerCbQuery(); await sendDashboard(ctx); });
  bot.action('MENU_HELP', async ctx => { await ctx.answerCbQuery(); await sendHelp(ctx); });

  bot.on('photo', async ctx => {
    try {
      const photos = ctx.message.photo;
      const best = photos[photos.length - 1];
      const buffer = await downloadTelegramFile(ctx, best.file_id);
      await processChit(ctx, buffer, { compressed: true });
    } catch (err) {
      console.error(err);
      await ctx.reply('Sorry, something went wrong reading that chit. Please try again or enter it manually in the dashboard.');
    }
  });

  bot.on('document', async ctx => {
    try {
      const doc = ctx.message.document;
      if (!doc || !(doc.mime_type || '').startsWith('image/')) return;
      const buffer = await downloadTelegramFile(ctx, doc.file_id);
      await processChit(ctx, buffer, { compressed: false });
    } catch (err) {
      console.error(err);
      await ctx.reply('Sorry, something went wrong reading that file. Please try again or enter it manually in the dashboard.');
    }
  });
}

async function downloadTelegramFile(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href);
  const arrBuf = await res.arrayBuffer();
  return Buffer.from(arrBuf);
}

async function processChit(ctx, buffer, { compressed }) {
  // 1. Deduplicate the whole image.
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const dupImage = await findByImageHash(imageHash).catch(() => null);
  if (dupImage) {
    return ctx.reply(
      `♻️ This exact chit photo was already logged (first entry on ${dupImage.log_date}). ` +
        `Skipping — nothing was double-counted.`
    );
  }

  await ctx.reply('📷 Chit received, reading it...');

  const [text, capture] = await Promise.all([ocrImage(buffer), getCaptureDateTime(buffer)]);
  const captureDate = capture ? capture.date : null;
  const fallbackDate = captureDate || toDateStr(new Date());

  const { entries, dates } = parseChit(text, fallbackDate);

  if (!entries.length) {
    return ctx.reply(
      '⚠️ I could not read any boat quantities on this chit.\n' +
        'Please make sure the photo is clear and upright, or add the entries manually in the dashboard.\n' +
        `Detected chit date: ${dates.coral || '—'}.`
    );
  }

  // Archive the photo once; reuse the URL/path for every row from this chit.
  const uploaded = await uploadImage(buffer, `chit_${Date.now()}.jpg`).catch(() => null);

  const saved = [];
  const skipped = [];
  for (const e of entries) {
    const dup = await findDuplicateEntry(e).catch(() => null);
    if (dup) { skipped.push(e); continue; }
    const record = {
      log_date: e.log_date,
      boat_name: e.boat_name,
      fuel_type: e.fuel_type,
      section: e.section,
      quantity: e.quantity,
      unit: e.unit,
      image_hash: imageHash,
      raw_ocr_text: text,
      telegram_user: ctx.from.username || `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
      telegram_message_id: ctx.message.message_id,
      source: 'telegram',
    };
    if (uploaded) { record.image_url = uploaded.url; record.image_path = uploaded.path; }
    const row = await insertLog(record);
    saved.push(row);
  }

  // Build a summary reply.
  const lines = [];
  lines.push(`✅ Logged *${saved.length}* entr${saved.length === 1 ? 'y' : 'ies'} from this chit:`);
  for (const r of saved) lines.push('• ' + fmtEntry(r));
  const pTot = saved.filter(r => r.fuel_type === 'petrol').reduce((a, r) => a + Number(r.quantity), 0);
  const dTot = saved.filter(r => r.fuel_type === 'diesel').reduce((a, r) => a + Number(r.quantity), 0);
  lines.push('');
  lines.push(`⛽ Petrol total: ${fmtNum(pTot)} L | Diesel total: ${fmtNum(dTot)} L`);
  if (skipped.length) {
    lines.push(`\n♻️ Skipped ${skipped.length} row(s) already logged for the same boat/date/qty.`);
  }
  if (!captureDate && !dates.coral) {
    lines.push('\n⚠️ I could not read a date on the chit or the photo, so today’s date was used. Please correct it in the dashboard if needed.');
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = { registerBot, setupBotMenu, IMAGE_RETENTION_DAYS };
