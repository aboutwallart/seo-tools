// ABOUT WALL ART — Price Guard email (Google Apps Script).
// Emails Mae when the daily "price guard" (Vercel) raised any Shopify Collective product
// back to cost + 25% (because a supplier put the cost up). Reads the run summary the Vercel
// job writes to GitHub (data/price-guard-last.json). Sends at most ONE email per run.
//
// ONE-TIME SETUP (same as your weekly video reminder):
//   1. script.google.com -> New project -> paste this whole file.
//   2. Run  setupTrigger  once (authorise it when asked). That creates a daily 9:00 trigger.
//   3. (Optional) Run  sendGuardEmail  once to test.
// Nothing else. It emails MAIL_TO below, only when something was actually fixed.

var MAIL_TO     = 'mae@aboutwallart.com';
var SUMMARY_URL = 'https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/price-guard-last.json';
var TOOL_URL    = 'https://tools.aboutwallart.com/shopify-bulk-editor.html';

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendGuardEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendGuardEmail').timeBased().everyDays(1).atHour(9).create();
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function money(x) { return (x == null || x === '') ? '—' : '£' + Number(x).toFixed(2); }

function sendGuardEmail() {
  var props = PropertiesService.getScriptProperties();

  var data;
  try { data = JSON.parse(UrlFetchApp.fetch(SUMMARY_URL + '?_=' + new Date().getTime(), { muteHttpExceptions: true }).getContentText()); }
  catch (e) { return; }

  if (!data || !data.fixedCount || data.fixedCount < 1) return;   // nothing was fixed this run
  if (props.getProperty('sent:' + data.ranAt)) return;           // already emailed this run

  var items = data.items || [];
  var rows = items.map(function (it) {
    var name = esc(it.title) + (it.variant ? ' — ' + esc(it.variant) : '');
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' + name + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#999;">' + money(it.from) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:#2e7d32;">' + money(it.to) + '</td>' +
      '</tr>';
  }).join('');

  var pct = data.minMarkup || 25;
  var html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#333;">' +
    '<h2 style="color:#c62828;margin:0 0 10px;">⚠️ Precios corregidos automáticamente</h2>' +
    '<p>El vigilante subió <b>' + data.fixedCount + '</b> ' + (data.fixedCount === 1 ? 'producto' : 'productos') +
      ' que habían quedado por debajo de <b>costo + ' + pct + '%</b> (el proveedor subió el costo).</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:8px;"><thead><tr>' +
      '<th style="text-align:left;padding:6px 10px;color:#999;">Producto</th>' +
      '<th style="text-align:right;padding:6px 10px;color:#999;">Antes</th>' +
      '<th style="text-align:right;padding:6px 10px;color:#999;">Ahora</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="margin-top:16px;">Ya está aplicado en Shopify. Para revisar o revertir, entrá a la herramienta:<br>' +
      '<a href="' + TOOL_URL + '">' + TOOL_URL + '</a></p>' +
    '</div>';

  GmailApp.sendEmail(
    MAIL_TO,
    '⚠️ ' + data.fixedCount + ' precio(s) corregido(s) — costo + ' + pct + '%',
    'Abrí este email en un cliente que muestre HTML.',
    { htmlBody: html }
  );

  props.setProperty('sent:' + data.ranAt, '1');
}
