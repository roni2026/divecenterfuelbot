// OCR via OCR.space (https://ocr.space/ocrapi). Uses Engine 3, which handles the
// mixed handwritten/printed fuel chits best for this log.

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';
const OCR_ENGINE = 3;

async function callOcrSpace(buffer, engine) {
  const form = new FormData();
  form.append('apikey', process.env.OCR_SPACE_API_KEY);
  form.append('OCREngine', String(engine));
  form.append('scale', 'true');
  form.append('isTable', 'true');
  form.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');

  const res = await fetch(OCR_SPACE_URL, { method: 'POST', body: form });
  const data = await res.json();

  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(', ') : data.ErrorMessage;
    throw new Error(msg || 'OCR.space processing error');
  }

  return (data.ParsedResults || []).map(r => r.ParsedText).join('\n');
}

async function ocrImage(buffer) {
  try {
    return await callOcrSpace(buffer, OCR_ENGINE);
  } catch (e) {
    console.error(`OCR engine ${OCR_ENGINE} failed:`, e.message);
    return '';
  }
}

module.exports = { ocrImage };
