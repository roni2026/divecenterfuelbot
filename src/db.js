// Supabase's realtime client needs a global WebSocket. Node < 22 doesn't ship
// one, which makes createClient() throw on Render's Node 20 runtime. We don't
// use realtime here, but we still provide the `ws` polyfill so the client can
// be constructed.
if (!globalThis.WebSocket) {
  try {
    globalThis.WebSocket = require('ws');
  } catch (e) {
    // ws not installed; only a problem if realtime is actually used.
  }
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const IMAGE_BUCKET = 'fuel-chits';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_NAMES[d.getUTCDay()];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
async function listLogs({ start, end, type, boat } = {}) {
  let query = supabase
    .from('fuel_logs')
    .select('*')
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (start) query = query.gte('log_date', start);
  if (end) query = query.lte('log_date', end);
  if (type && type !== 'all') query = query.eq('fuel_type', type);
  if (boat) query = query.eq('boat_name', boat);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function findByImageHash(hash) {
  if (!hash) return null;
  const { data, error } = await supabase
    .from('fuel_logs')
    .select('id, log_date')
    .eq('image_hash', hash)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Soft dedup for a single entry: same date + boat + quantity already logged.
async function findDuplicateEntry({ log_date, boat_name, quantity }) {
  const { data, error } = await supabase
    .from('fuel_logs')
    .select('id')
    .eq('log_date', log_date)
    .eq('boat_name', boat_name)
    .eq('quantity', quantity)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getStats() {
  const total = await supabase.from('fuel_logs').select('*', { count: 'exact', head: true });
  const petrol = await supabase.from('fuel_logs').select('quantity').eq('fuel_type', 'petrol');
  const diesel = await supabase.from('fuel_logs').select('quantity').eq('fuel_type', 'diesel');
  const sum = rows => (rows.data || []).reduce((a, r) => a + Number(r.quantity || 0), 0);
  return {
    total: total.count || 0,
    petrolLitres: sum(petrol),
    dieselLitres: sum(diesel),
  };
}

// Per-boat totals for a range, split by fuel type.
async function getBoatTotals({ start, end } = {}) {
  const rows = await listLogs({ start, end });
  const map = new Map();
  for (const r of rows) {
    const key = `${r.fuel_type}|${r.boat_name}`;
    map.set(key, (map.get(key) || 0) + Number(r.quantity || 0));
  }
  const totals = [];
  for (const [key, litres] of map.entries()) {
    const [fuel_type, boat_name] = key.split('|');
    totals.push({ fuel_type, boat_name, litres: +litres.toFixed(2) });
  }
  totals.sort((a, b) => a.fuel_type.localeCompare(b.fuel_type) || b.litres - a.litres);
  return totals;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function insertLog(record) {
  const { data, error } = await supabase.from('fuel_logs').insert(record).select().single();
  if (error) throw error;
  return data;
}

async function insertLogs(records) {
  const { data, error } = await supabase.from('fuel_logs').insert(records).select();
  if (error) throw error;
  return data;
}

async function updateLog(id, patch) {
  const { data, error } = await supabase
    .from('fuel_logs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteLog(id) {
  const { error } = await supabase.from('fuel_logs').delete().eq('id', id);
  if (error) throw error;
}

async function uploadImage(buffer, filename) {
  const path = `${Date.now()}_${filename}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) {
    console.error('Image upload failed:', error.message);
    return null;
  }
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// Delete archived chit photos older than `days`; log rows/values are kept.
async function deleteOldImages(days = 60) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: rows, error } = await supabase
    .from('fuel_logs')
    .select('id, image_path')
    .lt('log_date', cutoff)
    .not('image_path', 'is', null);
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const paths = [...new Set(rows.map(r => r.image_path).filter(Boolean))];
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from(IMAGE_BUCKET).remove(paths);
    if (removeError) console.error('Failed removing some images:', removeError.message);
  }
  const ids = rows.map(r => r.id);
  const { error: updateError } = await supabase
    .from('fuel_logs')
    .update({ image_url: null, image_path: null })
    .in('id', ids);
  if (updateError) throw updateError;
  return rows.length;
}

module.exports = {
  supabase,
  listLogs,
  findByImageHash,
  findDuplicateEntry,
  getStats,
  getBoatTotals,
  insertLog,
  insertLogs,
  updateLog,
  deleteLog,
  uploadImage,
  deleteOldImages,
  dayName,
};
