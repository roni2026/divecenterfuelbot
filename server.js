require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const { Telegraf } = require('telegraf');
const path = require('path');

const { registerBot, setupBotMenu, IMAGE_RETENTION_DAYS } = require('./bot');
const { requireAuth, login, logout, me } = require('./src/auth');
const { listLogs, insertLog, updateLog, deleteLog, deleteOldImages } = require('./src/db');
const { buildExcel, buildPdf } = require('./src/export');

const app = express();
app.use(express.json());
app.use(
  cookieSession({
    name: 'session',
    secret: process.env.SESSION_SECRET || 'change-me',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// --- Auth ---
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', me);

// --- Logs ---
app.get('/api/logs', requireAuth, async (req, res) => {
  try {
    const { start, end, type, boat } = req.query;
    const rows = await listLogs({ start, end, type, boat });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logs', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.log_date || !b.boat_name || !b.fuel_type) {
      return res.status(400).json({ error: 'log_date, boat_name and fuel_type are required' });
    }
    const row = await insertLog({
      log_date: b.log_date,
      boat_name: b.boat_name,
      fuel_type: b.fuel_type,
      section: b.section || null,
      quantity: b.quantity == null ? 0 : Number(b.quantity),
      unit: b.unit || 'Ltrs',
      source: 'dashboard',
    });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/logs/:id', requireAuth, async (req, res) => {
  try {
    const patch = { ...req.body };
    if (patch.quantity !== undefined && patch.quantity !== null) patch.quantity = Number(patch.quantity);
    const row = await updateLog(req.params.id, patch);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/logs/:id', requireAuth, async (req, res) => {
  try {
    await deleteLog(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Exports ---
app.get('/api/export/excel', requireAuth, async (req, res) => {
  try {
    const { start, end, type } = req.query;
    const rows = await listLogs({ start, end, type });
    const buf = await buildExcel(rows, { start, end });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dive-centre-fuel-${start || 'all'}_${end || 'all'}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const { start, end, type } = req.query;
    const rows = await listLogs({ start, end, type });
    const buf = await buildPdf(rows, { start, end });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dive-centre-fuel-${start || 'all'}_${end || 'all'}.pdf"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Image cleanup ---
app.post('/api/cleanup-images', async (req, res) => {
  if (process.env.CRON_SECRET && req.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }
  try {
    const count = await deleteOldImages(IMAGE_RETENTION_DAYS);
    res.json({ ok: true, deleted: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Telegram bot (webhook mode) ---
const bot = new Telegraf(process.env.BOT_TOKEN);
registerBot(bot);
const secretPath = `/telegraf/${process.env.BOT_TOKEN}`;
app.use(bot.webhookCallback(secretPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (process.env.WEBHOOK_URL) {
    try {
      await bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}${secretPath}`);
      console.log('Telegram webhook set to', `${process.env.WEBHOOK_URL}${secretPath}`);
    } catch (e) {
      console.error('Failed to set Telegram webhook:', e.message);
    }
  } else {
    console.warn('WEBHOOK_URL not set - Telegram bot will not receive updates until it is set.');
  }

  try {
    await setupBotMenu(bot);
  } catch (e) {
    console.error('Failed to set bot command menu:', e.message);
  }

  deleteOldImages(IMAGE_RETENTION_DAYS)
    .then(count => console.log(`Startup image cleanup: removed ${count} photo(s)`))
    .catch(e => console.error('Startup image cleanup failed:', e.message));

  setInterval(() => {
    deleteOldImages(IMAGE_RETENTION_DAYS)
      .then(count => console.log(`Scheduled image cleanup: removed ${count} photo(s)`))
      .catch(e => console.error('Scheduled image cleanup failed:', e.message));
  }, 24 * 60 * 60 * 1000);
});
