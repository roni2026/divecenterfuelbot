const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

// ISO yyyy-mm-dd -> dd.mm.yy (the format used in the reference workbook).
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}

// Work out a "JULY 2026" style label from the data (or the requested range).
// Uses the most common year-month among the rows so a single stray/typo date
// can't mislabel the sheet.
function periodLabel(rows, meta) {
  const yms = rows.map(r => (r.log_date ? String(r.log_date).slice(0, 7) : null)).filter(Boolean);
  let ref = null;
  if (yms.length) {
    const counts = {};
    for (const ym of yms) counts[ym] = (counts[ym] || 0) + 1;
    ref = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  } else {
    ref = (meta.start || meta.end || '').slice(0, 7) || null;
  }
  if (!ref) return { month: '', year: '', sheet: 'FUEL LOG' };
  const m = ref.match(/(\d{4})-(\d{2})/);
  if (!m) return { month: '', year: '', sheet: 'FUEL LOG' };
  const month = MONTHS[parseInt(m[2], 10) - 1];
  const year = m[1];
  const months = new Set(yms);
  const sheet = months.size > 1 ? `${month} ${year.slice(2)}+` : `${month} ${year.slice(2)}`;
  return { month, year, sheet, multi: months.size > 1 };
}

const MED = { style: 'medium' };
const THIN = { style: 'thin' };
const DASH = { style: 'dashed' };

async function buildExcel(rows, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dive Centre Fuel Bot';

  const { month, year, sheet } = periodLabel(rows, meta);
  const ws = wb.addWorksheet(sheet || 'FUEL LOG');

  // Column widths matching the reference workbook.
  ws.getColumn(1).width = 12.78;  // A Date
  ws.getColumn(2).width = 30.78;  // B Boat Name
  ws.getColumn(3).width = 12.78;  // C Qty
  ws.getColumn(4).width = 10;     // D Unit
  ws.getColumn(5).width = 2;      // E spacer
  ws.getColumn(6).width = 12.78;  // F Date
  ws.getColumn(7).width = 30.78;  // G Boat Name
  ws.getColumn(8).width = 12.78;  // H Qty
  ws.getColumn(9).width = 10;     // I Unit

  // Row 1: DIVE CENTRE
  ws.mergeCells('A1:I1');
  const t = ws.getCell('A1');
  t.value = 'DIVE CENTRE';
  t.font = { bold: true, size: 14 };
  t.alignment = { horizontal: 'center' };

  // Row 2: section titles
  ws.mergeCells('A2:D2');
  ws.mergeCells('F2:I2');
  const pTitle = ws.getCell('A2');
  pTitle.value = `PETROL - ${month}- ${year}`;
  pTitle.font = { bold: true, size: 12 };
  pTitle.alignment = { horizontal: 'center' };
  pTitle.border = { top: MED, left: MED, right: MED };
  const dTitle = ws.getCell('F2');
  dTitle.value = `DIESEL - ${month}- ${year}`;
  dTitle.font = { bold: true, size: 12 };
  dTitle.alignment = { horizontal: 'center' };
  dTitle.border = { top: MED, left: MED, right: MED };

  // Row 3: headers
  const headerCells = [
    ['A3', 'Date'], ['B3', 'Boat Name'], ['C3', 'Qty'], ['D3', 'Unit'],
    ['F3', 'Date'], ['G3', 'Boat Name'], ['H3', 'Qty'], ['I3', 'Unit'],
  ];
  headerCells.forEach(([addr, val]) => {
    const c = ws.getCell(addr);
    c.value = val;
    c.font = { bold: true, size: 12 };
    c.alignment = { horizontal: 'center' };
    c.border = { top: DASH, bottom: DASH };
  });
  ws.getCell('A3').border = { top: DASH, bottom: DASH, left: MED };
  ws.getCell('D3').border = { top: DASH, bottom: DASH, right: MED };
  ws.getCell('F3').border = { top: DASH, bottom: DASH, left: MED };
  ws.getCell('I3').border = { top: DASH, bottom: DASH, right: MED };

  const sortByDate = a => a.slice().sort((x, y) => String(x.log_date).localeCompare(String(y.log_date)));
  const petrol = sortByDate(rows.filter(r => r.fuel_type === 'petrol'));
  const diesel = sortByDate(rows.filter(r => r.fuel_type === 'diesel'));

  const firstDataRow = 4;

  function writeSide(list, cols) {
    const [cDate, cBoat, cQty, cUnit] = cols;
    let r = firstDataRow;
    list.forEach(item => {
      ws.getCell(`${cDate}${r}`).value = fmtDate(item.log_date);
      ws.getCell(`${cBoat}${r}`).value = item.boat_name;
      const q = ws.getCell(`${cQty}${r}`);
      q.value = Number(item.quantity);
      q.alignment = { horizontal: 'center' };
      ws.getCell(`${cUnit}${r}`).value = item.unit || 'Ltrs';
      [cDate, cBoat, cQty, cUnit].forEach(col => {
        const cell = ws.getCell(`${col}${r}`);
        cell.font = { size: 12 };
        cell.border = { top: DASH, bottom: DASH, left: col === cDate ? MED : THIN, right: col === cUnit ? MED : THIN };
      });
      r++;
    });
    // TOTAL row
    const totalRow = r;
    ws.getCell(`${cBoat}${totalRow}`).value = 'TOTAL';
    ws.getCell(`${cBoat}${totalRow}`).font = { bold: true, size: 12 };
    const totCell = ws.getCell(`${cQty}${totalRow}`);
    if (list.length) {
      totCell.value = { formula: `SUM(${cQty}${firstDataRow}:${cQty}${totalRow - 1})` };
    } else {
      totCell.value = 0;
    }
    totCell.font = { bold: true, size: 12 };
    totCell.alignment = { horizontal: 'center' };
    [cDate, cBoat, cQty, cUnit].forEach(col => {
      const cell = ws.getCell(`${col}${totalRow}`);
      cell.border = { top: MED, bottom: MED, left: col === cDate ? MED : THIN, right: col === cUnit ? MED : THIN };
    });
    return totalRow;
  }

  writeSide(petrol, ['A', 'B', 'C', 'D']);
  writeSide(diesel, ['F', 'G', 'H', 'I']);

  // ---- Second sheet: per-boat totals (sum of litres for each boat) ----
  addBoatTotalsSheet(wb, rows);

  return wb.xlsx.writeBuffer();
}

function addBoatTotalsSheet(wb, rows) {
  const ws = wb.addWorksheet('Boat Totals');
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 10;

  ws.mergeCells('A1:D1');
  const t = ws.getCell('A1');
  t.value = 'TOTAL LITRES PER BOAT';
  t.font = { bold: true, size: 14 };
  t.alignment = { horizontal: 'center' };

  const header = ['Fuel', 'Boat Name', 'Total Qty', 'Unit'];
  header.forEach((h, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  });

  const totals = new Map();
  for (const r of rows) {
    const key = `${r.fuel_type}|${r.boat_name}`;
    totals.set(key, (totals.get(key) || 0) + Number(r.quantity || 0));
  }
  const list = [...totals.entries()]
    .map(([k, v]) => { const [fuel, boat] = k.split('|'); return { fuel, boat, v: +v.toFixed(2) }; })
    .sort((a, b) => a.fuel.localeCompare(b.fuel) || b.v - a.v);

  let row = 3;
  let petrolSum = 0, dieselSum = 0;
  list.forEach(item => {
    ws.getCell(row, 1).value = item.fuel === 'petrol' ? 'Petrol' : 'Diesel';
    ws.getCell(row, 2).value = item.boat;
    ws.getCell(row, 3).value = item.v;
    ws.getCell(row, 4).value = 'Ltrs';
    for (let c = 1; c <= 4; c++) ws.getCell(row, c).border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    if (item.fuel === 'petrol') petrolSum += item.v; else dieselSum += item.v;
    row++;
  });

  row++;
  ws.getCell(row, 2).value = 'PETROL TOTAL';
  ws.getCell(row, 2).font = { bold: true };
  ws.getCell(row, 3).value = +petrolSum.toFixed(2);
  ws.getCell(row, 3).font = { bold: true };
  ws.getCell(row, 4).value = 'Ltrs';
  row++;
  ws.getCell(row, 2).value = 'DIESEL TOTAL';
  ws.getCell(row, 2).font = { bold: true };
  ws.getCell(row, 3).value = +dieselSum.toFixed(2);
  ws.getCell(row, 3).font = { bold: true };
  ws.getCell(row, 4).value = 'Ltrs';
}

function buildPdf(rows, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { month, year } = periodLabel(rows, meta);
    doc.fontSize(16).font('Helvetica-Bold').text('DIVE CENTRE', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(`Fuel Log ${month} ${year}`.trim(), { align: 'center' });
    doc.moveDown();

    const sortByDate = a => a.slice().sort((x, y) => String(x.log_date).localeCompare(String(y.log_date)));

    function table(title, list) {
      doc.moveDown(0.5).fontSize(12).font('Helvetica-Bold').text(title);
      const startX = doc.page.margins.left;
      const widths = [80, 220, 70, 60];
      const headers = ['Date', 'Boat Name', 'Qty', 'Unit'];
      let y = doc.y + 4;
      const rowH = 18;
      const draw = (vals, opts = {}) => {
        let x = startX;
        doc.font(opts.header ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        vals.forEach((v, i) => { doc.text(String(v ?? ''), x + 2, y + 4, { width: widths[i] - 4 }); x += widths[i]; });
        doc.moveTo(startX, y).lineTo(startX + widths.reduce((a, b) => a + b, 0), y).stroke();
        y += rowH;
        if (y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); y = doc.page.margins.top; }
      };
      draw(headers, { header: true });
      let total = 0;
      sortByDate(list).forEach(r => { total += Number(r.quantity || 0); draw([fmtDate(r.log_date), r.boat_name, r.quantity, r.unit || 'Ltrs']); });
      draw(['', 'TOTAL', +total.toFixed(2), 'Ltrs'], { header: true });
      doc.moveTo(startX, y).lineTo(startX + widths.reduce((a, b) => a + b, 0), y).stroke();
      doc.y = y + 6;
    }

    table(`PETROL - ${month} ${year}`.trim(), rows.filter(r => r.fuel_type === 'petrol'));
    table(`DIESEL - ${month} ${year}`.trim(), rows.filter(r => r.fuel_type === 'diesel'));

    doc.end();
  });
}

module.exports = { buildExcel, buildPdf, fmtDate, periodLabel };
