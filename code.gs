const KEY_TO_MODE_AND_DURATION = {
  '72740d67': { mode: 'Normal', duration: 30 },
  '0172800b': { mode: 'Normal', duration: 60 },
  'a7220a92': { mode: 'Normal', duration: 120 },
  '215bc31a': { mode: 'Normal', duration: 300 },
  '97382c35': { mode: 'Normal', duration: 600 },
  'c9750470': { mode: 'Hard', duration: 30 },
  'ac954fea': { mode: 'Hard', duration: 60 },
  '5ae295b0': { mode: 'Hard', duration: 120 },
  '04e52452': { mode: 'Hard', duration: 300 },
  '7ca8f568': { mode: 'Hard', duration: 600 }
};

function extractKeyFromUrl(url) {
  if (!url) return '';
  const match = url.match(/[?&]key=([a-f0-9]+)/i);
  return match ? match[1] : '';
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Sessions') || ss.insertSheet('Sessions');

  const url = data.url || '';
  const key = extractKeyFromUrl(url);
  const mapping = KEY_TO_MODE_AND_DURATION[key] || null;
  const detectedMode = mapping ? mapping.mode : '';
  const mappedDuration = mapping ? mapping.duration : '';

  sheet.appendRow([
    new Date(),
    data.clientId || '',
    url,
    data.duration || '',
    data.score || '',
    JSON.stringify(data.problems || []),
    detectedMode,
    mappedDuration
  ]);

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}
