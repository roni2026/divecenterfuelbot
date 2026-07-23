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

// Handwritten years OCR poorly (e.g. a '6' read as '0', so 18/07/26 -> 18/07/20).
// The day and month read far more reliably, so if the chit's year is more than a
// year away from the photo/fallback year, keep the chit's day+month but snap the
// year to the fallback's.
function reconcileYear(iso, fallback) {
  if (!iso || !fallback) return iso;
  const a = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const b = String(fallback).match(/^(\d{4})-/);
  if (!a || !b) return iso;
  const fbYear = parseInt(b[1], 10);
  if (Math.abs(parseInt(a[1], 10) - fbYear) > 1) return `${fbYear}-${a[2]}-${a[3]}`;
  return iso;
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

// A boat row on the chit is "NAME  P/D  [qty]". OCR (Engine 3) usually splits
// the name, the P/D marker and the handwritten quantity onto separate lines:
//   ARYA
//   D 390
// The quantity, when written, sits on the SAME line as the P/D marker. Stray
// numbers from the background (calendar dates like 11, 13, 20, 27) land on
// their own number-only lines with no P/D marker, so keying the quantity off
// the marker line avoids picking those up.
function markerInfo(lineNorm) {
  const isMarker = /\b[pd]\b/.test(lineNorm);
  if (!isMarker) return { isMarker: false, qty: null };
  const cleaned = lineNorm.replace(/\b[pd]\b/g, ' ');
  const nums = (cleaned.match(/\d{1,4}(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(n => n > 0 && n <= 9999);
  return { isMarker: true, qty: nums.length ? Math.max(...nums) : null };
}

function lineMentionsOtherBoat(lineNorm, self) {
  return BOATS.some(b => b !== self && b.aliases.some(a => lineNorm.includes(a)));
}

// For one boat, find its name line (within the coral section), then read the
// quantity off that boat's P/D marker line (the name line itself or one of the
// next few lines). Returns { found, qty } where qty is null when the boat row
// has a P/D marker but no handwritten number.
function findBoatQty(lines, sectionOfLine, boat) {
  let nameIdx = -1;
  let alias = null;
  for (let i = 0; i < lines.length; i++) {
    if (sectionOfLine[i] !== 'coral') continue;
    const nl = normalize(lines[i]);
    const a = boat.aliases.find(x => nl.includes(x));
    if (a) { nameIdx = i; alias = a; break; }
  }
  if (nameIdx === -1) return { found: false, qty: null };

  const end = Math.min(nameIdx + 3, lines.length - 1);
  for (let j = nameIdx; j <= end; j++) {
    if (sectionOfLine[j] !== 'coral') break;           // don't cross sections
    const nl = normalize(lines[j]);
    if (j > nameIdx && lineMentionsOtherBoat(nl, boat)) break; // reached next boat
    if (j > nameIdx && (parseChitDate(lines[j]) || /signature|date/.test(nl))) break;
    const rest = nl.split(alias).join(' '); // drop this boat's name if inline
    const info = markerInfo(rest);
    if (info.isMarker) return { found: true, qty: info.qty };
  }
  return { found: true, qty: null };
}

// Main entry point. Returns { entries: [...], dates: { coral } }.
function parseChit(rawText, fallbackDate) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n');

  // Mark each line as belonging to the coral section or the (ignored) other
  // section, so a stray Maafushivaru date/boat can't bleed into the Coral log.
  const sectionOfLine = [];
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
  coralDate = reconcileYear(coralDate, fallbackDate);
  if (!coralDate) coralDate = fallbackDate || null;

  const entries = [];
  for (const boat of BOATS) {
    const { found, qty } = findBoatQty(lines, sectionOfLine, boat);
    if (!found || qty === null) continue; // no fuel written for this boat
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

module.exports = { BOATS, parseChit, parseChitDate, findDates, findBoatQty, normalize };
