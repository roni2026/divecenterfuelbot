// Parses a "FUEL CHIT" photo's OCR text into individual boat fuel entries.
//
// A chit has a fixed template of boats, split into two sections. Each boat is
// permanently either Petrol (P) or Diesel (D), so we hard-code that mapping and
// don't rely on OCR reading the P/D column. Each row may have a handwritten
// quantity (litres); rows with no number are simply not logged. Each section
// carries its own handwritten date.

// Canonical boats (order matches the printed chit).
const BOATS = [
  // CORAL BOAT
  { name: 'Sea Explorer', type: 'petrol', section: 'coral', aliases: ['sea explorer', 'seaexplorer', 'sea exploror', 'sea explore', 'seaexploror'] },
  { name: 'Jetski', type: 'petrol', section: 'coral', aliases: ['jetski', 'jet ski', 'jet-ski'] },
  { name: 'Gonzo', type: 'petrol', section: 'coral', aliases: ['gonzo', 'gonza', 'g0nzo'] },
  { name: 'Chill Time', type: 'diesel', section: 'coral', aliases: ['chill time', 'chilltime', 'chill lime', 'chi time'] },
  { name: 'Fish Stalker', type: 'diesel', section: 'coral', aliases: ['fish stalker', 'fishstalker', 'fish talker', 'fish staler', 'fish staker'] },
  { name: 'Arya', type: 'diesel', section: 'coral', aliases: ['arya', 'aryo', 'arla'] },
  // OUTRIGGER BOAT
  { name: 'Dreamwever', type: 'petrol', section: 'outrigger', aliases: ['dreamwever', 'dreamweaver', 'dream wever', 'dream weaver', 'dreamwaver', 'dreamwver'] },
  { name: 'Wahoo', type: 'petrol', section: 'outrigger', aliases: ['wahoo', 'waboo', 'wahoe', 'wah00'] },
  { name: 'Barge', type: 'petrol', section: 'outrigger', aliases: ['barge', 'barga', 'barae'] },
  { name: 'Supply Boat', type: 'diesel', section: 'outrigger', aliases: ['supply boat', 'supplyboat', 'supply', 'suply boat'] },
  { name: 'Freef Watch', type: 'diesel', section: 'outrigger', aliases: ['freef watch', 'reef watch', 'free watch', 'freefwatch', 'reefwatch', 'freef wath'] },
  { name: 'Noohiri', type: 'diesel', section: 'outrigger', aliases: ['noohiri', 'noohir', 'noohiry', 'noohin', 'noohiri'] },
];

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a dd/mm/yy (or dd.mm.yy / dd-mm-yy) style date into an ISO yyyy-mm-dd
// string. Tolerates common OCR slips (e.g. a trailing letter instead of a
// digit) by keeping only digits in each part.
function parseChitDate(token) {
  if (!token) return null;
  const m = token.match(/(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  d = parseInt(d, 10);
  mo = parseInt(mo, 10);
  y = parseInt(y, 10);
  if (!d || !mo || d > 31 || mo > 12) return null;
  const year = y < 100 ? 2000 + y : y;
  if (year < 2000 || year > 2100) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${year}-${pad(mo)}-${pad(d)}`;
}

// Find all date tokens in the text, with their character offset.
function findDates(text) {
  const out = [];
  const re = /(\d{1,2}\s*[./\-]\s*\d{1,2}\s*[./\-]\s*\d{2,4})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const iso = parseChitDate(m[1]);
    if (iso) out.push({ iso, index: m.index });
  }
  return out;
}

// Extract the quantity written on a boat's line. Boat rows look like
// "SEA EXPLORER P 390" — we drop the boat name and the lone P/D marker and take
// the remaining 1-4 digit number as the quantity.
function extractQtyFromLine(line, alias) {
  let rest = normalize(line);
  // remove the matched boat alias
  rest = rest.replace(alias, ' ');
  // drop a standalone p/d fuel marker
  rest = rest.replace(/\b[pd]\b/g, ' ');
  const nums = rest.match(/\d{1,4}(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  // Take the largest plausible number (quantities dominate any stray digit).
  const vals = nums.map(Number).filter(n => n > 0 && n <= 9999);
  if (!vals.length) return null;
  return Math.max(...vals);
}

// Main entry point. Returns { entries: [...], dates: {coral, outrigger}, boatsSeen }.
function parseChit(rawText, fallbackDate) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n');
  const norm = normalize(text);

  // Determine where the OUTRIGGER section starts to attribute dates/rows.
  const outriggerIdx = norm.indexOf('outrigger');

  // Dates: those before the OUTRIGGER keyword belong to the coral section,
  // those after to the outrigger section. Fall back across sections.
  const dates = findDates(text);
  // Map char index in original text roughly to normalized by searching lines.
  let coralDate = null;
  let outriggerDate = null;
  // Build a section marker per line.
  let sectionOfLine = [];
  let seenOutrigger = false;
  for (const ln of lines) {
    if (/outrigger/i.test(ln)) seenOutrigger = true;
    sectionOfLine.push(seenOutrigger ? 'outrigger' : 'coral');
  }
  // Assign dates by scanning lines for date tokens.
  lines.forEach((ln, i) => {
    const iso = parseChitDate(ln);
    if (!iso) return;
    if (sectionOfLine[i] === 'outrigger' && !outriggerDate) outriggerDate = iso;
    else if (sectionOfLine[i] === 'coral' && !coralDate) coralDate = iso;
  });
  // Fallbacks
  if (!coralDate && dates[0]) coralDate = dates[0].iso;
  if (!outriggerDate && dates.length) outriggerDate = dates[dates.length - 1].iso;
  if (!coralDate) coralDate = outriggerDate || fallbackDate || null;
  if (!outriggerDate) outriggerDate = coralDate || fallbackDate || null;

  const entries = [];
  for (const boat of BOATS) {
    // find the first line that mentions this boat
    let lineIdx = -1;
    let matchedAlias = null;
    for (let i = 0; i < lines.length; i++) {
      const nl = normalize(lines[i]);
      const alias = boat.aliases.find(a => nl.includes(a));
      if (alias) { lineIdx = i; matchedAlias = alias; break; }
    }
    if (lineIdx === -1) continue;
    const qty = extractQtyFromLine(lines[lineIdx], matchedAlias);
    if (qty === null) continue; // no fuel written for this boat
    const date = boat.section === 'coral' ? coralDate : outriggerDate;
    entries.push({
      boat_name: boat.name,
      fuel_type: boat.type,
      section: boat.section,
      quantity: qty,
      unit: 'Ltrs',
      log_date: date,
    });
  }

  return { entries, dates: { coral: coralDate, outrigger: outriggerDate } };
}

module.exports = { BOATS, parseChit, parseChitDate, findDates, extractQtyFromLine, normalize };
