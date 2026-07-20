// ABOUT WALL ART — Educational Video · BLOG-LINK REMINDER (Google Apps Script).
// Runs weekly (Mondays 17:00) and emails you the videos that have gone live but still need their
// YouTube embed added to the blog + a reindex request. It reads the list the tool keeps on GitHub.
//
// ONE-TIME SETUP:
//   1. script.google.com -> New project -> paste this whole file.
//   2. Run  setupTrigger  once (authorise it when asked). That creates the weekly Monday 17:00 trigger.
//   3. (Optional) Run  sendReminders  once to test — it emails anything already live and not yet sent.
// Nothing else. It emails MAIL_TO below.

var MAIL_TO   = 'mae@aboutwallart.com';
var QUEUE_URL = 'https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/edu-publish-queue.json';
var GSC_HOME  = 'https://search.google.com/search-console?resource_id=sc-domain%3Aaboutwallart.com';
var TOOL_URL  = 'https://tools.aboutwallart.com/social-media-content-calendar.html';

function setupTrigger() {
  // remove any old triggers for this function, then create the weekly Monday 17:00 one
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(17).create();
}

function ytId(u) { var m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_\-]{6,})/.exec(u || ''); return m ? m[1] : ''; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function embedCode(url, title) {
  var id = ytId(url);
  var iframe = id
    ? '<iframe src="https://www.youtube.com/embed/' + id + '?cc_load_policy=0" title="' + title + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>'
    : '<iframe src="https://www.youtube.com/embed/PASTE_YOUR_VIDEO_ID?cc_load_policy=0" title="' + title + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe>';
  var watch = '<p><strong>WATCH:</strong> <a href="' + (url || 'PASTE_YOUR_YOUTUBE_LINK') + '" target="_blank" rel="noopener">' + title + '</a></p>';
  return watch + '\n<div style="position:relative;width:100%;padding-bottom:56.25%;height:0;overflow:hidden;margin:12px 0;">\n  ' + iframe + '\n</div>';
}

function sendReminders() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().getTime();
  var THIRTY_DAYS = 30 * 24 * 3600 * 1000;

  var data;
  try { data = JSON.parse(UrlFetchApp.fetch(QUEUE_URL + '?_=' + now, { muteHttpExceptions: true }).getContentText()); }
  catch (e) { return; }
  var vids = (data && data.videos) || [];

  var due = [];
  vids.forEach(function (v) {
    var live = new Date(v.liveAt || '').getTime();
    if (!live) return;
    if (now < live) return;                 // not live yet
    if (now - live > THIRTY_DAYS) return;   // too old — skip (avoids resurrecting on first run)
    var key = 'sent:' + (v.handle || '') + '|' + (v.liveAt || '');
    if (props.getProperty(key)) return;     // already emailed this one
    v._key = key; due.push(v);
  });
  if (!due.length) return;

  var blocks = due.map(function (v) {
    var title = esc(v.title || v.handle || 'Educational video');
    var code = embedCode(v.youtubeUrl || '', title);
    var inspect = 'https://search.google.com/search-console/inspect?resource_id=sc-domain%3Aaboutwallart.com&id=' + encodeURIComponent(v.blogUrl || '');
    var linkNote = v.youtubeUrl ? '' : '<p style="color:#b91c1c;">Paste your YouTube link where it says PASTE_YOUR_YOUTUBE_LINK / PASTE_YOUR_VIDEO_ID.</p>';
    return ''
      + '<h2 style="margin:22px 0 6px;">' + title + '</h2>'
      + '<p><strong>1 · Add this to the END of the blog:</strong> <a href="' + esc(v.blogUrl || '') + '" target="_blank">open the blog</a></p>'
      + linkNote
      + '<pre style="white-space:pre-wrap;word-wrap:break-word;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;padding:12px;font-size:12px;">' + esc(code) + '</pre>'
      + '<p><strong>2 · Reindex it:</strong> <a href="' + inspect + '" target="_blank">open in Search Console</a> '
      + '&nbsp;(or open <a href="' + GSC_HOME + '" target="_blank">Search Console</a> and paste: ' + esc(v.blogUrl || '') + ')</p>'
      + '<hr style="border:none;border-top:1px solid #eee;margin:18px 0;">';
  }).join('');

  var html = ''
    + '<div style="font-family:Arial,sans-serif;max-width:760px;">'
    + '<p>These educational videos are now live on YouTube — add each one to its blog and request a reindex:</p>'
    + blocks
    + '<p style="color:#666;font-size:12px;">Do it in the tool if you prefer: <a href="' + TOOL_URL + '" target="_blank">open the Social Content Tool</a> → Educational Video → Published / scheduled.</p>'
    + '</div>';

  GmailApp.sendEmail(MAIL_TO, '📌 Link ' + due.length + ' video' + (due.length > 1 ? 's' : '') + ' to the blog + reindex', 'Open in an HTML-capable mail client.', { htmlBody: html });

  due.forEach(function (v) { props.setProperty(v._key, new Date().toISOString()); });
}
