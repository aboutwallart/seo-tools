// Promo title image generator — draws the two-part heading (block caps + handwritten script)
// as a TRANSPARENT PNG, so promos stop needing Illustrator.
//
//   GET /api/promo-image?type=title&top=YOUR%20DREAM%20HOME&script=starts%20here!
//
// Fonts: caps = Source Sans 3 (free, ~Myriad Pro); script = Brittany Signature (Mae's brand font).
// Params: top (caps line), script (cursive line), color (hex, default #141414), size (caps px, default 60).

const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

let FONTS_OK = false;
try {
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  GlobalFonts.registerFromPath(path.join(dir, 'SourceSans3.ttf'), 'SourceSans3');
  GlobalFonts.registerFromPath(path.join(dir, 'BrittanySignature.ttf'), 'Brittany');
  FONTS_OK = true;
} catch (e) {
  console.error('promo-image: font register failed', e && e.message);
}

const CAPS_FONT = FONTS_OK ? 'SourceSans3' : 'sans-serif';
const SCRIPT_FONT = FONTS_OK ? 'Brittany' : 'cursive';

// Render the title. Exposed for local testing.
async function renderTitle({ top = '', script = '', color = '#141414', size = 60, dy = 0, dx = 0 }) {
  top = String(top).toUpperCase();
  script = String(script);

  const capsSize = Math.max(20, Math.min(160, parseInt(size, 10) || 60));
  const scriptSize = Math.round(capsSize * 1.8);    // script reads bigger than caps
  const padX = Math.round(capsSize * 0.6);
  const padTop = Math.round(capsSize * 0.35);
  const padBot = Math.round(capsSize * 0.55);
  const letter = Math.max(1, Math.round(capsSize * 0.03)); // caps letter-spacing
  const offY = Math.max(-200, Math.min(300, parseInt(dy, 10) || 0)); // nudge script down(+)/up(-)
  const offX = Math.max(-300, Math.min(300, parseInt(dx, 10) || 0)); // nudge script right(+)/left(-)

  // measure on a scratch context
  let mc = createCanvas(10, 10).getContext('2d');
  mc.font = `600 ${capsSize}px ${CAPS_FONT}`;
  try { mc.letterSpacing = letter + 'px'; } catch (e) {}
  const topW = top ? mc.measureText(top).width : 0;
  try { mc.letterSpacing = '0px'; } catch (e) {}
  mc.font = `${scriptSize}px ${SCRIPT_FONT}`;
  const scriptW = script ? mc.measureText(script).width : 0;

  // script overhangs (signature swashes) -> GENEROUS side padding so long tails never clip
  const overhang = Math.round(scriptSize * 0.32);
  const W = Math.ceil(Math.max(topW, scriptW) + padX * 2 + overhang * 2 + Math.abs(offX) * 2);

  // vertical layout: caps on top, script below (nudge with offY/offX so words don't overlap badly)
  const capsBaseline = padTop + capsSize;                 // baseline of caps
  const scriptBaseline = Math.round(capsBaseline + scriptSize * 0.78) + offY;
  // bottom allowance covers the script's long descenders/swashes (y, g, j …) so they are NEVER cut
  const H = Math.ceil(Math.max(scriptBaseline + scriptSize * 0.62, capsBaseline + capsSize * 0.28) + padBot);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.fillStyle = color;

  const cx = Math.round(W / 2);

  if (top) {
    ctx.font = `600 ${capsSize}px ${CAPS_FONT}`;
    try { ctx.letterSpacing = letter + 'px'; } catch (e) {}
    ctx.fillText(top, cx, capsBaseline);
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  }
  if (script) {
    ctx.font = `${scriptSize}px ${SCRIPT_FONT}`;
    ctx.fillText(script, cx + offX, scriptBaseline);
  }

  return await canvas.encode('png');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const q = req.query || {};
    const type = q.type || 'title';
    if (type !== 'title') { res.status(400).json({ error: "Only type=title is supported" }); return; }
    if (!q.top && !q.script) { res.status(400).json({ error: 'Provide ?top= and/or ?script=' }); return; }

    const png = await renderTitle({ top: q.top || '', script: q.script || '', color: q.color || '#141414', size: q.size, dy: q.dy, dx: q.dx });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // titles are stable; safe to cache a day
    res.status(200).send(png);
  } catch (e) {
    console.error('promo-image error', e);
    res.status(500).json({ error: 'promo-image failed', detail: e && e.message });
  }
};

module.exports.renderTitle = renderTitle;
