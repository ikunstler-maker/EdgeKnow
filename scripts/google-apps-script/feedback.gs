/**
 * EdgeKnow feedback → this Google Sheet.
 *
 * 1. Open the sheet → Extensions → Apps Script, replace the code with this file.
 * 2. Project Settings → Script properties → add FEEDBACK_SECRET (the same long
 *    random value you put into Vercel as FEEDBACK_SECRET).
 * 3. Deploy → New deployment → Web app: "Execute as: Me", "Who has access: Anyone".
 *    Copy the Web app URL into Vercel as FEEDBACK_SCRIPT_URL.
 *
 * Only requests carrying the secret are written; nothing is ever read back.
 */
const HEADERS = ["Дата", "Хто", "Тип", "Опис", "Сторінка", "Пристрій"];
const TYPES = {
  bug: "🐞 Баг",
  change: "✏️ Змінити",
  add: "➕ Додати",
  remove: "➖ Прибрати",
  unclear: "❓ Незрозуміло",
  other: "💡 Інше",
};

function doPost(e) {
  const out = (value) => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: "invalid" });
  }
  const secret = PropertiesService.getScriptProperties().getProperty("FEEDBACK_SECRET");
  if (!secret || data.secret !== secret) return out({ ok: false, error: "forbidden" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  // A leading ' keeps the sheet from treating text as a formula.
  const safe = (value) => {
    const text = String(value || "").slice(0, 5000);
    return /^[=+\-@]/.test(text) ? "'" + text : text;
  };
  sheet.appendRow([
    new Date(data.date || Date.now()),
    safe(data.email),
    TYPES[data.type] || safe(data.type),
    safe(data.text),
    safe(data.page),
    safe(data.device),
  ]);
  return out({ ok: true });
}
