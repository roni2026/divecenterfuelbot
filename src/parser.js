// Parses a "FUEL CHIT" photo's OCR text into individual boat fuel entries.
//
// This log is for the CORAL BOAT dive centre only (Maafushivaru / Outrigger
// boats are intentionally NOT tracked here). Each boat is permanently either
// Petrol (P) or Diesel (D), so we hard-code that mapping and don't rely on OCR
// reading the P/D column. Each row may have a handwritten quantity (litres);
// rows with no number are simply not logged. The chit carries a handwritten
// date for the Coral section.

// Canonical Coral boats (order matches the printed chit).
const BOATS = [
  // CORAL BOAT
  { name: 'Sea Explorer', type: 'petrol', section: 'coral', aliases: ['sea explorer', 'seaexplorer', 'sea exploror', 'sea explore', 'seaexploror'] },
  { name: 'Jetski', type: 'petrol', section: 'coral', aliases: ['jetski', 'jet ski', 'jet-ski'] },
  { name: 'Gonzo', type: 'petrol', section: 'coral', aliases: ['gonzo', 'gonza', 'g0nzo'] },
  { name: 'Chill Time', type: 'diesel', section: 'coral', aliases: ['chill time', 'chilltime', 'chill lime', 'chi time'] },
  { name: 'Fish Stalker', type: 'diesel', section: 'coral', aliases: ['fish stalker', 'fishstalker', 'fish talker', 'fish staler', 'fish staker'] },
  { name: 'Arya', type: 'diesel', section: 'coral', aliases: ['arya', 'aryo', 'arla'] },
];

// Keywords marking the start of the (untracked) Maafushivaru / Outrigger
// section. Anything at/after one of these is ignored so the Maafushivaru date
// and boats never leak into the Coral log.
const OTHER_SECTION_RE = /outrigger|maafushi/i;

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

// Main entry point. Returns { entries: [...], dates: { coral } }.
function parseChit(rawText, fallbackDate) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n');

  // Mark each line as belonging to the coral section or the (ignored) other
  // section, so a stray Maafushivaru date/boat can't bleed into the Coral log.
  let sectionOfLine = [];
  let seenOther = false;
  for (const ln of lines) {
    if (OTHER_SECTION_RE.test(ln)) seenOther = true;
    sectionOfLine.push(seenOther ? 'other' : 'coral');
  }

  // Coral date: the first readable date token within the coral section.
  let coralDate = null;
  lines.forEach((ln, i) => {
    if (coralDate || sectionOfLine[i] !== 'coral') return;
    const iso = parseChitDate(ln);
    if (iso) coralDate = iso;
  });
  // Fallbacks: any date on the chit, then the photo/EXIF fallback date.
  if (!coralDate) {
    const dates = findDates(text);
    if (dates[0]) coralDate = dates[0].iso;
  }
  if (!coralDate) coralDate = fallbackDate || null;

  const entries = [];
  for (const boat of BOATS) {
    // find the first coral-section line that mentions this boat
    let lineIdx = -1;
    let matchedAlias = null;
    for (let i = 0; i < lines.length; i++) {
      if (sectionOfLine[i] !== 'coral') continue;
      const nl = normalize(lines[i]);
      const alias = boat.aliases.find(a => nl.includes(a));
      if (alias) { lineIdx = i; matchedAlias = alias; break; }
    }
    if (lineIdx === -1) continue;
    const qty = extractQtyFromLine(lines[lineIdx], matchedAlias);
    if (qty === null) continue; // no fuel written for this boat
    entries.push({
      boat_name: boat.name,
      fuel_type: boat.type,
      section: boat.section,
      quantity: qty,
      unit: 'Ltrs',
      log_date: coralDate,
    });
  }

  return { entries, dates: { coral: coralDate } };
}

module.exports = { BOATS, parseChit, parseChitDate, findDates, extractQtyFromLine, normalize };
