# Tester form endpoint (Google Apps Script)

The "Become a tester" form on dustback.app posts to a Google Apps Script web
app that appends a row to a Google Sheet you own. No third party, no paid
plan, no database.

## One-time setup (owner, ~5 minutes)

1. Create a Google Sheet (e.g. "DustBack testers"). Row 1 headers:
   `timestamp | email | handle | user agent`.
2. Extensions → Apps Script. Replace the editor contents with the code
   below. Save.
3. Deploy → New deployment → type **Web app** → Execute as **Me**, Who has
   access **Anyone** → Deploy. Authorize when prompted.
4. Copy the Web app URL (`https://script.google.com/macros/s/…/exec`) and
   put it in `site/index.html` as the form's `action` attribute, replacing
   the `REPLACE_WITH_APPS_SCRIPT_DEPLOYMENT_ID` placeholder.
5. Test from the site: a row should appear within a second or two.

Any later code change needs Deploy → Manage deployments → edit → new
version, otherwise the URL keeps serving the old code.

## Code.gs

```js
// Appends one tester sign-up per POST. Honeypot ("website") filled = bot:
// answer ok, store nothing.
function doPost(e) {
  var p = (e && e.parameter) || {};
  var email = String(p.email || '').trim().slice(0, 200);
  var handle = String(p.handle || '').trim().slice(0, 100);
  var website = String(p.website || '').trim();
  var ua = String(p.ua || (e && e.postData && e.postData.type) || '').slice(0, 200);

  if (website !== '' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  sheet.appendRow([new Date(), email, handle, ua]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('ok');
}
```

## Notes

- The site sends the form as `multipart/form-data` with `mode: 'no-cors'`,
  so the browser never reads the response; the thank-you state shows once the
  request leaves the device. A network failure shows a retry message.
- Deleting a tester on request = deleting the row in the Sheet.
