function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Sessions') || ss.insertSheet('Sessions');
  
  sheet.appendRow([
    new Date(),
    data.clientId || '',
    data.url || '',
    data.duration || '',
    data.score || '',
    JSON.stringify(data.problems || [])
  ]);
  
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}
