const exifr = require('exifr');

function pad(n) {
  return String(n).padStart(2, '0');
}

// Parse a raw EXIF datetime string like "2026:07:16 14:23:05" (or an ISO-ish
// variant) straight into date + time strings. Parsing the raw components
// ourselves avoids any timezone conversion (toISOString would shift the day
// for users east/west of UTC), so we log exactly the wall-clock date/time the
// camera recorded.
function fromRawString(s) {
  const m = String(s).trim().match(/(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, se] = m;
  return { date: `${Y}-${Mo}-${D}`, time: `${h}:${mi}:${se}` };
}

function fromDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

// Returns { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } for when the photo was
// actually taken, or null if the image carries no capture-date metadata
// (e.g. Telegram strips EXIF from compressed photos, and screenshots have none).
async function getCaptureDateTime(buffer) {
  // 1) Preferred: raw EXIF strings, timezone-proof.
  try {
    const raw = await exifr.parse(buffer, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      reviveValues: false,
    });
    if (raw) {
      const s = raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate;
      const parsed = s && fromRawString(s);
      if (parsed) return parsed;
    }
  } catch (e) {
    // fall through to the revived-Date attempt
  }

  // 2) Fallback: let exifr revive the values into Date objects.
  try {
    const data = await exifr.parse(buffer, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
    const d = data && (data.DateTimeOriginal || data.CreateDate || data.ModifyDate);
    const parsed = fromDate(d);
    if (parsed) return parsed;
  } catch (e) {
    // No EXIF present - common for screenshots / compressed Telegram photos.
  }

  return null;
}

// Kept for backwards compatibility.
async function getCaptureDate(buffer) {
  const r = await getCaptureDateTime(buffer);
  return r ? new Date(`${r.date}T${r.time}`) : null;
}

module.exports = { getCaptureDateTime, getCaptureDate };
