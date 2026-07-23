// OCR via OCR.space (https://ocr.space/ocrapi). Uses Engine 2 by default since
// it tends to be more reliable for structured/dotted digital-display text; if
// it fails to find any usable reading, automatically retries once with
// Engine 3 before giving up.

const { extractFields } = require('./parser');

const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

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

// "Usable" = we found at least one of the key value fields (PV for diesel, V
// for petrol) in the text - if neither is present the reading is unreliable
// and worth a retry on the other engine.
function hasReadableValue(text) {
  const fields = extractFields(text);
  return fields.PV !== undefined || fields.V !== undefined;
}

async function ocrImage(buffer) {
  let text = '';
  try {
    text = await callOcrSpace(buffer, 2);
  } catch (e) {
    console.error('OCR engine 2 failed:', e.message);
  }

  if (!hasReadableValue(text)) {
    try {
      const retryText = await callOcrSpace(buffer, 3);
      if (retryText && (hasReadableValue(retryText) || !text)) {
        return retryText;
      }
    } catch (e) {
      console.error('OCR engine 3 retry failed:', e.message);
    }
  }

  return text;
}

module.exports = { ocrImage };
