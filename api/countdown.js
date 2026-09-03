// Countdown timer — animated GIF generator (About Wall Art's own, replaces MailTimers).
// Emails can't run JS, so a countdown is an animated GIF drawn by this endpoint each time it's fetched.
//
//   GET /api/countdown?to=2026-05-03T23:59&tz=Europe/London&lang=es
//
// Params:
//   to   (required)  end date/time. ISO. If it carries an offset (…+01:00 / …Z) that wins;
//                    otherwise it's read as WALL TIME in `tz`.
//   tz   (optional)  IANA timezone for a no-offset `to`. Default 'Europe/London'.
//   lang (optional)  en | es | it | fr  (en = UK + US, same labels). Default 'en'.
//
// Look = the campaign timers: 4 big black numbers (DAYS/HOURS/MINUTES/SECONDS) with thin
// dividers and labels under, on white. Lato (brand font). No app logo.
// 60 frames, 1s each, looping — the seconds tick on the first open (exactly like MailTimers).

const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');

// --- register the brand font once (Vercel has no system fonts) ---
let FONTS_OK = false;
try {
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  GlobalFonts.registerFromPath(path.join(dir, 'Lato-Bold.ttf'), 'LatoBold');
  GlobalFonts.registerFromPath(path.join(dir, 'Lato-Regular.ttf'), 'LatoReg');
  FONTS_OK = true;
} catch (e) {
  console.error('countdown: font register failed', e && e.message);
}

const LABELS = {
  en: ['DAYS', 'HOURS', 'MINUTES', 'SECONDS'],
  es: ['DÍAS', 'HORAS', 'MINUTOS', 'SEGUNDOS'],
  it: ['GIORNI', 'ORE', 'MINUTI', 'SECONDI'],
  fr: ['JOURS', 'HEURES', 'MINUTES', 'SECONDES'],
};

// Map a market/lang code to a label set. en-GB/en-US -> en.
function labelSet(lang) {
  if (!lang) return LABELS.en;
  const l = String(lang).toLowerCase();
  if (l.startsWith('es')) return LABELS.es;
  if (l.startsWith('it')) return LABELS.it;
  if (l.startsWith('fr')) return LABELS.fr;
  return LABELS.en;
}

// Offset (ms) between a given IANA tz and UTC at instant `date`. DST-aware via Intl.
function tzOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour % 24), +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Resolve `to` to an absolute epoch ms. If it has an offset/Z use it; else read as wall time in tz.
function resolveTargetMs(to, tz) {
  if (!to) return NaN;
  const hasOffset = /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(to.trim());
  if (hasOffset) return Date.parse(to);
  const m = to.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return Date.parse(to); // last resort
  const [, y, mo, d, h, mi, s] = m;
  const naiveUTC = Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0));
  // subtract the tz offset at that instant so the wall time lands in the right zone
  const off = tzOffsetMs(new Date(naiveUTC), tz || 'Europe/London');
  return naiveUTC - off;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// remaining seconds -> {d,h,m,s} clamped at 0
function breakdown(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { d, h, m, s };
}

// ---- drawing ----
const W = 680, H = 200;
const NUM_FONT = FONTS_OK ? 'LatoBold' : 'sans-serif';
const LAB_FONT = FONTS_OK ? 'LatoReg' : 'sans-serif';
const COL_BG = '#ffffff', COL_NUM = '#141414', COL_LAB = '#555555', COL_DIV = '#dcdcdc';

function drawFrame(ctx, parts, labels) {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);

  const cellW = W / 4;
  const numY = H * 0.46;
  const labY = H * 0.76;

  // dividers between the 4 cells
  ctx.strokeStyle = COL_DIV;
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const x = Math.round(i * cellW) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H * 0.30);
    ctx.lineTo(x, H * 0.66);
    ctx.stroke();
  }

  const nums = [pad2(parts.d), pad2(parts.h), pad2(parts.m), pad2(parts.s)];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < 4; i++) {
    const cx = (i + 0.5) * cellW;
    // number
    ctx.fillStyle = COL_NUM;
    ctx.font = `700 66px ${NUM_FONT}`;
    ctx.fillText(nums[i], cx, numY + 22);
    // label (letter-spaced if supported)
    ctx.fillStyle = COL_LAB;
    ctx.font = `400 15px ${LAB_FONT}`;
    try { ctx.letterSpacing = '2px'; } catch (e) {}
    ctx.fillText(labels[i], cx, labY);
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  }
}

// Build the animated GIF buffer. Exposed for local testing.
function renderGif({ to, tz = 'Europe/London', lang = 'en', frames = 60 }) {
  const labels = labelSet(lang);
  const targetMs = resolveTargetMs(to, tz);
  const startRemainingSec = isNaN(targetMs) ? 0 : (targetMs - Date.now()) / 1000;

  const encoder = new GIFEncoder(W, H, 'neuquant', false);
  encoder.setRepeat(0);      // loop forever
  encoder.setDelay(1000);    // 1s per frame -> seconds tick
  encoder.setQuality(10);
  encoder.start();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  for (let f = 0; f < frames; f++) {
    const parts = breakdown(startRemainingSec - f);
    drawFrame(ctx, parts, labels);
    encoder.addFrame(ctx);
  }
  encoder.finish();
  return encoder.out.getData();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const q = req.query || {};
    const to = q.to;
    if (!to) { res.status(400).json({ error: 'Missing ?to=<end date/time>' }); return; }
    const tz = q.tz || 'Europe/London';
    const lang = q.lang || 'en';

    const gif = renderGif({ to, tz, lang });

    res.setHeader('Content-Type', 'image/gif');
    // never let a proxy hold a stale timer longer than needed
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Expires', '0');
    res.status(200).send(gif);
  } catch (e) {
    console.error('countdown error', e);
    res.status(500).json({ error: 'countdown failed', detail: e && e.message });
  }
};

module.exports.renderGif = renderGif;
module.exports.resolveTargetMs = resolveTargetMs;
