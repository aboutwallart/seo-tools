// api/etsy.js — AWA ETSY backend (OAuth + New product + Replace images + Compliance photo)  ·  v0.56
// v0.56 (2026-10-26): Compliance photo tab — bulk-add common image #2 (a real, non-AI/non-mockup photo) to every active +
//   draft listing, to meet Etsy's rule. ri-comply-plan builds the worklist (active+draft minus Replace-images done);
//   ri-comply-batch processes N at a time (if a listing has 20 images, deletes the last one, backed up, then appends #2);
//   ri-comply-status reports progress. Batched + resumable (complied listing_ids stored, skipped on re-run).
// v0.55 (2026-10-26): Replace images — per-section progress. The done store now records each done listing's section
//   ({ids, sections}); ri-sections returns done/total per section (for the dropdown's x/total + greying finished ones);
//   ri-apply stores the section; ri-listings backfills the section for older done records; ri-done-remove clears it.
// v0.54 (2026-10-26): Replace images — Start here / Done sub-tabs. New ri-done-remove action un-marks a listing as done
//   (removes it from data/etsy-images-done.json) so "Move back to Start here" returns it to the to-do list.
// v0.53 (2026-10-26): Replace images — "Etsy + Shopify" option. ri-apply takes target ('etsy'|'both'); 'both' pushes the
//   SAME image set, in the SAME order, to the matched Shopify product (pushImagesToShopify: create new media first, then
//   delete the old — product never left imageless). uploadImageToShopify (staged upload, copied from keywords.js) handles
//   manually-uploaded images. loadShopifyMedia now returns the product id; old Shopify images backed up in the undo log.
// v0.52 (2026-10-26): Replace images — alt text. loadShopifyMedia returns each image's Shopify altText; ri-apply /
//   riApplyMedia pass a per-image alt and set alt_text on the Etsy upload (front sends Shopify alt, else the listing
//   title + a number so fallbacks aren't identical; common set keeps its own alt).
// v0.51 (2026-10-26): Replace images — FIX the "matched in the list but no match inside" bug: ri-listings used the BASE
//   SKU but ri-detail used the VARIANT SKU. Now BOTH reduce to the base (baseSkuEtsy), and loadShopifyMedia falls back
//   to the base if the exact SKU doesn't match. Same value matched in both places.
// v0.50 (2026-10-26): Replace images — FIX match (loadShopifyMedia dropped the media/video field that broke the whole
//   Shopify search on 2025-01, so nothing matched). Video removed from the feature. ri-listings now flags each listing
//   matched (vs allShopifySkus set) + done (data/etsy-images-done.json) and returns total/done; ri-apply marks done.
// v0.49 (2026-10-25): ri-listings now returns each listing's featured image + SKU (uses /listings?state=active with
//   includes=Inventory,Images — same pattern as etsy-reg-refresh). Common set points to data/etsy-common-set.json
//   (reuses the NPG fixed images in assets/npg-images/fixed/ + a new "framed-products.jpg").
// v0.48 (2026-10-25): Replace images — Tanda 2: ri-sections / ri-listings (by Etsy section) / ri-detail (current Etsy
//   images + video + Shopify match by sku_for_print_files, with "closest" fallback) / ri-shopify (media for a chosen
//   SKU) / ri-apply (backup-first to data/etsy-images-undo.json, then riApplyMedia: ordered images incl. common set at
//   the end, 20-cap, anchor trick; video keep/replace/remove). loadShopifyMedia adds the product video.
// v0.47 (2026-10-25): Replace images — Tanda 1: common-set storage in GitHub (ri-common-get/add/delete/reorder).
// v0.46 (2026-10-21): FIX "Generate listing" error "Unexpected non-whitespace character after JSON" — the AI sometimes
//   adds text (or a 2nd block) after the JSON, and the greedy /{...}/ grabbed first "{" to LAST "}", swallowing it.
//   claudeJSON now extracts the FIRST complete JSON object (brace-count, string-aware) via firstJsonObject and parses
//   only that. Affects every generate/suggest call.
// v0.45 (2026-10-21): REVERTED the v0.43/v0.44 "set the real SKU" work. Writing the template inventory to change the
//   SKU wiped the international (per-country) prices — Etsy reset them to the UK price (tested live). Behaviour is back
//   to v0.42: apply-to-template leaves the template SKU and never touches the inventory. SATURDAY: try Mae plan B (SKU
//   at the start of the title to copy-paste by hand). Do NOT retry the inventory PUT.
// v0.42 (2026-10-20): Tab 2 now also finds duplicates among INACTIVE listings (Mae published many, never got the
//   prices applied, and deactivated them — she wants to recover those). tab2-list scans active+inactive+draft and
//   accepts a duplicate target in draft OR inactive; findShopListingById (the original read) also scans inactive. Each
//   duplicate now carries its real state (draft/inactive) for the UI.
// v0.41 (2026-10-20): Tab 1 can now publish a NEW product INTO a TEMPLATE draft (to inherit its international pricing,
//   which the API can't set). Etsy has no "duplicate" endpoint, so Mae keeps template drafts (SKU contains "template")
//   that already carry the international pricing. New actions: tab1-templates (lists draft listings whose SKU contains
//   "template"); tab1-apply-template (PATCHes the generated title/description+footer/tags/materials/section, sets
//   is_personalizable + personalisation, PUTs attributes, and replaces the media — removes the old video + photos and
//   uploads the picked Shopify photos — NEVER touching variations/prices). New shared helper replaceListingMedia.
//   NOTE: the applied listing keeps the template's SKU (the SKU lives with the price, which we must not touch).
// v0.40 (2026-10-20): tab2-apply now copies the PHOTOS from the ORIGINAL Etsy listing (not from Shopify). The Shopify
//   product has 30 images but Etsy caps at 20, so pulling from Shopify dropped the 3 mandatory brand images (size guide
//   / picture frames / frame sizes) that live at the end. Mae already curated the original's 20 (with the mandatory
//   ones), and the duplicate must match the original exactly — so photos now come from the original's own images
//   (/listings/{id}/images, full-size). Everything else was already from the original; only photos were from Shopify.
//   Also returns a one-line summary (photos copied / old removed / video removed) shown on success.
// v0.39 (2026-10-20): tab2-apply photos/video — the duplicate kept the old product's VIDEO and its LAST old photo, and
//   2 new photos didn't fit. Causes: (1) we never removed videos; (2) Etsy refuses to delete a listing's LAST image, so
//   one old photo stuck; (3) that stuck photo + Etsy's 20-image cap blocked the last new uploads. Now: delete the old
//   video(s); delete every old photo EXCEPT one anchor; upload the Shopify photos; delete the anchor (deletable now that
//   new photos exist); then upload any photo that didn't fit on the first pass. Net: only the new product's photos, no
//   old video, no old photo.
// v0.38 (2026-10-20): FIX tab2-apply "All photo uploads failed" — the GET that LISTS a listing's images is NOT
//   shop-scoped in Etsy v3 (it is GET /listings/{id}/images), but tab2-apply listed them at
//   /shops/{shop}/listings/{id}/images, so it got nothing back, deleted nothing, and the duplicate's old photos stayed
//   — new uploads then failed. Now the list uses the correct /listings/{id}/images path; delete + upload stay
//   shop-scoped (they were already correct). Photo failures now carry the exact Etsy error + found/deleted counts.
// v0.37 (2026-10-20): FIX tab2-apply attribute "Array input 5:7 (ISO ratio) is malformed" — publish already strips the
//   trailing parenthetical from each attribute value ("5:7 (ISO ratio)" -> "5:7"); tab2-apply was sending the raw value.
//   Now it cleans the value the exact same way as publish. (All other fields already matched publish.)
// v0.36 (2026-10-20): REAL FIX for tab2-apply "Could not read the original listing (400)". getListing (/listings/{id})
//   does NOT return DRAFT listings -> 400. The original is a draft, so we now read it with the shop-scoped listings
//   endpoint (same one "Clean listings" uses, which DOES return drafts): findShopListingById scans active+draft and
//   returns the full listing (title/description/tags/materials/shop_section_id). Attributes still come from the
//   shop-scoped /properties endpoint. Step failures now carry the exact Etsy error text (front shows it).
// v0.35 (2026-10-20): FIX tab2-apply "Could not read the original listing (400)" — the original read used
//   getListing with ?includes=Inventory, which Etsy rejects on a draft listing. We don't touch inventory here, so the
//   read now has no includes (title/description/tags/materials/shop_section_id are all top-level fields).
// v0.34 (2026-10-20): TAB 2 "Apply to duplicate". Etsy can't set international pricing by API, so Mae duplicates a
//   listing in Etsy (the copy keeps the international prices) and this tab fills in the rest by API. Test rule: a
//   duplicate's SKU = the original SKU + "B" at the end. New actions:
//   tab2-list — scans all listings (active+draft), indexes by base SKU, returns the DRAFT duplicates (base SKU ends in
//     "B") that have a matching original (same base SKU without the "B"), each with its original candidate(s).
//   tab2-apply — reads the ORIGINAL (title/description/tags/materials/shop_section_id + its attributes), then on the
//     DUPLICATE: PATCHes those text fields, re-applies each attribute (skips Frame=513/Size=514 — those are the
//     variations tied to price), and replaces the photos with the product's Shopify images (delete all, upload all,
//     cap 20, Shopify order). NEVER touches inventory / variations / prices. Registers the result in Sent items.
// v0.33 (2026-10-19): video registry fixes — etsy-reg-refresh now PAGES THROUGH ALL listings (count-driven; the old
//   loop stopped after the first 100), stores each listing's featured image (includes=Images), and folds in the tool's
//   "Sent items" so drafts without a SKU on Etsy are covered too. Registry entry = {listing_id,title,state,image}.
// v0.32 (2026-10-19): VIDEOS TO ETSY (for the video tool's new "Send to Etsy" tab). ONE registry data/etsy-listings.json
//   maps base SKU -> [listings] (old live listings + drafts); action etsy-reg-refresh rebuilds it from Etsy (active+draft,
//   includes=Inventory), tab1-sent-add now also adds each new draft to it. etsy-reg-get / etsy-video-log-get read them.
//   etsy-video-send uploads one Drive video to one listing (same SKU can be in several listings -> the tab loops them);
//   replace rule: 0-1 videos -> add; already 2 -> remove the one this tool pushed (else any) then add. etsy-video-undo
//   removes the tool's video from a listing. data/etsy-video-log.json tracks what this tool pushed (for replace + undo).
// v0.31 (2026-10-19): description variety — listings were written in separate memory-less AI calls, so every one opened
//   with the same verb ("Hang this…") and all carried the same hang-a-set-of-3 paragraph, making them read identical.
//   Now each generate call picks ONE opening verb at random (from 19) and TWO advice angles at random (from 7) and
//   forces the AI to open with that verb and build the advice around those angles — so each listing opens and reads
//   differently, and the hanging advice appears only when that angle is picked. Voice/banned-words/rules unchanged.
// v0.30 (2026-10-19): FIX SKU loading — Shopify search was partial (took the first product that merely contained a
//   piece of the SKU), so pasted SKUs loaded the wrong product and families got mixed. Now loadProduct brings up to 25
//   candidates, selects ONLY the one whose "sku_for_print_files" metafield equals the SKU exactly, and when there is no
//   exact match returns { noMatch:true, similar:[{sku,title,image}] } (parecidos con foto) instead of a bare 404. New
//   action tab1-thumb returns the featured image + title + exact-match flag for one SKU (feeds the family list previews).
// v0.27 (2026-10-18): new action tab1-suggest-seeds — Claude proposes 12-15 Etsy search seed phrases from the product
//   images + style, to add to the seeds before the Apify search (replaces doing it by hand in Gemini).
// v0.25 (2026-10-18): family batch — tab1-generate accepts siblingTitles; when present, the prompt tells the AI the
//   titles already used by family siblings and that this title MUST be clearly different (no SEO cannibalisation).
// v0.23 (2026-10-18): FIX — clean-apply PATCH now hits /shops/{shop_id}/listings/{id} (was /listings/{id} -> Etsy
//   "Resource not found"). updateListing is shop-scoped. (Front also removes the leftover workbook promo intro.)
// v0.21 (2026-10-18): Clean-listings logic (front) now removes whole PARAGRAPHS that contain off-platform content
//   (external link / email / ★★ / social / promo phrase), order-independent, and a second scan verifies 0 remain.
//   Backend tab-clean-list / tab-clean-apply unchanged (list + PATCH description + GitHub backup).
// v0.20 (2026-10-18): URGENT off-platform cleanup — removed the bitly/social/email lines from the fixed description
//   (Etsy "no off-platform" policy); new actions tab-clean-list + tab-clean-apply to strip that footer from ALL existing
//   listings (backs up each original description to data/etsy-desc-backup.json first). Also: Shopify load brings ALL
//   product images (removed the 20 cap, query first:50) so the photo picker can choose which to send.
// v0.19 (2026-10-17): whole UI translated to English + user-facing backend messages in English; photo picker in the
//   edit step (max 20, untick extras when a listing has more than 20 photos — only the ticked ones are sent).
// v0.18 (2026-10-17): description voice = advice not art-description (NPG gold-standard: everyday-verb opening, keyword
//   woven in, first-person adviser, never describe what's visible, banned flowery phrasing); related links show the
//   title on its own line with the URL below; structured "Materials" attribute auto-set to Acrylic/Paper/Wood (front).
// v0.17 (2026-10-17): Sent items — a FAILED delete no longer removes the item from the list (keeps it on refresh);
//   store the featured image with each sent item so the Sent tab can show a collapsed row that expands to a preview.
// v0.16 (2026-10-17): FIX regression — attributes send value_ids AND values again (Etsy requires both), with the
//   display text cleaned ("5:7 (ISO ratio)" -> "5:7") so aspect ratio isn't "malformed". Description voice = a real
//   friendly decor adviser (short natural sentences; banned catalogue/novel phrasing like "a sense of", "drama"...).
//   Added listings_d scope so Sent items "Borrar" can delete a draft (RECONNECT once after deploy to grant it).
// v0.15 (2026-10-17): title has NO colours (colours only in attributes); attributes sent with value_ids ONLY (fixes
//   "5:7 malformed" aspect ratio); friendlier fixed-text links (related listings show their title, one per line);
//   Sent Items stored in GitHub (list/add/delete actions) for the Sent tab. Front: Craft/attrs as removable pills +
//   "add" menu, "Can be personalized" preselected Yes, Sent Items tab + reset after send.
// v0.14 (2026-10-17): Batch A — #3 keywords balanced order (drop impossible, near-dead last); #4 tags REWRITTEN to <=20
//   before the UI shows them; #5 AI writes only the top of the description + fixed footer (section name/link + 4 random
//   related listings) appended at publish; #8 is_personalizable ON; #10 personalisation text box "Personalise your item"
//   (+£5, optional) via the personalization endpoint. (#6 Craft / #7 aspect ratio 5:7 auto-sent from the front.)
// v0.13 (2026-10-17): 4 publish fixes (never let Etsy reject a publish):
//   1. Materials sanitised to letters/numbers/spaces only + cleaned default list (no hyphen/gsm/museum).
//   2. Tags FORCED to <=20 chars (truncate at a word boundary) instead of rejecting the publish.
//   3. Variations: send the COMPLETE Frame x Size matrix — present combos enabled+priced, missing combos disabled.
//   4. Attribute value_ids coerced to positive integers; invalid ones dropped (fixes "5:7 malformed" aspect ratio).
// v0.12 (2026-10-13): TAB 1 built. Removed test actions (test-draft, apify-compare, apify-seedtest).
//   Kept OAuth (auth/status/tokenExchange/call) + diagnose. New actions:
//   tab1-load (Shopify product by custom.sku_for_print_files + By Room/Style/Colour from mega-menu + variants),
//   tab1-keywords (Apify axlymxp, ONE batched run, <=15 seeds), tab1-generate (Claude: title, 13 tags, description, attributes),
//   tab1-meta (Etsy: shop sections + taxonomy 1029 properties), tab1-publish (draft + inventory 513/514 + attributes),
//   tab1-image (uploads ONE Shopify image to the draft). Token refresh now also on 403 + when only refresh token left.
const crypto = require('crypto');

const KEY = process.env.ETSY_KEYSTRING;
const SECRET = process.env.ETSY_SHARED_SECRET;
const APIKEY = KEY + ':' + SECRET; // Etsy wants keystring:shared_secret in x-api-key
const REDIRECT = 'https://tools.aboutwallart.com/api/etsy';
const SCOPES = 'listings_r listings_w listings_d shops_r'; // listings_d = delete (needed to remove a draft from Sent items)
const API = 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';


// ================= TAB 1 DATA (from handovers/AWA-ETSY-project-2026-10-12.md) =================
const SHOP_ID = '25023670', TAXONOMY = '1029', READINESS = '1410830180137', SHIPPING = '113487783584', RETURNS = '1082803901616';
const APIFY_ACTOR = 'A5KKVgfRFWo268Ggi'; // axlymxp
// #14: Sent Items are stored in GitHub (shows on every computer; never localStorage).
const REPO = 'aboutwallart/seo-tools';
const SENT_PATH = 'data/etsy-sent-items.json';
const CLEAN_BACKUP_PATH = 'data/etsy-desc-backup.json'; // original descriptions, saved before the one-time off-platform cleanup
const REG_PATH = 'data/etsy-listings.json';       // ONE registry: SKU -> [{listing_id,title,state}] (old live listings + new drafts)
const VIDEO_LOG_PATH = 'data/etsy-video-log.json'; // [{listing_id, video_id, sku, fileId, fileName, ts}] — videos this tool pushed
const COMMON_PATH = 'data/etsy-common-set.json';   // Replace images: the common image set (goes at the END of every listing), in order
const COMMON_DIR  = 'assets/etsy-common';          // where the common-set image files live in the repo (served via raw.githubusercontent)
const RI_UNDO_PATH = 'data/etsy-images-undo.json';  // Replace images: before every apply we save the listing's old image URLs + video (for undo)
const RI_DONE_PATH = 'data/etsy-images-done.json';  // Replace images: listing_ids already processed (saved), to show progress per section
// Compliance photo: bulk-add common image #2 (a real, non-AI, non-mockup photo) to every active + draft listing, to meet
// Etsy's rule. Runs in batches, resumable. QUEUE = the worklist of listing_ids; DONE = the ones already complied;
// UNDO = backup of any "last image" we deleted to make room at the 20-image cap.
const RI_COMPLY_QUEUE_PATH = 'data/etsy-compliance-queue.json';
const RI_COMPLY_DONE_PATH  = 'data/etsy-compliance-done.json';
const RI_COMPLY_UNDO_PATH  = 'data/etsy-compliance-undo.json';
function ghHeaders() { return { 'Authorization': 'token ' + process.env.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'awa-etsy' }; }
async function ghGet(path) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path + '?ref=main&t=' + Date.now(), { headers: ghHeaders() });
  if (r.status === 404) return { content: null, sha: null };
  if (!r.ok) throw new Error('GitHub get failed: ' + (await r.text()));
  const j = await r.json();
  return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}
async function ghPut(path, content, sha, message) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    method: 'PUT', headers: ghHeaders(),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha: sha || undefined, branch: 'main' })
  });
  if (!r.ok) { const t = await r.text(); const e = new Error('GitHub put failed: ' + t); e.status = r.status; throw e; }
  return true;
}
async function readSent() { try { const f = await ghGet(SENT_PATH); if (f.content) { const j = JSON.parse(f.content); return { items: Array.isArray(j) ? j : (j.items || []), sha: f.sha }; } } catch (e) {} return { items: [], sha: null }; }
async function readReg() { try { const f = await ghGet(REG_PATH); if (f.content) { const j = JSON.parse(f.content); return { map: (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}, sha: f.sha }; } } catch (e) {} return { map: {}, sha: null }; }
async function readVideoLog() { try { const f = await ghGet(VIDEO_LOG_PATH); if (f.content) { const j = JSON.parse(f.content); return { items: Array.isArray(j) ? j : (j.items || []), sha: f.sha }; } } catch (e) {} return { items: [], sha: null }; }
// Replace images — common set stored in GitHub (shows on every computer). Each item: {fileName, path, ts}. Served from raw.githubusercontent.
async function readCommon() { try { const f = await ghGet(COMMON_PATH); if (f.content) { const j = JSON.parse(f.content); return { items: Array.isArray(j) ? j : (j.items || []), sha: f.sha }; } } catch (e) {} return { items: [], sha: null }; }
function commonUrl(path) { return 'https://raw.githubusercontent.com/' + REPO + '/main/' + path; }
// Compliance photo = common set image #2 (index 1). Fetch its bytes from raw.githubusercontent for uploading to Etsy.
async function complyImageBuf() {
  const c = await readCommon(); const it = (c.items || [])[1];
  if (!it || !it.path) throw new Error('Common image #2 is not set — upload it in Replace images first.');
  const ir = await fetch(commonUrl(it.path));
  if (!ir.ok) throw new Error('Could not fetch common image #2 (' + ir.status + ')');
  return { buf: Buffer.from(await ir.arrayBuffer()), type: ir.headers.get('content-type') || 'image/jpeg', name: it.fileName || 'compliance.jpg' };
}
async function readComplyDone() { try { const f = await ghGet(RI_COMPLY_DONE_PATH); if (f.content) { const j = JSON.parse(f.content); return { ids: (j && j.ids) || [], sha: f.sha }; } } catch (e) {} return { ids: [], sha: null }; }
async function readComplyQueue() { try { const f = await ghGet(RI_COMPLY_QUEUE_PATH); if (f.content) { const j = JSON.parse(f.content); return { ids: (j && j.ids) || [], builtAt: (j && j.builtAt) || null, sha: f.sha }; } } catch (e) {} return { ids: [], builtAt: null, sha: null }; }
function withCommonUrls(items) { return (items || []).map(it => Object.assign({}, it, { url: commonUrl(it.path) })); }
async function readDone() { try { const f = await ghGet(RI_DONE_PATH); if (f.content) { const j = JSON.parse(f.content); return { ids: Array.isArray(j) ? j : (j.ids || []), sections: (j && j.sections) || {}, sha: f.sha }; } } catch (e) {} return { ids: [], sections: {}, sha: null }; }
// Etsy variant SKUs look like "{BASE}- {size}{frame} {paper}" (the base can contain spaces, e.g. "CYANOTYPE BROWN").
// The video filename gives the BASE, so group by the base code.
function baseSkuEtsy(s) { return String(s || '').split(/\s*-\s/)[0].trim().toUpperCase(); }
// Download a video straight from the shared Drive folder (same source as the Shopify video tool).
async function driveDownloadEtsy(fileId) {
  const r = await fetch('https://drive.google.com/uc?export=download&id=' + fileId, { redirect: 'follow' });
  if (!r.ok) throw new Error('Drive download failed: ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.slice(0, 64).toString('latin1').indexOf('ftyp') === -1) throw new Error('Drive did not return a valid MP4 — the folder must be shared "Anyone with the link".');
  return buf;
}
const WALL_ART_TERMS = ['wall art', 'art prints', 'wall decor', 'wall hangings', 'wall prints', 'canvas prints', 'wall pictures', 'wall posters', 'canvas art', 'art decor'];
const ROOMS = ['Living room', 'Bedroom', 'Nursery', 'Teens', 'Bathroom', 'Kitchen', 'Dining room', 'Hallway', 'Office', 'Laundry room', 'Above fireplace', 'Games room'];
const ROOM_SYN = {
  'Living room': ['living room', 'lounge', 'sitting room', 'family room', 'snug'],
  'Bedroom': ['bedroom', 'above bed', 'over bed'],
  'Nursery': ['nursery', 'baby room', 'playroom', 'kids', 'childrens'],
  'Teens': ['teen', 'teens', 'teenage'],
  'Bathroom': ['bathroom', 'shower room', 'ensuite', 'en-suite', 'powder room', 'washroom', 'toilet'],
  'Kitchen': ['kitchen'],
  'Dining room': ['dining room', 'dining', 'breakfast room'],
  'Hallway': ['hallway', 'entryway', 'entrance', 'foyer', 'corridor', 'staircase'],
  'Office': ['office', 'study', 'workspace'],
  'Laundry room': ['laundry', 'utility room'],
  'Above fireplace': ['above fireplace', 'over fireplace', 'mantel', 'mantelpiece', 'fireplace'],
  'Games room': ['games room', 'game room', 'man cave']
};
const ROOM_TO_ETSY_ROOM = {
  'Living room': ['Entryway', 'Living room'], 'Bedroom': ['Bedroom'], 'Nursery': ['Kids', 'Nursery'], 'Teens': ['Kids'],
  'Bathroom': ['Bathroom', 'Laundry'], 'Kitchen': ['Kitchen & dining'], 'Dining room': ['Entryway', 'Kitchen & dining', 'Living room'],
  'Hallway': ['Entryway', 'Kitchen & dining', 'Living room'], 'Office': ['Office'], 'Laundry room': ['Bathroom', 'Laundry'],
  'Above fireplace': ['Entryway', 'Kitchen & dining', 'Living room'], 'Games room': ['Bar', 'Game room', 'Man cave']
};
const ROOM_TO_SECTION = {
  'Living room': 'Living room Wall Decor', 'Bedroom': 'Above bed Decor', 'Nursery': 'Baby Nursery Wall Decor', 'Teens': 'College Dorm Decor',
  'Bathroom': 'Bathroom Wall Decor', 'Kitchen': 'Kitchen Wall Decor', 'Office': 'Office Decor', 'Laundry room': 'Laundry room Wall Art'
  // Dining room / Hallway / Above fireplace / Games room: no section yet (Tab 4 creates them)
};
// style-owned shop sections (candidates only — Mae chooses). 🔴 style→section pairs are my mapping, not confirmed.
const STYLE_TO_SECTION = { 'Zen': 'Zen Decor', 'Islamic': 'Islamic Wall Art Decor', 'Farmhouse': 'Farmhouse Wall Decor', 'Coastal': 'Beach Themed Wall Decor', 'Christian': 'Modern Christian Art' };
const STYLE_SYN = {
  'Biophilic': ['biophilic', 'botanical', 'floral', 'plants', 'greenery', 'leaves', 'foliage', 'nature'],
  'Farmhouse': ['farmhouse', 'botanical', 'floral', 'rustic', 'country', 'barn'],
  'Shabby chic': ['shabby chic', 'floral', 'romantic'],
  'Vintage': ['vintage'],
  'Japandi': ['japandi', 'relax', 'relaxing', 'calm', 'calming', 'zen', 'japan', 'japanese', 'asian', 'oriental', 'chinese', 'wabi-sabi'],
  'Zen': ['zen', 'buddha', 'buddhist', 'buddhism', 'lotus', 'meditation'],
  'Scandinavian': ['scandinavian', 'scandi', 'nordic', 'forest', 'hygge'],
  'Travel': ['travel', 'map', 'maps', 'world', 'adventure', 'wanderlust'],
  'Christian': ['christian', 'faith', 'bible', 'scripture', 'cross', 'jesus', 'god'],
  'Islamic': ['islamic', 'islam', 'muslim', 'quran', 'arabic', 'arab', 'arabesque'],
  'Minimalism': ['minimalist', 'minimal', 'simple', 'clean'],
  'Masculine': ['masculine', 'male', 'manly', 'bold dark'],
  'Industrial': ['industrial', 'urban', 'loft', 'metal', 'concrete'],
  'Moroccan': ['moroccan', 'morocco', 'marrakech', 'arabesque'],
  'Abstract': ['abstract', 'geometric'],
  'Bohemian': ['bohemian', 'boho', 'hippie'],
  'Coastal': ['coastal', 'beach', 'sea', 'ocean', 'nautical', 'seaside'],
  'Tropical': ['tropical', 'palm', 'jungle', 'exotic'],
  'Wildlife': ['wildlife', 'animals', 'safari'],
  'Sun & moon': ['sun and moon', 'celestial', 'moon', 'stars'],
  'Black & white': ['black and white', 'monochrome'],
  'Coffee': ['coffee', 'coffee house', 'cafe'],
  'Chinoiserie': ['chinoiserie'],
  'Mid century': ['mid century', 'midcentury', 'retro', 'lux', 'luxury'],
  'Mediterranean': ['mediterranean', 'amalfi', 'positano', 'capri', 'cinque terre', 'riviera', 'santorini'],
  'Contemporary': ['contemporary', 'modern'],
  'Maximalism': ['maximalism', 'maximalist'],
  'French country': ['french country', 'provence', 'floral', 'florals', 'bees', 'hives', 'beehive'],
  'Old money': ['map', 'maps', 'earth', 'equestrian', 'horses', 'vintage'],
  'Marble': ['marble'], 'Eclectic': ['eclectic'], 'Country cottage': ['country cottage', 'cottagecore'], 'Preppy': ['preppy'], 'Transitional': ['transitional']
};
const MATERIALS_DEFAULT = ['Perspex', 'Wrapped canvas', 'Satin photo paper', 'MDF frame', 'Fade resistant pigment inks'];
// Etsy Materials accept letters, numbers and spaces only (a hyphen -> "invalid characters").
// Sanitise each one: replace anything else with a space, collapse spaces, trim, cap at 45 chars.
function sanitizeMaterial(s) { return String(s || '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 45); }
// Force an Etsy tag to <=20 chars: trim, and if too long cut at the last space that still fits, else hard cut.
function clampTag(s) { var t = String(s || '').replace(/\s+/g, ' ').trim(); if (t.length <= 20) return t; var cut = t.slice(0, 20); var sp = cut.lastIndexOf(' '); return (sp >= 10 ? cut.slice(0, sp) : cut).trim(); }
// #4: guarantee every tag is <=20 chars by REWRITING (not cutting) the long ones with the AI, before the UI shows them.
async function ensureTagsUnder20(out) {
  for (let pass = 0; pass < 3; pass++) {
    const tags = Array.isArray(out.tags) ? out.tags.map(t => String(t || '').replace(/\s+/g, ' ').trim()) : [];
    out.tags = tags;
    const long = tags.filter(t => t.length > 20);
    if (!long.length) return;
    const ok = tags.filter(t => t.length > 0 && t.length <= 20);
    const fixPrompt = 'These Etsy tags are over 20 characters: ' + JSON.stringify(long) + '. For EACH, write a REPLACEMENT that keeps the same meaning and is a real Etsy search phrase (a descriptor + a wall-art synonym), MAXIMUM 20 characters INCLUDING SPACES. Never cut a word mid-way — rephrase with a shorter synonym instead. All replacements must be unique, lowercase, and must NOT duplicate any of these existing tags: ' + JSON.stringify(ok) + '. Return ONLY JSON: {"replacements":[{"old":"<old tag>","new":"<new tag, 20 chars or fewer>"}]}';
    let rep = [];
    try { const fix = await claudeJSON([{ type: 'text', text: fixPrompt }], 800); rep = Array.isArray(fix.replacements) ? fix.replacements : []; } catch (e) { /* keep going; final clamp guards */ }
    const map = {};
    rep.forEach(r => { if (r && r.old != null && r.new != null) map[String(r.old)] = String(r.new).replace(/\s+/g, ' ').trim(); });
    out.tags = tags.map(t => (t.length > 20 && map[t] && map[t].length <= 20 ? map[t] : t));
  }
  // last-resort guard (should never fire after 3 rewrite passes): clamp so the UI never shows a tag over 20.
  out.tags = (out.tags || []).map(t => clampTag(String(t || '')));
}
// #5: the common footer appended under every listing description. {SECTION}/{SECTION_LINK}/{RELATED} are filled at publish.
const SHOP_URL_NAME = 'AboutWallArt';
const FIXED_DESCRIPTION = [
  'Details:',
  '* Printed on premium satin photo paper (280gsm) for exceptional colour and clarity — wrapped canvas option also available.',
  '* We use fade-resistant pigment inks for bright colour that won\'t fade in sunlight.',
  '* For indoor use only.',
  '* White mounts are not included.',
  '* Choose your prints on their own, or add a frame in black, white or oak — so your set arrives ready to hang, with no hunting for frames to fit the size.',
  '',
  'About the frames:',
  '* Our frames come with a hanger and a strut, for freestanding or wall-hanging displays (landscape or portrait).',
  '* Made with a clear perspex front (for safety) and a matt-painted MDF frame, with a sturdy MDF backboard and strut.',
  '* Please note: the size you choose is the print size that fits the frame, not the overall outer size.',
  '',
  'Personalisation:',
  '* I can adapt the print to any size you wish.',
  '* I can also add a quote of your choice. Just message me!',
  '',
  'Care:',
  'If your print gathers any dust, wipe it gently with a clean, dry cloth.',
  '',
  'Packaging:',
  'All prints are delivered in protective packaging — A4 in a board envelope, A3 and above in a strong postal tube.',
  '',
  'FREE UK POSTAGE — we aim to ship all orders within 1-3 business days.',
  '',
  'Thank you for visiting and supporting our small business!',
  '',
  'See more in our {SECTION} collection:',
  '{SECTION_LINK}',
  '',
  'You may also like:',
  '{RELATED}',
  '',
  'AboutWallArt is a registered trademark. All rights reserved. Colours may vary slightly depending on your screen settings.',
  '',
  'Mae',
  'AboutWallArt'
].join('\n');
// Build the fixed footer with the Etsy section name/link + up to 4 random OTHER listings from the same section.
async function buildFixedDescription(call, sectionId, sectionTitle, excludeListingId) {
  let sectionLink = sectionId ? ('https://www.etsy.com/shop/' + SHOP_URL_NAME + '?section_id=' + sectionId) : ('https://www.etsy.com/shop/' + SHOP_URL_NAME);
  let related = '';
  if (sectionId) {
    try {
      const r = await call('/shops/' + SHOP_ID + '/listings/active?limit=100');
      const all = (r.json && r.json.results) || [];
      const inSection = all.filter(l => String(l.shop_section_id) === String(sectionId) && String(l.listing_id) !== String(excludeListingId));
      // shuffle, take up to 4
      for (let i = inSection.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = inSection[i]; inSection[i] = inSection[j]; inSection[j] = t; }
      // #17: one per line, with the listing TITLE in front of the link so buyers read what it is (not just an id).
      related = inSection.slice(0, 4).map(l => {
        const t = String(l.title || '').split('|')[0].trim();
        return (t ? '• ' + t + '\n' : '') + 'https://www.etsy.com/listing/' + l.listing_id;
      }).join('\n\n');
    } catch (e) { /* best effort: leave related empty */ }
  }
  return FIXED_DESCRIPTION
    .replace('{SECTION}', sectionTitle || 'About Wall Art')
    .replace('{SECTION_LINK}', sectionLink)
    .replace('{RELATED}', related);
}

// Read ONE listing (any state, drafts included) via the shop-scoped listings endpoint. getListing (/listings/{id})
// 400s on drafts; getListingsByShop returns them. Scans active+draft, returns the full listing object or null.
async function findShopListingById(call, id) {
  const want = String(id);
  for (const state of ['active', 'inactive', 'draft']) {
    let offset = 0, total = Infinity;
    for (let page = 0; page < 300 && offset < total; page++) {
      const lr = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset);
      if (lr.status >= 300) break;
      const j = lr.json || {};
      total = (typeof j.count === 'number') ? j.count : 0;
      const results = j.results || [];
      if (!results.length) break;
      const hit = results.find(l => String(l.listing_id) === want);
      if (hit) return hit;
      offset += 100;
    }
  }
  return null;
}
// Replace a listing's media: delete its video(s) and photos, then upload the given image URLs (any http(s) source).
// Etsy refuses to delete a listing's LAST image and caps at 20, so keep one anchor, upload, delete the anchor, then
// retry any that were blocked by the cap. Returns counts + a one-line warning. Used by tab1-apply-template.
async function replaceListingMedia(call, target, imageUrls) {
  const out = { video: { found: 0, deleted: 0 }, photos: { found: 0, deleted: 0, uploaded: 0, failed: 0 }, warning: '', firstImg: '' };
  // --- video ---
  try {
    const lv = await call('/listings/' + target + '/videos');
    const vids = (lv.json && (lv.json.results || lv.json.videos)) || [];
    out.video.found = vids.length;
    for (const v of vids) { const dv = await call('/shops/' + SHOP_ID + '/listings/' + target + '/videos/' + v.video_id, { method: 'DELETE' }); if (dv.status < 300) out.video.deleted++; }
  } catch (e) { /* best-effort */ }
  // --- photos ---
  const urls = (imageUrls || []).filter(Boolean).slice(0, 20);
  out.firstImg = urls[0] || '';
  try {
    const cur = await call('/listings/' + target + '/images');
    const oldImgs = (cur.json && cur.json.results) || [];
    out.photos.found = oldImgs.length;
    const anchor = oldImgs.length ? oldImgs[0] : null;   // keep one so deleting the others never hits "the last image"
    const delImage = async (id) => { const dr = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images/' + id, { method: 'DELETE' }); if (dr.status < 300) { out.photos.deleted++; return true; } return false; };
    for (const im of oldImgs.slice(1)) await delImage(im.listing_image_id);
    let firstErr = null;
    const uploadOne = async (i) => {
      try {
        const ir = await fetch(urls[i]);
        if (!ir.ok) { if (!firstErr) firstErr = 'image fetch ' + ir.status; return false; }
        const buf = Buffer.from(await ir.arrayBuffer());
        const fd = new FormData();
        fd.append('image', new Blob([buf], { type: ir.headers.get('content-type') || 'image/jpeg' }), 'image-' + (i + 1) + '.jpg');
        fd.append('rank', String(i + 1));
        const r = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images', { method: 'POST', body: fd });
        if (r.status < 300) return true;
        if (!firstErr) firstErr = 'etsy upload ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 150);
        return false;
      } catch (e) { if (!firstErr) firstErr = String(e && e.message || e); return false; }
    };
    const pending = [];
    for (let i = 0; i < urls.length; i++) { if (await uploadOne(i)) out.photos.uploaded++; else pending.push(i); }  // pass 1 (anchor still there)
    if (anchor && out.photos.uploaded > 0) await delImage(anchor.listing_image_id);  // now new photos exist -> anchor deletable
    const still = [];
    for (const i of pending) { if (await uploadOne(i)) out.photos.uploaded++; else still.push(i); }  // pass 2: blocked by the 20-cap
    out.photos.failed = still.length;
    if (out.photos.failed && firstErr) out.warning = out.photos.failed + ' of ' + urls.length + ' photos failed: ' + firstErr;
    else if (out.photos.uploaded === 0 && urls.length && firstErr) out.warning = 'all photos failed: ' + firstErr;
  } catch (e) { out.warning = 'photos error: ' + String(e && e.message || e); }
  return out;
}
// Replace images (Tanda 2): apply an ORDERED list of image entries ({url} OR {dataBase64}) to a listing, plus an
// optional video URL. Mirrors replaceListingMedia's anchor trick + 20-cap retry. Entries already include the common set
// at the end (the front builds the order). Deletes the current video first and uploads the new one if given.
async function riApplyMedia(call, target, entries, video) {
  const out = { video: { deleted: 0, uploaded: 0 }, photos: { found: 0, deleted: 0, uploaded: 0, failed: 0 }, warning: '' };
  // --- video: keep (default — never touch it), replace, or remove ---
  const vAct = (video && video.action) || 'keep';
  if (vAct === 'replace' || vAct === 'remove') {
    try {
      const lv = await call('/listings/' + target + '/videos');
      const vids = (lv.json && (lv.json.results || lv.json.videos)) || [];
      for (const v of vids) { const dv = await call('/shops/' + SHOP_ID + '/listings/' + target + '/videos/' + v.video_id, { method: 'DELETE' }); if (dv.status < 300) out.video.deleted++; }
    } catch (e) { /* best-effort */ }
    if (vAct === 'replace' && video.url) {
      try {
        const vr = await fetch(video.url);
        if (vr.ok) {
          const vbuf = Buffer.from(await vr.arrayBuffer());
          const fd = new FormData();
          fd.append('video', new Blob([vbuf], { type: vr.headers.get('content-type') || 'video/mp4' }), 'video.mp4');
          fd.append('name', 'video.mp4');
          const r = await call('/shops/' + SHOP_ID + '/listings/' + target + '/videos', { method: 'POST', body: fd });
          if (r.status < 300) out.video.uploaded++; else out.warning += ' video upload ' + r.status + ';';
        }
      } catch (e) { out.warning += ' video error;'; }
    }
  }
  // --- photos: resolve each entry to bytes, then anchor-trick upload ---
  const list = (entries || []).slice(0, 20);
  let firstErr = null;
  const bufs = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i] || {};
    try {
      if (e.dataBase64) bufs.push({ buf: Buffer.from(String(e.dataBase64).replace(/^data:[^,]+,/, ''), 'base64'), type: 'image/jpeg', alt: e.alt || '' });
      else if (e.url) { const ir = await fetch(e.url); if (!ir.ok) { if (!firstErr) firstErr = 'fetch ' + ir.status; bufs.push(null); } else bufs.push({ buf: Buffer.from(await ir.arrayBuffer()), type: ir.headers.get('content-type') || 'image/jpeg', alt: e.alt || '' }); }
      else bufs.push(null);
    } catch (err) { if (!firstErr) firstErr = String(err && err.message || err); bufs.push(null); }
  }
  try {
    const cur = await call('/listings/' + target + '/images');
    const oldImgs = (cur.json && cur.json.results) || [];
    out.photos.found = oldImgs.length;
    const anchor = oldImgs.length ? oldImgs[0] : null;
    const delImage = async (id) => { const dr = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images/' + id, { method: 'DELETE' }); if (dr.status < 300) { out.photos.deleted++; return true; } return false; };
    for (const im of oldImgs.slice(1)) await delImage(im.listing_image_id);
    const uploadOne = async (i) => {
      const b = bufs[i]; if (!b) return false;
      try {
        const fd = new FormData();
        fd.append('image', new Blob([b.buf], { type: b.type }), 'image-' + (i + 1) + '.jpg');
        fd.append('rank', String(i + 1));
        if (b.alt) fd.append('alt_text', String(b.alt).slice(0, 250));
        const r = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images', { method: 'POST', body: fd });
        if (r.status < 300) return true;
        if (!firstErr) firstErr = 'etsy upload ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 120);
        return false;
      } catch (e) { if (!firstErr) firstErr = String(e && e.message || e); return false; }
    };
    const pending = [];
    for (let i = 0; i < list.length; i++) { if (await uploadOne(i)) out.photos.uploaded++; else pending.push(i); }  // pass 1 (anchor still there)
    if (anchor && out.photos.uploaded > 0) await delImage(anchor.listing_image_id);
    const still = [];
    for (const i of pending) { if (await uploadOne(i)) out.photos.uploaded++; else still.push(i); }  // pass 2 (20-cap)
    out.photos.failed = still.length;
    if ((out.photos.failed || out.photos.uploaded === 0) && firstErr) out.warning += ' ' + out.photos.failed + ' photos failed: ' + firstErr;
  } catch (e) { out.warning += ' photos error: ' + String(e && e.message || e); }
  return out;
}
function stripHtml(h) { return String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
function normT(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function eqSku(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
// Description variety: each generate call picks ONE opening verb + TWO advice angles at random, so listings written in
// separate (memory-less) AI calls still open differently and don't all read the same.
const OPEN_VERBS = ['Add', 'Bring', 'Give', 'Style', 'Layer', 'Create', 'Turn', 'Set', 'Warm up', 'Lift', 'Pull together', 'Finish', 'Soften', 'Freshen up', 'Anchor', 'Brighten', 'Make', 'Update', 'Transform'];
const FOCUS_ANGLES = [
  'where it works best — which rooms, which wall, the light it suits',
  'how to style it with what the buyer already owns — colours, materials, furniture',
  'the mood and atmosphere it brings to the room',
  'how to hang a set of three well — even gaps of about 5-8 cm, same height, centred around eye level (~145-150 cm)',
  'who it makes a good gift for and the occasions it suits',
  'how to rescue an empty or awkward wall so it feels finished',
  'how the three pieces work together as a trio and alongside the rest of the room'
];
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickDistinct(arr, n) {
  const pool = arr.slice(), out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
function sizeLabel(v) {
  const m = /^(A\d)\b/i.exec(v); if (m) return m[1].toUpperCase();
  const n = /(\d+)\s*x\s*(\d+)/i.exec(v); return n ? n[1] + 'x' + n[2] : String(v).slice(0, 20);
}
function frameLabel(v) { return String(v).replace(/\s*frame$/i, '').trim(); }
function parseJsonArr(v) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : [String(a)]; } catch { return v ? [String(v)] : []; } }

async function shopGQL(query, variables) {
  const SHOP = process.env.SHOPIFY_STORE_DOMAIN, STOK = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!SHOP || !STOK) throw new Error('Shopify no configurado en Vercel');
  const r = await fetch('https://' + SHOP + '/admin/api/2025-01/graphql.json', { method: 'POST', headers: { 'X-Shopify-Access-Token': STOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
// By Room / By Style / By Colour leaves from the site mega-menu (SHOP WALL ART > group > collection leaves)
async function menuGroups() {
  const list = await shopGQL('query{ menus(first:20){ nodes{ id handle } } }');
  const hit = (list.menus.nodes || []).find(m => m.handle === 'new-mega-menu');
  if (!hit) throw new Error('Menú "new-mega-menu" no encontrado');
  const d = await shopGQL('query($id:ID!){ menu(id:$id){ items{ title items{ title resourceId items{ title resourceId } } } } }', { id: hit.id });
  const wa = (d.menu.items || []).find(t => normT(t.title) === 'shop wall art');
  const groups = {}; // 'by room' -> Map(gid -> leaf title)
  ((wa && wa.items) || []).forEach(g => {
    const m = new Map();
    (g.items || []).forEach(l => { if (l.resourceId) m.set(l.resourceId, l.title); });
    groups[normT(g.title)] = m;
  });
  return groups;
}
async function loadProduct(sku) {
  // Bring several candidates (Shopify's metafield search is partial, so it can return products that merely contain a
  // piece of the SKU). We then keep ONLY the one whose sku_for_print_files metafield equals the SKU exactly.
  const gq = 'query($q:String!){ products(first:25, query:$q){ nodes{ id title handle tags productType descriptionHtml images(first:50){nodes{url}} collections(first:60){nodes{id title}} variants(first:100){nodes{sku price selectedOptions{name value}}} room:metafield(namespace:"custom",key:"room_type"){value} col:metafield(namespace:"custom",key:"primary_colour"){value} skuMf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } }';
  const d = await shopGQL(gq, { q: 'metafield:custom.sku_for_print_files:' + sku });
  const nodes = d.products.nodes || [];
  const n = nodes.find(x => eqSku(x.skuMf && x.skuMf.value, sku));
  if (!n) {
    // No exact match — hand back the closest candidates (with featured image) so Mae can spot a typo and pick one.
    const similar = nodes.slice(0, 8).map(x => ({ sku: (x.skuMf && x.skuMf.value) || '', title: x.title, image: (x.images.nodes[0] || {}).url || '' }));
    return { noMatch: true, similar };
  }
  const groups = await menuGroups();
  const col = { room: [], style: [], colour: [], occasion: [] };
  (n.collections.nodes || []).forEach(c => {
    [['room', 'by room'], ['style', 'by style'], ['colour', 'by colour'], ['occasion', 'by occasion']].forEach(([k, g]) => { const m = groups[g]; if (m && m.has(c.id)) col[k].push(m.get(c.id)); });
  });
  const text = normT(n.title + ' ' + (n.tags || []).join(' '));
  // ROOM: By Room collection -> room_type metafield -> words in title/tags
  let rooms = ROOMS.filter(r => col.room.some(x => normT(x).includes(normT(r))));
  let roomFrom = 'colección By Room';
  if (!rooms.length) { rooms = ROOMS.filter(r => parseJsonArr(n.room && n.room.value).some(x => normT(x) === normT(r))); roomFrom = 'metafield room_type'; }
  if (!rooms.length) { rooms = ROOMS.filter(r => ROOM_SYN[r].some(w => text.includes(w))); roomFrom = 'título/tags'; }
  if (!rooms.length) roomFrom = 'no detectado';
  // STYLES: By Style collections + tags/title
  const styles = [];
  Object.keys(STYLE_SYN).forEach(s => {
    const inCol = col.style.some(x => normT(x) === normT(s) || normT(x).includes(normT(s)));
    const inText = text.includes(normT(s));
    if (inCol || inText) styles.push(s);
  });
  const colours = parseJsonArr(n.col && n.col.value);
  // variants: Satin paper + Canvas only (Paper is fixed on Etsy); Frame/Size short labels
  const variants = [];
  (n.variants.nodes || []).forEach(v => {
    const o = {}; v.selectedOptions.forEach(x => { o[x.name] = x.value; });
    const isCanvas = /canvas/i.test(o.Frame || '');
    if (!(isCanvas || /satin/i.test(o.Paper || ''))) return;
    variants.push({ frame: frameLabel(o.Frame || ''), size: sizeLabel(o.Size || ''), price: parseFloat(v.price) });
  });
  return {
    product: {
      sku, id: n.id, title: n.title, handle: n.handle, tags: n.tags || [], productType: n.productType,
      description: stripHtml(n.descriptionHtml).slice(0, 3000),
      images: (n.images.nodes || []).map(i => i.url),
      collections: col, rooms, roomFrom, styles, colours, variants,
      styleSynonyms: STYLE_SYN, wallArtTerms: WALL_ART_TERMS, allRooms: ROOMS,
      roomToEtsyRoom: ROOM_TO_ETSY_ROOM, roomToSection: ROOM_TO_SECTION, styleToSection: STYLE_TO_SECTION, materialsDefault: MATERIALS_DEFAULT
    }
  };
}
// Lightweight preview for the family list: featured image + title + exact-match flag for one SKU.
async function loadThumb(sku) {
  const gq = 'query($q:String!){ products(first:25, query:$q){ nodes{ title images(first:1){nodes{url}} skuMf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } }';
  const d = await shopGQL(gq, { q: 'metafield:custom.sku_for_print_files:' + sku });
  const nodes = d.products.nodes || [];
  const hit = nodes.find(x => eqSku(x.skuMf && x.skuMf.value, sku));
  if (hit) return { exact: true, title: hit.title, image: (hit.images.nodes[0] || {}).url || '' };
  return { exact: false, title: '', image: '' };
}
// Replace images: Shopify product media (all images + the product video) for one SKU. Exact match on sku_for_print_files;
// when there is no exact match, return the closest candidates (with a thumbnail) so Mae can pick one by hand.
async function loadShopifyMedia(sku) {
  // Same proven query as loadProduct (NO media/video — the media field broke the whole search on this API version).
  const gq = 'query($q:String!){ products(first:25, query:$q){ nodes{ id title handle images(first:50){nodes{url altText}} skuMf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } }';
  async function tryOne(s) {
    if (!s) return { nodes: [], n: null };
    const d = await shopGQL(gq, { q: 'metafield:custom.sku_for_print_files:' + s });
    const nodes = d.products.nodes || [];
    return { nodes, n: nodes.find(x => eqSku(x.skuMf && x.skuMf.value, s)) };
  }
  const want = String(sku || '').trim();
  let { nodes, n } = await tryOne(want);
  if (!n) {
    const base = baseSkuEtsy(want);  // fallback: strip any Etsy variant suffix ("...- A4B SATIN") and match the base
    if (base && base.toLowerCase() !== want.toLowerCase()) { const r2 = await tryOne(base); if (r2.n) { n = r2.n; nodes = r2.nodes; } else if (!nodes.length) nodes = r2.nodes; }
  }
  if (!n) {
    const similar = nodes.slice(0, 8).map(x => ({ sku: (x.skuMf && x.skuMf.value) || '', title: x.title, image: ((x.images.nodes[0]) || {}).url || '' }));
    return { noMatch: true, similar };
  }
  return { matched: true, id: n.id, title: n.title, handle: n.handle, images: (n.images.nodes || []).map(i => ({ url: i.url, alt: i.altText || '' })) };
}
// Replace images — "Etsy + Shopify" option: upload one image (base64) to Shopify Files and return its permanent
// CDN url. COPIED from api/keywords.js's proven uploadImageToShopify (staged upload -> multipart POST -> fileCreate
// -> poll), adapted to use shopGQL. Do not diverge from that pattern.
async function uploadImageToShopify(base64, filename, mimeType, altText) {
  const mime = mimeType || 'image/jpeg';
  const safeFilename = String(filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  const sd = await shopGQL('mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }', { input: [{ resource: 'FILE', filename: safeFilename, mimeType: mime, httpMethod: 'POST' }] });
  const ue1 = sd.stagedUploadsCreate.userErrors || []; if (ue1.length) throw new Error(ue1[0].message);
  const target = sd.stagedUploadsCreate.stagedTargets[0]; if (!target) throw new Error('No staged upload target returned');
  const imageBuffer = Buffer.from(base64, 'base64');
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  let formParts = '';
  for (const p of target.parameters) formParts += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
  formParts += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`;
  const bodyBuf = Buffer.concat([Buffer.from(formParts, 'utf8'), imageBuffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
  const ur = await fetch(target.url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: bodyBuf });
  if (!ur.ok) { const t = await ur.text(); throw new Error('Upload to Shopify failed: ' + t.slice(0, 200)); }
  const cd = await shopGQL('mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ ... on MediaImage { id image{ url } } } userErrors{ field message } } }', { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: String(altText || safeFilename).slice(0, 512) }] });
  const ue2 = cd.fileCreate.userErrors || []; if (ue2.length) throw new Error(ue2[0].message);
  const file = cd.fileCreate.files[0]; let cdnUrl = file && file.image ? file.image.url : null; const fileId = file ? file.id : null;
  if (!fileId) throw new Error('fileCreate did not return a file id.');
  for (let a = 0; !cdnUrl && a < 6; a++) { await new Promise(r => setTimeout(r, 2000)); try { const pd = await shopGQL('query($id:ID!){ node(id:$id){ ... on MediaImage { image{ url } } } }', { id: fileId }); cdnUrl = pd.node && pd.node.image ? pd.node.image.url : null; } catch (e) {} }
  return { gid: fileId, url: cdnUrl };
}
// Replace the whole image set on a Shopify product, in the given order. entries: [{url}|{dataBase64}, alt]. Creates
// the new media FIRST (so the product is never left without images if something fails), then deletes the old media —
// leaving exactly the new set in array order.
async function pushImagesToShopify(productGid, entries) {
  const media = [];
  for (const e of (entries || [])) {
    let src = e.url;
    if (!src && e.dataBase64) { const b64 = String(e.dataBase64).replace(/^data:[^;]+;base64,/, ''); const up = await uploadImageToShopify(b64, 'awa-etsy-' + Date.now(), 'image/jpeg', e.alt); src = up.url; }
    if (src) media.push({ originalSource: src, alt: String(e.alt || '').slice(0, 512), mediaContentType: 'IMAGE' });
  }
  if (!media.length) throw new Error('No images to push to Shopify');
  const before = await shopGQL('query($id:ID!){ product(id:$id){ media(first:100){ nodes{ id } } } }', { id: productGid });
  const oldIds = ((before.product && before.product.media && before.product.media.nodes) || []).map(n => n.id);
  const cr = await shopGQL('mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){ media{ id } mediaUserErrors{ field message } } }', { pid: productGid, media });
  const ue = (cr.productCreateMedia && cr.productCreateMedia.mediaUserErrors) || []; if (ue.length) throw new Error('create media: ' + ue[0].message);
  if (oldIds.length) {
    const del = await shopGQL('mutation($pid:ID!,$ids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$ids){ deletedMediaIds mediaUserErrors{ field message } } }', { pid: productGid, ids: oldIds });
    const ue2 = (del.productDeleteMedia && del.productDeleteMedia.mediaUserErrors) || []; if (ue2.length) throw new Error('delete media: ' + ue2[0].message);
  }
  return { pushed: media.length, removed: oldIds.length };
}
// Replace images: ALL Shopify sku_for_print_files values (lowercased set) — to flag each Etsy listing as matched or not
// in the list, without one query per listing. ~5 paginated queries for the whole catalogue.
async function allShopifySkus() {
  const set = new Set(); let after = null;
  for (let p = 0; p < 30; p++) {
    const d = await shopGQL('query($after:String){ products(first:250, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ skuMf:metafield(namespace:"custom",key:"sku_for_print_files"){value} } } }', { after });
    (d.products.nodes || []).forEach(n => { const v = n.skuMf && n.skuMf.value; if (v) set.add(String(v).trim().toLowerCase()); });
    if (!d.products.pageInfo.hasNextPage) break;
    after = d.products.pageInfo.endCursor;
  }
  return set;
}
async function runApify(seeds) {
  const APIFY = process.env.APIFY_TOKEN;
  if (!APIFY) throw new Error('APIFY_TOKEN no está configurado en Vercel');
  const t0 = Date.now();
  const rr = await fetch('https://api.apify.com/v2/acts/' + APIFY_ACTOR + '/run-sync-get-dataset-items?token=' + APIFY + '&format=json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seedKeywords: seeds, maxKeywordsPerSeed: 25, includeCompetition: true, includeSeedRow: true, country: 'GB', currency: 'GBP' })
  });
  const items = await rr.json();
  if (!Array.isArray(items)) throw new Error('Apify respondió: ' + JSON.stringify(items).slice(0, 300));
  return { items, took_s: Math.round((Date.now() - t0) / 1000), status: rr.status };
}
// Pull the FIRST complete JSON object out of the model's text (brace-count, string-aware), ignoring anything the AI
// adds after it. A greedy /{...}/ would span from the first "{" to the LAST "}", swallowing a trailing 2nd block or
// note and breaking JSON.parse ("Unexpected non-whitespace character after JSON").
function firstJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}
async function claudeJSON(content, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no está configurado en Vercel');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 4000, messages: [{ role: 'user', content }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude API: ' + JSON.stringify(d).slice(0, 400));
  const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').replace(/```json\n?/g, '').replace(/```/g, '');
  const jsonStr = firstJsonObject(txt);
  if (!jsonStr) throw new Error('Claude no devolvió JSON');
  return JSON.parse(jsonStr);
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function parseCookies(req) {
  const h = req.headers.cookie || ''; const o = {};
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}

async function tokenExchange(body) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KEY) { res.status(500).json({ ok: false, error: 'ETSY_KEYSTRING is not set in Vercel' }); return; }

  const q = req.query || {};
  const ck = parseCookies(req);

  // ---------- OAuth callback (Etsy redirects here with ?code=) ----------
  if (q.code) {
    if (!ck.etsy_state || q.state !== ck.etsy_state) { res.status(400).send('State no coincide. Volvé a conectar.'); return; }
    const ex = await tokenExchange({
      grant_type: 'authorization_code',
      client_id: KEY,
      redirect_uri: REDIRECT,
      code: q.code,
      code_verifier: ck.etsy_cv || ''
    });
    if (!ex.ok) { res.status(400).send('Error al obtener el token: ' + JSON.stringify(ex.json)); return; }
    const at = ex.json.access_token, rt = ex.json.refresh_token, expIn = ex.json.expires_in || 3600;
    res.setHeader('Set-Cookie', [
      cookie('etsy_at', at, expIn),
      cookie('etsy_rt', rt, 60 * 60 * 24 * 80),
      cookie('etsy_cv', '', 0),
      cookie('etsy_state', '', 0)
    ]);
    res.writeHead(302, { Location: '/awa-etsy.html?connected=1' });
    res.end();
    return;
  }

  // ---------- Start OAuth ----------
  if (q.action === 'auth') {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const url = 'https://www.etsy.com/oauth/connect?response_type=code'
      + '&client_id=' + encodeURIComponent(KEY)
      + '&redirect_uri=' + encodeURIComponent(REDIRECT)
      + '&scope=' + encodeURIComponent(SCOPES)
      + '&state=' + state
      + '&code_challenge=' + challenge
      + '&code_challenge_method=S256';
    res.setHeader('Set-Cookie', [cookie('etsy_cv', verifier, 600), cookie('etsy_state', state, 600)]);
    res.writeHead(302, { Location: url });
    res.end();
    return;
  }

  // ---------- Authenticated actions ----------
  let at = ck.etsy_at || '';
  const rt = ck.etsy_rt || '';

  if (q.action === 'status') { res.status(200).json({ ok: true, connected: !!at || !!rt }); return; }

  // ================= TAB 1 — PUBLIC ACTIONS (Shopify / Apify / Claude; no Etsy auth) =================
  if (q.action === 'tab1-load') {
    try {
      const sku = String(q.sku || '').trim();
      if (!sku) { res.status(400).json({ ok: false, error: 'Missing SKU' }); return; }
      const p = await loadProduct(sku);
      if (p && p.product) { res.status(200).json({ ok: true, product: p.product }); return; }
      if (p && p.noMatch) { res.status(200).json({ ok: true, noMatch: true, similar: p.similar || [] }); return; }
      res.status(404).json({ ok: false, error: 'No product found with print-files SKU = ' + sku });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-thumb') {
    try {
      const sku = String(q.sku || '').trim();
      if (!sku) { res.status(400).json({ ok: false, error: 'Missing SKU' }); return; }
      const t = await loadThumb(sku);
      res.status(200).json({ ok: true, sku, image: t.image, title: t.title, exact: t.exact });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-keywords') {
    try {
      const seeds = String(q.seeds || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 15);
      if (!seeds.length) { res.status(400).json({ ok: false, error: 'Missing seeds' }); return; }
      const r = await runApify(seeds);
      const rows = r.items.filter(x => !x.is_seed).map(x => ({
        keyword: x.keyword, seed: x.seed_keyword, competing: x.competing_listings_count, level: x.competition_level,
        min: x.min_price, max: x.max_price, avg: x.avg_price, median: x.median_price
      })).filter(x => x.keyword);
      // #3: balance demand/competition. Dedupe, drop the impossible (huge competition), push the near-dead (~0 listings)
      // to the bottom, and show medium-low competition first (every keyword is a real Etsy autosuggest search).
      const NEAR_DEAD = 10, IMPOSSIBLE = 100000;
      const seen = new Set(); const kept = [];
      rows.forEach(x => { const k = normT(x.keyword); if (!seen.has(k)) { seen.add(k); kept.push(x); } });
      const uniq = kept
        .map(x => ({ x, c: (x.competing == null ? Infinity : Number(x.competing)) }))
        .filter(o => o.c <= IMPOSSIBLE)
        .sort((a, b) => { const ad = a.c < NEAR_DEAD, bd = b.c < NEAR_DEAD; if (ad !== bd) return ad ? 1 : -1; return a.c - b.c; })
        .map(o => o.x);
      res.status(200).json({ ok: true, seeds, took_s: r.took_s, count: uniq.length, keywords: uniq });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (q.action === 'tab1-generate' && req.method === 'POST') {
    try {
      const b = req.body || {}; const p = b.product || {};
      const kws = (b.keywords || []).slice(0, 60).map(k => k.keyword + ' (' + (k.level || '?') + ', ' + (k.competing == null ? '?' : k.competing) + ' listings)').join('\n');
      const optLines = Object.keys(b.options || {}).map(n => '- "' + n + '": ' + (b.options[n] || []).slice(0, 80).join(' | ')).join('\n');
      const openVerb = pickRandom(OPEN_VERBS);           // forced opener (varies per product across isolated calls)
      const focusAngles = pickDistinct(FOCUS_ANGLES, 2); // build the advice around these so listings don't read the same
      const prompt = [
        'You write Etsy listings for About Wall Art (UK brand). The product is a SET OF 3 wall art pieces, made to order, printed in the UK, available unframed / framed (black, white, oak) / wrapped canvas, sizes A4-A2 and 20x30 in. Look at the product images to understand the real subject, colours, style and orientation.',
        '',
        'PRODUCT (from our store):',
        'Title: ' + p.title, 'Tags: ' + (p.tags || []).join(', '), 'Room: ' + (b.rooms || []).join(', '), 'Style(s): ' + (b.styles || []).join(', '), 'Colours: ' + (p.colours || []).join(', '),
        'Store description (for facts only, do not copy): ' + (p.description || '').slice(0, 1200),
        '', 'ETSY KEYWORD DATA (real Etsy searches with competition; prefer relevant, lower-competition ones):', kws,
        ...((b.siblingTitles || []).length ? [
          '', 'FAMILY — AVOID SEO CANNIBALISATION: this product is part of a family that shares the same keywords. These titles are ALREADY used by its siblings:',
          (b.siblingTitles || []).map(t => '- ' + t).join('\n'),
          'Your title MUST be clearly DIFFERENT from every title above — lead with a different keyword and use different phrasing, not a reordering of the same words. They must not compete with each other in search.'
        ] : []),
        '', 'RULES — follow exactly:',
        '1) TITLE: max 140 chars, Title Case (NOT all caps), long but readable, keyword-rich WITHOUT stuffing/repeating. Lead with the keyword that best says WHAT it is. Include the room. Do NOT put any colour words in the title (no "white", "black", "blue"...) — colours go ONLY in the attributes/SEO, never in the title. Position of keywords does not affect ranking.',
        '2) TAGS: EXACTLY 13, all UNIQUE, lowercase, never the same combination twice, no spelling mistakes. Each tag = a descriptor (use the keyword data) + a wall-art synonym as the noun. Spread these 10 synonyms across DIFFERENT tags (each used about once): wall art, art prints, wall decor, wall hangings, wall prints, canvas prints, wall pictures, wall posters, canvas art, art decor. Cover the 7 tag types across the 13: 1 descriptive (what it is) 2 materials/technique 3 for whom (gifts) 4 occasion 5 solution (empty wall...) 6 style (era/palette + what it is) 7 size. Do not repeat exact category/attribute names as a tag (a multi-word tag that contains them is fine). CRITICAL LENGTH RULE: every tag MUST be 20 characters or fewer INCLUDING SPACES. Count the characters of each tag before returning it. If a tag would be over 20, REWRITE it with a shorter synonym (e.g. "scandinavian wall art" = 21 -> "scandi wall art"; "nordic landscape decor" = 22 -> "nordic landscape"); NEVER return a tag over 20 and NEVER cut a word mid-way.',
        '3) DESCRIPTION: write ONLY the TOP part (about 120-170 words, 2 short paragraphs); a fixed block with materials/shipping/care/personalisation is added automatically BELOW, so do NOT write any of that. THIS IS ADVICE, NOT A DESCRIPTION OF THE ART — the buyer can already SEE the art in the photos, so NEVER describe what is visible (the scene, subject, colours, composition, figures, textures). Instead tell them what the photos do NOT show. FOCUS this listing mainly on these angles, and do NOT try to cover everything (a clear, narrow angle is what makes each listing read differently from the others):\n' + focusAngles.map(a => '- ' + a).join('\n') + '\nOPENING: begin the FIRST sentence with the verb "' + openVerb + '" (use it as the first word, or right after a 1-2 word lead-in), with the keyword woven in NATURALLY; NEVER a keyword fragment followed by a dash. VOICE: a very warm, friendly UK interior-decor adviser talking to ONE person, first person (I/we), conversational, human, practical; short, varied, natural sentences; UK spelling. If it reads like AI or a spec sheet, it has FAILED. BANNED, never use: "a sense of", "evokes", "a feeling of", "drama", "dramatic", "a cohesive story", "tells a story", "rendered in", "punctuated by", "journey", "whisper", "dance", "symphony", "statement piece", "gracing", "adorn", "elevate", or stacks of flowery adjectives. Plain text, no headings.',
        '4) WORDING: "art prints" is OK in title/description/tags. The word "poster"/"posters" ONLY in tags (never title/description). NEVER write "digital print" or "digital download". Say "perspex", never "acrylic". Never say "hand-painted".',
        '5) ATTRIBUTES: choose from the EXACT option lists below (copy the option text exactly). Only include a property if it clearly applies. Several values allowed only where the property is multi-valued (Occasion, Holiday, Room, Subject may take more than one if truly relevant, else one).',
        optLines,
        '', 'Return ONLY JSON: {"title":"...","tags":["13 tags"],"description":"...","attributes":{"<property name>":["<option>", ...]},"notes":"one short line about anything uncertain"}'
      ].join('\n');
      const content = [];
      (p.images || []).slice(0, 3).forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
      content.push({ type: 'text', text: prompt });
      const out = await claudeJSON(content, 4000);
      await ensureTagsUnder20(out); // #4: rewrite (not cut) any tag over 20 chars BEFORE the UI shows it
      res.status(200).json({ ok: true, listing: out });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // Seed suggestions (before Apify): Claude proposes search seed phrases from the product + images.
  if (q.action === 'tab1-suggest-seeds' && req.method === 'POST') {
    try {
      const b = req.body || {}; const p = b.product || {};
      const prompt = [
        'You suggest Etsy SEARCH SEED phrases for About Wall Art (UK). The product is a SET OF 3 wall art pieces. Look at the images to understand the real subject, style and mood.',
        '',
        'PRODUCT:',
        'Title: ' + (p.title || ''), 'Style(s): ' + (b.styles || []).join(', '), 'Room: ' + (b.rooms || []).join(', '), 'Colours: ' + (p.colours || []).join(', '),
        '',
        'Suggest 12-15 SHORT seed phrases a shopper would TYPE into Etsy search to find art like this. Rules: 2-4 words each, lowercase, each MUST end with a wall-art noun ("wall art", "wall decor", "art prints" or "wall prints"). Base them on the subject / style / mood — NOT the room and NOT colours (those are handled separately in SEO). No duplicates, no punctuation.',
        '', 'Return ONLY JSON: {"seeds":["phrase", ...]}'
      ].join('\n');
      const content = [];
      (p.images || []).slice(0, 3).forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
      content.push({ type: 'text', text: prompt });
      const out = await claudeJSON(content, 800);
      const seeds = (out.seeds || []).map(s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
      res.status(200).json({ ok: true, seeds: seeds });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // #14: Sent Items list (GitHub-backed) — read + append. Delete lives in the Etsy actions (needs the Etsy call).
  if (q.action === 'tab1-sent-list') {
    try { const s = await readSent(); res.status(200).json({ ok: true, items: s.items }); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'tab1-sent-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.listing_id) { res.status(400).json({ ok: false, error: 'Missing listing_id' }); return; }
      const s = await readSent();
      const item = { listing_id: String(b.listing_id), sku: String(b.sku || ''), title: String(b.title || ''), section: String(b.section || ''), image: String(b.image || ''), ts: Date.now() };
      const items = [item].concat(s.items.filter(x => String(x.listing_id) !== item.listing_id)); // newest first, no dup
      await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: sent ' + item.sku + ' (' + item.listing_id + ')');
      // also add this new draft to the ONE Etsy listings registry (SKU -> listings), so the video tab finds it
      try {
        const rg = await readReg();
        const key = baseSkuEtsy(item.sku);
        if (key) {
          const arr = Array.isArray(rg.map[key]) ? rg.map[key] : [];
          if (!arr.some(x => String(x.listing_id) === item.listing_id)) arr.push({ listing_id: item.listing_id, title: item.title, state: 'draft', image: item.image || '' });
          rg.map[key] = arr;
          await ghPut(REG_PATH, JSON.stringify(rg.map, null, 2), rg.sha, 'AWA ETSY: registry + ' + key + ' (' + item.listing_id + ')');
        }
      } catch (e) { /* best-effort; a Refresh can rebuild it */ }
      res.status(200).json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // ---- Video tab (reads; no Etsy auth needed) ----
  if (q.action === 'etsy-reg-get') {
    try { const r = await readReg(); res.status(200).json({ ok: true, registry: r.map }); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'etsy-video-log-get') {
    try { const r = await readVideoLog(); res.status(200).json({ ok: true, log: r.items }); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  // ---- Replace images: common set (GitHub only, no Etsy auth needed) ----
  if (q.action === 'ri-common-get') {
    try { const c = await readCommon(); res.status(200).json({ ok: true, items: withCommonUrls(c.items) }); }
    catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'ri-common-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      const raw = String(b.dataBase64 || '').replace(/^data:[^,]+,/, ''); // accept a bare base64 or a data: URL
      if (!raw) { res.status(400).json({ ok: false, error: 'No image data' }); return; }
      const safe = String(b.fileName || 'image').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'image';
      const stored = Date.now() + '-' + safe;
      const path = COMMON_DIR + '/' + stored;
      await ghPut(path, Buffer.from(raw, 'base64'), null, 'etsy common image: ' + stored);
      const c = await readCommon();
      c.items.push({ fileName: String(b.fileName || safe), path: path, ts: Date.now() });
      await ghPut(COMMON_PATH, JSON.stringify({ items: c.items }, null, 2), c.sha, 'etsy common set + ' + stored);
      res.status(200).json({ ok: true, items: withCommonUrls(c.items) });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'ri-common-delete' && req.method === 'POST') {
    try {
      const b = req.body || {};
      const c = await readCommon();
      const items = c.items.filter(it => it.path !== b.path);
      await ghPut(COMMON_PATH, JSON.stringify({ items }, null, 2), c.sha, 'etsy common set - delete');
      res.status(200).json({ ok: true, items: withCommonUrls(items) });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }
  if (q.action === 'ri-common-reorder' && req.method === 'POST') {
    try {
      const b = req.body || {};
      const order = Array.isArray(b.order) ? b.order : [];
      const c = await readCommon();
      const byPath = {}; c.items.forEach(it => { byPath[it.path] = it; });
      const items = order.map(p => byPath[p]).filter(Boolean);
      c.items.forEach(it => { if (order.indexOf(it.path) < 0) items.push(it); }); // safety: keep any not listed
      await ghPut(COMMON_PATH, JSON.stringify({ items }, null, 2), c.sha, 'etsy common set reorder');
      res.status(200).json({ ok: true, items: withCommonUrls(items) });
    } catch (e) { res.status(500).json({ ok: false, error: String(e && e.message || e) }); }
    return;
  }

  if (!at && !rt) { res.status(401).json({ ok: false, error: 'Not connected. Click "Connect Etsy" first.' }); return; }

  // call Etsy API with one auto-refresh on 401
  let refreshedCookie = null;
  async function call(path, opts) {
    const doFetch = (tok) => fetch(API + path, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'x-api-key': APIKEY, 'Authorization': 'Bearer ' + tok }, (opts && opts.headers) || {}),
      body: opts && opts.body
    });
    let r = null;
    if (!at && rt) r = { status: 401 };
    else r = await doFetch(at);
    if ((r.status === 401 || r.status === 403) && rt) {
      const ref = await tokenExchange({ grant_type: 'refresh_token', client_id: KEY, refresh_token: rt });
      if (ref.ok && ref.json.access_token) {
        at = ref.json.access_token;
        refreshedCookie = [cookie('etsy_at', at, ref.json.expires_in || 3600), cookie('etsy_rt', ref.json.refresh_token || rt, 60 * 60 * 24 * 80)];
        r = await doFetch(at);
      }
    }
    if (typeof r.json !== 'function') return { status: r.status, json: { error: 'Etsy session expired. Click Reconnect.' } };
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  }
  function finish(status, payload) {
    if (refreshedCookie) res.setHeader('Set-Cookie', refreshedCookie);
    res.status(status).json(payload);
  }

  try {
    // ----- DIAGNOSE: reads that answer the missing info -----
    if (!q.action || q.action === 'diagnose') {
      const me = await call('/users/me');
      const shopId = me.json && me.json.shop_id;
      const out = { ok: true, me: me.json };
      if (!shopId) { finish(200, Object.assign(out, { note: 'users/me no devolvió shop_id' })); return; }

      const shop = await call('/shops/' + shopId);
      out.shop = { shop_id: shopId, shop_name: shop.json && shop.json.shop_name };

      // one sample active listing WITH its inventory
      const lst = await call('/shops/' + shopId + '/listings/active?limit=1&includes=Inventory');
      const sample = lst.json && lst.json.results && lst.json.results[0];
      if (sample) {
        out.sampleListing = {
          listing_id: sample.listing_id,
          title: sample.title,
          taxonomy_id: sample.taxonomy_id,
          price: sample.price,
          priceFieldsSeen: Object.keys(sample).filter(k => /price/i.test(k))
        };
        // inventory via its own endpoint → variation properties + per-offering prices
        const inv = await call('/listings/' + sample.listing_id + '/inventory');
        const prods = (inv.json && inv.json.products) || [];
        out.inventory = {
          status: inv.status,
          product_count: prods.length,
          variation_properties: prods[0] ? (prods[0].property_values || []).map(p => ({ property_id: p.property_id, name: p.property_name, scale: p.scale_name })) : null,
          sample_products: prods.slice(0, 4).map(p => ({
            sku: p.sku,
            variation: (p.property_values || []).map(v => v.property_name + ': ' + (v.values || []).join('/')),
            offerings: (p.offerings || []).map(o => ({ price: o.price, quantity: o.quantity }))
          }))
        };
        // taxonomy properties (Style / Occasion options) for this listing's category
        if (sample.taxonomy_id) {
          const props = await call('/seller-taxonomy/nodes/' + sample.taxonomy_id + '/properties');
          const allProps = (props.json && props.json.results ? props.json.results : []);
          out.supportsVariations = allProps.filter(p => p.supports_variations).map(p => p.display_name || p.name);
          out.taxonomyProperties = allProps.map(p => ({
            name: p.name,
            display_name: p.display_name,
            is_required: p.is_required,
            supports_variations: p.supports_variations,
            possible_values: (p.possible_values || []).map(v => v.name).slice(0, 60)
          }));
        }
      } else {
        out.sampleListing = 'No active listing found (status ' + lst.status + ')';
      }
      finish(200, out);
      return;
    }

    // ----- raw listing read (for deeper look at regional price) -----
    if (q.action === 'listing' && q.listing_id) {
      const l = await call('/listings/' + q.listing_id + '?includes=Inventory');
      finish(200, { ok: true, listing: l.json });
      return;
    }

    // ----- taxonomy properties by id -----
    if (q.action === 'taxonomy' && q.taxonomy_id) {
      const props = await call('/seller-taxonomy/nodes/' + q.taxonomy_id + '/properties');
      finish(200, { ok: true, properties: props.json });
      return;
    }

    // ================= TAB 1 — ETSY ACTIONS =================
    // sections + taxonomy 1029 properties (ids + option lists) for the UI dropdowns
    if (q.action === 'tab1-meta') {
      const sec = await call('/shops/' + SHOP_ID + '/sections');
      const props = await call('/seller-taxonomy/nodes/' + TAXONOMY + '/properties');
      const list = (props.json && props.json.results) || [];
      finish(200, {
        ok: sec.status < 300 && props.status < 300,
        sections: ((sec.json && sec.json.results) || []).map(s => ({ id: s.shop_section_id, title: s.title })),
        properties: list.map(p => ({
          id: p.property_id, name: p.name, display: p.display_name, multi: !!p.is_multivalued, required: !!p.is_required,
          values: (p.possible_values || []).map(v => ({ id: v.value_id, name: v.name }))
        })),
        status: { sections: sec.status, props: props.status }
      });
      return;
    }

    // create DRAFT + inventory (Frame 513 / Size 514, price per combo) + attributes. Images go one-by-one via tab1-image.
    if (q.action === 'tab1-publish' && req.method === 'POST') {
      const b = req.body || {}; const steps = [];
      const title = String(b.title || '').trim();
      // FIX 2: force every tag to <=20 chars (never reject the publish) + drop empties/duplicates, max 13.
      const tags = [];
      for (const raw of (b.tags || [])) { const c = clampTag(raw); if (c && !tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c); if (tags.length >= 13) break; }
      const variants = (b.variants || []).filter(v => v.frame && v.size && v.price > 0);
      if (!title || title.length > 140) { finish(400, { ok: false, error: 'Title empty or over 140 characters' }); return; }
      if (!variants.length) { finish(400, { ok: false, error: 'No variants with a price' }); return; }
      const minPrice = Math.min.apply(null, variants.map(v => Number(v.price)));
      // #5: AI writes the TOP of the description; append the fixed footer (section name/link + related listings) under it.
      const fixedFooter = await buildFixedDescription(call, b.section_id, b.section_title, null);
      const description = (String(b.description || '').trim() + '\n\n' + fixedFooter).trim();
      const form = new URLSearchParams({
        quantity: '25', title, description, price: minPrice.toFixed(2),
        who_made: 'i_did', when_made: 'made_to_order', taxonomy_id: TAXONOMY, type: 'physical',
        shipping_profile_id: SHIPPING, return_policy_id: RETURNS, readiness_state_id: READINESS,
        should_auto_renew: 'false', is_supply: 'false', is_personalizable: 'true' // #8: personalisation ON
      });
      if (tags.length) form.set('tags', tags.join(','));
      // FIX 1: sanitise materials to letters/numbers/spaces only (a hyphen = Etsy "invalid characters"), unique, max 13.
      const mats = [...new Set((b.materials || []).map(sanitizeMaterial).filter(Boolean))].slice(0, 13);
      if (mats.length) form.set('materials', mats.join(','));
      if (b.section_id) form.set('shop_section_id', String(b.section_id));
      const cr = await call('/shops/' + SHOP_ID + '/listings', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const lid = cr.json && cr.json.listing_id;
      steps.push({ step: 'create draft', status: cr.status, listing_id: lid, error: cr.status >= 300 ? cr.json : undefined });
      if (!lid) { finish(200, { ok: false, steps, error: 'Couldn\'t create the draft' }); return; }

      // FIX 3: Etsy demands the COMPLETE matrix of every Frame x Size value in use.
      // Build the full cartesian: present combos enabled with their price; missing combos disabled (min price placeholder).
      const frames = [...new Set(variants.map(v => String(v.frame)))];
      const sizes = [...new Set(variants.map(v => String(v.size)))];
      const priceOf = {};
      variants.forEach(v => { priceOf[String(v.frame) + '||' + String(v.size)] = Number(v.price); });
      const products = [];
      frames.forEach(fr => sizes.forEach(sz => {
        const has = Object.prototype.hasOwnProperty.call(priceOf, fr + '||' + sz);
        products.push({
          sku: String(b.sku || ''),
          property_values: [
            { property_id: 513, property_name: 'Frame', value_ids: [], values: [fr], scale_id: null },
            { property_id: 514, property_name: 'Size', value_ids: [], values: [sz], scale_id: null }
          ],
          offerings: [{ price: has ? priceOf[fr + '||' + sz] : minPrice, quantity: 25, is_enabled: has, readiness_state_id: Number(READINESS) }]
        });
      }));
      const invBody = { products, price_on_property: [513, 514], quantity_on_property: [], sku_on_property: [] };
      const inv = await call('/listings/' + lid + '/inventory', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invBody) });
      steps.push({ step: 'variations + prices', status: inv.status, count: products.length, enabled: variants.length, error: inv.status >= 300 ? inv.json : undefined });

      const attrs = Array.isArray(b.attributes) ? b.attributes : [];
      for (const a of attrs) {
        // Etsy requires BOTH value_ids AND values. Clean the display text (e.g. "5:7 (ISO ratio)" -> "5:7") so the
        // value isn't rejected as "malformed", but keep value_ids 1:1 with values.
        const ids = (a.value_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!a.property_id || !ids.length) continue;
        const vals = (a.values || []).map(v => String(v).replace(/\s*\([^)]*\)\s*$/, '').trim());
        const f = new URLSearchParams({ value_ids: ids.join(','), values: vals.join(',') });
        const pr = await call('/shops/' + SHOP_ID + '/listings/' + lid + '/properties/' + a.property_id, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        steps.push({ step: 'attribute ' + (a.name || a.property_id), status: pr.status, error: pr.status >= 300 ? pr.json : undefined });
      }
      // #10: personalisation text box with a +£5 add-on (optional) — buyer asks for a custom size or a quote.
      const persoBody = { personalization_questions: [{
        question_text: 'Personalise your item',
        instructions: 'Tell us a custom size or a quote to add. Leave blank when no customisation is required',
        question_type: 'text_input', required: false, add_on_price: 5.00, max_allowed_characters: 256
      }] };
      const perso = await call('/shops/' + SHOP_ID + '/listings/' + lid + '/personalization?supports_multiple_personalization_questions=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persoBody) });
      steps.push({ step: 'personalisation', status: perso.status, error: perso.status >= 300 ? perso.json : undefined });
      const failed = steps.filter(s => s.status >= 300);
      finish(200, { ok: !failed.length, listing_id: lid, steps, failed: failed.length });
      return;
    }

    // upload ONE image (from Shopify CDN) to the draft
    if (q.action === 'tab1-image' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id || !b.url) { finish(400, { ok: false, error: 'Missing listing_id or url' }); return; }
      if (!/^https:\/\/cdn\.shopify\.com\//.test(String(b.url))) { finish(400, { ok: false, error: 'The image must come from cdn.shopify.com' }); return; }
      const ir = await fetch(b.url);
      if (!ir.ok) { finish(200, { ok: false, error: 'No pude bajar la imagen de Shopify (' + ir.status + ')' }); return; }
      const buf = Buffer.from(await ir.arrayBuffer());
      const fd = new FormData();
      fd.append('image', new Blob([buf], { type: ir.headers.get('content-type') || 'image/jpeg' }), 'image-' + (b.rank || 1) + '.jpg');
      fd.append('rank', String(b.rank || 1));
      const up = await call('/shops/' + SHOP_ID + '/listings/' + b.listing_id + '/images', { method: 'POST', body: fd });
      finish(200, { ok: up.status < 300, status: up.status, error: up.status >= 300 ? up.json : undefined });
      return;
    }

    // ---- Video tab: rebuild the registry (SKU -> [{listing_id,title,state,image}]) ----
    // Pages through ALL listings (active + draft) using the total count, grabs each listing's featured image,
    // and folds in the tool's own "Sent items" (drafts Etsy may not have a SKU for).
    if (q.action === 'etsy-reg-refresh') {
      const map = {};
      const addListing = (sku, listing) => {
        const k = baseSkuEtsy(sku); if (!k) return;
        const arr = map[k] || (map[k] = []);
        if (!arr.some(x => String(x.listing_id) === String(listing.listing_id))) arr.push(listing);
      };
      let scanned = 0;
      for (const state of ['active', 'draft']) {
        let offset = 0, total = Infinity;
        for (let page = 0; page < 300 && offset < total; page++) {   // count-driven: pages until all are read
          const lr = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset + '&includes=Inventory,Images');
          if (lr.status >= 300) break;
          const j = lr.json || {};
          total = (typeof j.count === 'number') ? j.count : 0;
          const results = j.results || [];
          if (!results.length) break;
          results.forEach(l => {
            scanned++;
            const im = (l.images && l.images[0]) || {};
            const image = im.url_570xN || im.url_fullxfull || im.url_300x300 || '';
            const listing = { listing_id: String(l.listing_id), title: l.title || '', state, image };
            const skus = [].concat(l.skus || [], ((l.inventory && l.inventory.products) || []).map(p => p.sku));
            Array.from(new Set(skus.map(baseSkuEtsy).filter(Boolean))).forEach(k => addListing(k, listing));
          });
          offset += 100;
        }
      }
      try {
        const sent = await readSent();
        (sent.items || []).forEach(it => { if (it.listing_id) addListing(it.sku, { listing_id: String(it.listing_id), title: it.title || '', state: 'draft', image: it.image || '' }); });
      } catch (e) { /* best-effort */ }
      const rg = await readReg();
      await ghPut(REG_PATH, JSON.stringify(map, null, 2), rg.sha, 'AWA ETSY: registry refresh (' + Object.keys(map).length + ' SKUs, scanned ' + scanned + ')');
      finish(200, { ok: true, skus: Object.keys(map).length, listings: Object.values(map).reduce((n, a) => n + a.length, 0), scanned });
      return;
    }

    // ---- Video tab: send ONE video to ONE Etsy listing (replace rule applied) ----
    if (q.action === 'etsy-video-send' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.fileId || !b.listing_id) { finish(400, { ok: false, error: 'Missing fileId or listing_id' }); return; }
      const listingId = String(b.listing_id);
      // existing videos on the listing (Etsy allows up to 2)
      const lr = await call('/listings/' + listingId + '?includes=Videos');
      const existing = (lr.json && lr.json.videos) || [];
      // if already at 2: make room. Remove the one THIS tool pushed if present, else remove any.
      if (existing.length >= 2) {
        const vlog = await readVideoLog();
        const ours = vlog.items.find(e => String(e.listing_id) === listingId && existing.some(v => String(v.video_id) === String(e.video_id)));
        const delId = ours ? ours.video_id : existing[0].video_id;
        await call('/shops/' + SHOP_ID + '/listings/' + listingId + '/videos/' + delId, { method: 'DELETE' });
      }
      // download from Drive + upload to Etsy (multipart: video + name)
      const buf = await driveDownloadEtsy(b.fileId);
      const fd = new FormData();
      fd.append('video', new Blob([buf], { type: 'video/mp4' }), b.fileName || 'video.mp4');
      fd.append('name', String(b.fileName || 'video.mp4'));
      const up = await call('/shops/' + SHOP_ID + '/listings/' + listingId + '/videos', { method: 'POST', body: fd });
      if (up.status >= 300) { finish(200, { ok: false, error: 'Etsy upload failed (' + up.status + '): ' + JSON.stringify(up.json).slice(0, 300) }); return; }
      const videoId = up.json && (up.json.video_id || (up.json.results && up.json.results[0] && up.json.results[0].video_id));
      try {
        const vlog = await readVideoLog();
        const items = vlog.items.filter(e => String(e.listing_id) !== listingId);
        items.push({ listing_id: listingId, video_id: videoId != null ? String(videoId) : null, sku: String(b.sku || ''), fileId: b.fileId, fileName: b.fileName || '', ts: Date.now() });
        await ghPut(VIDEO_LOG_PATH, JSON.stringify(items, null, 2), vlog.sha, 'AWA ETSY: video -> listing ' + listingId);
      } catch (e) { /* video is on the listing; only the log write failed */ }
      finish(200, { ok: true, video_id: videoId != null ? String(videoId) : null });
      return;
    }

    // ---- Video tab: remove the tool's video from ONE listing (so you can resend) ----
    if (q.action === 'etsy-video-undo' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id || !b.video_id) { finish(400, { ok: false, error: 'Missing listing_id or video_id' }); return; }
      const del = await call('/shops/' + SHOP_ID + '/listings/' + String(b.listing_id) + '/videos/' + String(b.video_id), { method: 'DELETE' });
      if (del.status >= 300) { finish(200, { ok: false, error: 'Etsy delete failed (' + del.status + ')' }); return; }
      try {
        const vlog = await readVideoLog();
        const items = vlog.items.filter(e => !(String(e.listing_id) === String(b.listing_id) && String(e.video_id) === String(b.video_id)));
        await ghPut(VIDEO_LOG_PATH, JSON.stringify(items, null, 2), vlog.sha, 'AWA ETSY: video undo listing ' + b.listing_id);
      } catch (e) { /* best-effort */ }
      finish(200, { ok: true });
      return;
    }

    // #14: delete a sent draft — removes it from Etsy AND from the GitHub list.
    if (q.action === 'tab1-sent-delete' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id) { finish(400, { ok: false, error: 'Missing listing_id' }); return; }
      const del = await call('/listings/' + b.listing_id, { method: 'DELETE' });
      const ok = del.status < 300 || del.status === 404;
      const s = await readSent();
      let items = s.items;
      // only remove from the list when Etsy actually deleted it — a failed delete must NOT lose the item.
      if (ok) { items = s.items.filter(x => String(x.listing_id) !== String(b.listing_id)); try { await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: delete ' + b.listing_id); } catch (e) {} }
      finish(200, { ok, status: del.status, items, error: ok ? undefined : del.json });
      return;
    }

    // ---- Replace images (Tanda 2): Etsy sections, listings by section, listing detail (+ Shopify match), apply ----
    if (q.action === 'ri-sections') {
      const sec = await call('/shops/' + SHOP_ID + '/sections');
      const sections = ((sec.json && sec.json.results) || []).map(s => ({ id: s.shop_section_id, title: s.title, count: s.active_listing_count }));
      // how many listings are done per section (from the done store's section map) — for the dropdown's x/total progress
      let doneBySection = {};
      try { const dn = await readDone(); Object.keys(dn.sections || {}).forEach(lid => { const sid = String(dn.sections[lid]); doneBySection[sid] = (doneBySection[sid] || 0) + 1; }); } catch (e) {}
      sections.forEach(s => { s.done = doneBySection[String(s.id)] || 0; });
      finish(200, { ok: true, sections });
      return;
    }
    if (q.action === 'ri-listings') {
      const sectionId = String(q.section || '');
      const rows = []; let offset = 0;
      for (let page = 0; page < 40; page++) {
        const lr = await call('/shops/' + SHOP_ID + '/listings?state=active&limit=100&offset=' + offset + '&includes=Inventory,Images');
        const results = (lr.json && lr.json.results) || [];
        results.forEach(l => {
          if (sectionId && String(l.shop_section_id) !== sectionId) return;
          const im = (l.images && l.images[0]) || {};
          const sku = baseSkuEtsy(([].concat(l.skus || [], ((l.inventory && l.inventory.products) || []).map(p => p.sku))).filter(Boolean)[0] || '');
          rows.push({ listing_id: l.listing_id, title: l.title, sku: sku, image: im.url_570xN || im.url_fullxfull || im.url_300x300 || '' });
        });
        if (results.length < 100) break;
        offset += 100;
      }
      let skuSet = new Set(), dn = { ids: [], sections: {}, sha: null };
      try { skuSet = await allShopifySkus(); } catch (e) {}
      try { dn = await readDone(); } catch (e) {}
      const doneIds = new Set(dn.ids.map(String));
      rows.forEach(r => { r.matched = !!r.sku && skuSet.has(String(r.sku).trim().toLowerCase()); r.done = doneIds.has(String(r.listing_id)); });
      // backfill: record the section for any done listing that doesn't have it yet (so the dropdown's x/total is right
      // even for listings processed before sections were tracked)
      try {
        if (sectionId) { const sections = dn.sections || {}; let changed = false; rows.forEach(r => { if (r.done && sections[String(r.listing_id)] !== sectionId) { sections[String(r.listing_id)] = sectionId; changed = true; } }); if (changed) await ghPut(RI_DONE_PATH, JSON.stringify({ ids: dn.ids, sections }, null, 2), dn.sha, 'ri backfill sections'); }
      } catch (e) {}
      finish(200, { ok: true, listings: rows, total: rows.length, done: rows.filter(r => r.done).length });
      return;
    }
    if (q.action === 'ri-detail') {
      const id = q.listing_id;
      if (!id) { finish(400, { ok: false, error: 'Missing listing_id' }); return; }
      const imgs = await call('/listings/' + id + '/images');
      const etsyImages = ((imgs.json && imgs.json.results) || []).map(im => ({ id: im.listing_image_id, url: im.url_fullxfull, rank: im.rank }));
      let etsyVideo = null;
      try { const vr = await call('/listings/' + id + '/videos'); const vids = (vr.json && (vr.json.results || vr.json.videos)) || []; if (vids[0]) etsyVideo = { video_id: vids[0].video_id, url: vids[0].video_url || '' }; } catch (e) {}
      let sku = '';
      try { const l = await call('/listings/' + id + '?includes=Inventory'); const lj = l.json || {}; sku = baseSkuEtsy(([].concat(lj.skus || [], ((lj.inventory && lj.inventory.products) || []).map(p => p.sku))).filter(Boolean)[0] || ''); } catch (e) {}
      let shopify = { noMatch: true, similar: [] };
      if (sku) { try { shopify = await loadShopifyMedia(sku); } catch (e) { shopify = { noMatch: true, similar: [], error: String(e && e.message || e) }; } }
      finish(200, { ok: true, listing_id: id, sku, etsyImages, etsyVideo, shopify });
      return;
    }
    if (q.action === 'ri-shopify') {
      try { const m = await loadShopifyMedia(String(q.sku || '')); finish(200, { ok: true, shopify: m }); }
      catch (e) { finish(500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }
    if (q.action === 'ri-apply' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id) { finish(400, { ok: false, error: 'Missing listing_id' }); return; }
      const entries = Array.isArray(b.images) ? b.images : [];
      if (!entries.length) { finish(400, { ok: false, error: 'No images to apply' }); return; }
      const target = String(b.target || 'etsy');   // 'etsy' or 'both' (both = also push the same set to Shopify)
      // If pushing to Shopify too, resolve the matched product up front — it gives the id to push to AND its current
      // images, which we back up alongside the Etsy ones.
      let shopProd = null;
      if (target === 'both') { try { shopProd = await loadShopifyMedia(b.sku || ''); } catch (e) { shopProd = { error: String(e && e.message || e) }; } }
      // Back up the listing's CURRENT images + video FIRST — abort if we can't save it (same rule as the other tabs).
      try {
        const cur = await call('/listings/' + b.listing_id + '/images');
        const oldImages = ((cur.json && cur.json.results) || []).map(im => im.url_fullxfull);
        let oldVideo = ''; try { const vr = await call('/listings/' + b.listing_id + '/videos'); const vids = (vr.json && (vr.json.results || vr.json.videos)) || []; if (vids[0]) oldVideo = vids[0].video_url || ''; } catch (e) {}
        const oldShopifyImages = (shopProd && shopProd.matched && Array.isArray(shopProd.images)) ? shopProd.images.map(i => i.url) : [];
        const log = await ghGet(RI_UNDO_PATH); const arr = log.content ? (JSON.parse(log.content).items || []) : [];
        arr.unshift({ listing_id: String(b.listing_id), sku: String(b.sku || ''), ts: Date.now(), oldImages, oldVideo, oldShopifyImages });
        await ghPut(RI_UNDO_PATH, JSON.stringify({ items: arr.slice(0, 200) }, null, 2), log.sha, 'ri undo ' + b.listing_id);
      } catch (e) { finish(500, { ok: false, error: 'Backup could not be saved — nothing was changed. ' + String(e && e.message || e) }); return; }
      const r = await riApplyMedia(call, b.listing_id, entries, b.video || null);
      // "Etsy + Shopify": replace the Shopify product's images with the same set, in the same order.
      let shopify = null;
      if (target === 'both') {
        if (shopProd && shopProd.matched && shopProd.id) { try { shopify = await pushImagesToShopify(shopProd.id, entries); } catch (e) { shopify = { error: String(e && e.message || e) }; } }
        else { shopify = { error: 'No matched Shopify product for SKU ' + (b.sku || '') + (shopProd && shopProd.error ? (' — ' + shopProd.error) : '') }; }
      }
      // mark this listing as processed (for the per-section progress counter + the "done" badge), with its section
      try {
        const dn = await readDone(); const ids = dn.ids.map(String); const sections = dn.sections || {}; let changed = false;
        if (ids.indexOf(String(b.listing_id)) < 0) { ids.unshift(String(b.listing_id)); changed = true; }
        if (b.section && sections[String(b.listing_id)] !== String(b.section)) { sections[String(b.listing_id)] = String(b.section); changed = true; }
        if (changed) await ghPut(RI_DONE_PATH, JSON.stringify({ ids, sections }, null, 2), dn.sha, 'ri done ' + b.listing_id);
      } catch (e) {}
      finish(200, { ok: true, result: r, shopify });
      return;
    }
    // Replace images — "Move back to Start here": un-mark a listing as done (remove it from the done list).
    if (q.action === 'ri-done-remove' && req.method === 'POST') {
      const b = req.body || {};
      if (!b.listing_id) { finish(400, { ok: false, error: 'Missing listing_id' }); return; }
      try {
        const dn = await readDone();
        const ids = dn.ids.map(String).filter(x => x !== String(b.listing_id));
        const sections = dn.sections || {}; delete sections[String(b.listing_id)];
        await ghPut(RI_DONE_PATH, JSON.stringify({ ids, sections }, null, 2), dn.sha, 'ri undone ' + b.listing_id);
        finish(200, { ok: true });
      } catch (e) { finish(500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }

    // ---- Compliance photo: bulk-add common image #2 to every active + draft listing (batched, resumable) ----
    // Build the worklist: all active + draft listing_ids, minus the ones already finished in Replace images.
    if (q.action === 'ri-comply-plan' && req.method === 'POST') {
      try {
        const ids = [];
        for (const state of ['active', 'draft']) {
          let offset = 0;
          for (let page = 0; page < 60; page++) {
            const lr = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset);
            const results = (lr.json && lr.json.results) || [];
            results.forEach(l => ids.push(String(l.listing_id)));
            if (results.length < 100) break;
            offset += 100;
          }
        }
        const doneSet = new Set((await readDone()).ids.map(String));   // skip the Replace-images "done" ones (avoid dupes)
        const queue = ids.filter(id => !doneSet.has(id));
        const q0 = await readComplyQueue();
        await ghPut(RI_COMPLY_QUEUE_PATH, JSON.stringify({ ids: queue, builtAt: Date.now() }, null, 2), q0.sha, 'compliance queue (' + queue.length + ')');
        const complied = new Set((await readComplyDone()).ids.map(String));
        const done = queue.filter(id => complied.has(id)).length;
        finish(200, { ok: true, total: queue.length, complied: done, remaining: queue.length - done });
      } catch (e) { finish(500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }
    // Progress without rebuilding the queue (for showing state when the tab opens).
    if (q.action === 'ri-comply-status') {
      try {
        const queue = (await readComplyQueue()).ids.map(String);
        const complied = new Set((await readComplyDone()).ids.map(String));
        const done = queue.filter(id => complied.has(id)).length;
        finish(200, { ok: true, total: queue.length, complied: done, remaining: queue.length - done, hasQueue: queue.length > 0 });
      } catch (e) { finish(500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }
    // Process the next N listings from the queue: add common #2 at the end. If the listing has 20 images, delete the last
    // one first (its URL is backed up to the undo file). Already-complied listings are skipped, so it is safe to resume.
    if (q.action === 'ri-comply-batch' && req.method === 'POST') {
      const b = req.body || {};
      const size = Math.max(1, Math.min(10, parseInt(b.size, 10) || 5));
      try {
        const queue = (await readComplyQueue()).ids.map(String);
        if (!queue.length) { finish(400, { ok: false, error: 'No queue yet — click Plan first.' }); return; }
        const complied = (await readComplyDone()).ids.map(String);
        const compliedSet = new Set(complied);
        const targets = queue.filter(id => !compliedSet.has(id)).slice(0, size);
        if (!targets.length) { finish(200, { ok: true, processed: 0, uploaded: 0, complied: complied.length, total: queue.length, done: true }); return; }
        const img = await complyImageBuf();
        const undo = await ghGet(RI_COMPLY_UNDO_PATH); const undoArr = undo.content ? (JSON.parse(undo.content).items || []) : [];
        let okCount = 0; const errors = [];
        for (const id of targets) {
          try {
            const imr = await call('/listings/' + id + '/images');
            const imgs = ((imr.json && imr.json.results) || []);
            let wasDeleted = false;
            if (imgs.length >= 20) {
              const last = imgs.slice().sort((a, c) => (c.rank || 0) - (a.rank || 0))[0];   // highest rank = last position
              if (last && last.listing_image_id) { undoArr.unshift({ listing_id: id, deletedUrl: last.url_fullxfull || '', ts: Date.now() }); await call('/shops/' + SHOP_ID + '/listings/' + id + '/images/' + last.listing_image_id, { method: 'DELETE' }); wasDeleted = true; }
            }
            const rank = Math.min(20, (imgs.length - (wasDeleted ? 1 : 0)) + 1);   // append at the end
            const fd = new FormData();
            fd.append('image', new Blob([img.buf], { type: img.type }), img.name);
            fd.append('rank', String(rank));
            const r = await call('/shops/' + SHOP_ID + '/listings/' + id + '/images', { method: 'POST', body: fd });
            if (r.status < 300) { okCount++; complied.push(id); } else { errors.push(id + ': etsy ' + r.status); }
          } catch (e) { errors.push(id + ': ' + String(e && e.message || e)); }
        }
        try { const cd2 = await readComplyDone(); await ghPut(RI_COMPLY_DONE_PATH, JSON.stringify({ ids: complied }, null, 2), cd2.sha, 'compliance +' + okCount); } catch (e) {}
        if (undoArr.length) { try { const u2 = await ghGet(RI_COMPLY_UNDO_PATH); await ghPut(RI_COMPLY_UNDO_PATH, JSON.stringify({ items: undoArr.slice(0, 2000) }, null, 2), u2.sha, 'compliance undo'); } catch (e) {} }
        const compliedNow = queue.filter(id => complied.indexOf(id) >= 0).length;
        finish(200, { ok: true, processed: targets.length, uploaded: okCount, complied: compliedNow, total: queue.length, done: compliedNow >= queue.length, errors: errors.slice(0, 5) });
      } catch (e) { finish(500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }

    // ---- Clean listings: list all active+draft listings with their descriptions (for the off-platform cleanup) ----
    if (q.action === 'tab-clean-list') {
      const out = [];
      for (const state of ['active', 'draft']) {
        let offset = 0;
        for (let page = 0; page < 60; page++) {
          const r = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset);
          const results = (r.json && r.json.results) || [];
          results.forEach(l => out.push({ listing_id: l.listing_id, title: l.title, description: l.description || '', state }));
          if (results.length < 100) break;
          offset += 100;
        }
      }
      finish(200, { ok: true, count: out.length, listings: out });
      return;
    }
    // ---- Clean listings: apply new descriptions (backs up each original to GitHub first) ----
    if (q.action === 'tab-clean-apply' && req.method === 'POST') {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items : []; // [{listing_id, original, description}]
      if (!items.length) { finish(400, { ok: false, error: 'No items' }); return; }
      const bk = await ghGet(CLEAN_BACKUP_PATH);
      let backup = {}; try { if (bk.content) backup = JSON.parse(bk.content); } catch (e) {}
      const results = [];
      for (const it of items) {
        try {
          if (it.original != null && !(String(it.listing_id) in backup)) backup[String(it.listing_id)] = String(it.original);
          const f = new URLSearchParams({ description: String(it.description || '') });
          const up = await call('/shops/' + SHOP_ID + '/listings/' + it.listing_id, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
          results.push({ listing_id: it.listing_id, status: up.status, error: up.status >= 300 ? up.json : undefined });
        } catch (e) { results.push({ listing_id: it.listing_id, error: String(e.message || e) }); }
      }
      try { await ghPut(CLEAN_BACKUP_PATH, JSON.stringify(backup, null, 2), bk.sha, 'AWA ETSY: backup descriptions before cleanup (' + items.length + ')'); } catch (e) {}
      const failed = results.filter(r => r.error || (r.status && r.status >= 300));
      finish(200, { ok: !failed.length, updated: results.length - failed.length, failed: failed.length, results });
      return;
    }

    // ================= TAB 2 — APPLY TO DUPLICATE =================
    // List the DRAFT duplicates (base SKU ends in "B") that have a matching original (same base SKU without the "B").
    if (q.action === 'tab2-list') {
      const map = {}; // base SKU -> [{listing_id,title,state,image}]
      const add = (sku, listing) => {
        const k = baseSkuEtsy(sku); if (!k) return;
        const arr = map[k] || (map[k] = []);
        if (!arr.some(x => String(x.listing_id) === String(listing.listing_id))) arr.push(listing);
      };
      for (const state of ['active', 'inactive', 'draft']) {
        let offset = 0, total = Infinity;
        for (let page = 0; page < 300 && offset < total; page++) {
          const lr = await call('/shops/' + SHOP_ID + '/listings?state=' + state + '&limit=100&offset=' + offset + '&includes=Inventory,Images');
          if (lr.status >= 300) break;
          const j = lr.json || {};
          total = (typeof j.count === 'number') ? j.count : 0;
          const results = j.results || [];
          if (!results.length) break;
          results.forEach(l => {
            const im = (l.images && l.images[0]) || {};
            const image = im.url_570xN || im.url_fullxfull || im.url_300x300 || '';
            const skus = [].concat(l.skus || [], ((l.inventory && l.inventory.products) || []).map(p => p.sku));
            Array.from(new Set(skus.map(baseSkuEtsy).filter(Boolean))).forEach(k => add(k, { listing_id: String(l.listing_id), title: l.title || '', state, image }));
          });
          offset += 100;
        }
      }
      const dups = [];
      Object.keys(map).forEach(base => {
        if (!/B$/.test(base) || base.length < 2) return;              // test rule: duplicate SKU = original + "B"
        const origBase = base.slice(0, -1).trim();                    // original = same base without the trailing "B"
        const originals = (map[origBase] || []).map(o => ({ listing_id: o.listing_id, title: o.title, state: o.state }));
        if (!originals.length) return;                                // only show duplicates that have an original to copy
        // a duplicate target can be a DRAFT or an INACTIVE listing (Mae deactivated many after publishing without prices)
        (map[base] || []).filter(d => d.state === 'draft' || d.state === 'inactive').forEach(d => {
          dups.push({ target_listing_id: d.listing_id, dup_sku: base, orig_sku: origBase, title: d.title, image: d.image, state: d.state, originals });
        });
      });
      dups.sort((a, b) => a.dup_sku.localeCompare(b.dup_sku));
      finish(200, { ok: true, count: dups.length, duplicates: dups });
      return;
    }

    // Copy the ORIGINAL's content onto the DUPLICATE (target). NEVER touches inventory / variations / prices.
    if (q.action === 'tab2-apply' && req.method === 'POST') {
      const b = req.body || {};
      const target = String(b.target_listing_id || '').trim();
      const original = String(b.original_listing_id || '').trim();
      const sku = String(b.sku || '').trim();        // original base SKU (used to pull the Shopify photos)
      if (!target || !original) { finish(400, { ok: false, error: 'Missing target or original listing id' }); return; }
      const steps = [];

      // 1) read the ORIGINAL listing (drafts included -> shop-scoped scan, getListing 400s on drafts) + its attributes
      const o = await findShopListingById(call, original);
      if (!o || !o.listing_id) { finish(200, { ok: false, steps, error: 'Could not find the original listing ' + original + ' in your shop (active/draft).' }); return; }
      const op = await call('/shops/' + SHOP_ID + '/listings/' + original + '/properties');
      const ogProps = (op.json && op.json.results) || [];

      // 2) PATCH the duplicate with the original's TEXT fields (not price / variations)
      const tags = [];
      for (const raw of (o.tags || [])) { const c = clampTag(raw); if (c && !tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c); if (tags.length >= 13) break; }
      const mats = [...new Set((o.materials || []).map(sanitizeMaterial).filter(Boolean))].slice(0, 13);
      const form = new URLSearchParams();
      if (o.title) form.set('title', String(o.title).slice(0, 140));
      if (o.description != null) form.set('description', String(o.description));
      if (tags.length) form.set('tags', tags.join(','));
      if (mats.length) form.set('materials', mats.join(','));
      if (o.shop_section_id) form.set('shop_section_id', String(o.shop_section_id));
      const patch = await call('/shops/' + SHOP_ID + '/listings/' + target, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      steps.push({ step: 'text (title/description/tags/materials/section)', status: patch.status, error: patch.status >= 300 ? patch.json : undefined });

      // 3) re-apply the original's attributes (skip Frame=513 / Size=514 — those are variations tied to price)
      for (const p of ogProps) {
        const pid = Number(p.property_id);
        if (!pid || pid === 513 || pid === 514) continue;
        const ids = (p.value_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        // clean the display text the SAME way publish does ("5:7 (ISO ratio)" -> "5:7"), or Etsy rejects it as malformed
        const vals = (p.values || []).map(v => String(v).replace(/\s*\([^)]*\)\s*$/, '').trim());
        if (!ids.length || !vals.length) continue;
        const f = new URLSearchParams({ value_ids: ids.join(','), values: vals.join(',') });
        const pr = await call('/shops/' + SHOP_ID + '/listings/' + target + '/properties/' + pid, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        steps.push({ step: 'attribute ' + (p.property_name || pid), status: pr.status, error: pr.status >= 300 ? pr.json : undefined });
      }

      // 4) VIDEO: the duplicate carries the OLD product's video — remove it (Mae adds the right one with the Video
      //    Uploader). Videos are LISTED at /listings/{id}/videos (NOT shop-scoped — getListing?includes=Videos 400s on a
      //    draft); they are DELETED shop-scoped.
      const vidStep = { step: 'old video', status: 200 };
      try {
        const lv = await call('/listings/' + target + '/videos');
        const vids = (lv.json && (lv.json.results || lv.json.videos)) || [];
        let vdel = 0, vErr = null;
        for (const v of vids) {
          const dv = await call('/shops/' + SHOP_ID + '/listings/' + target + '/videos/' + v.video_id, { method: 'DELETE' });
          if (dv.status < 300) vdel++; else if (!vErr) vErr = { status: dv.status, body: dv.json };
        }
        vidStep.found = vids.length; vidStep.deleted = vdel;
        if (vids.length && vdel === 0) { vidStep.status = 500; vidStep.error = 'could not delete old video: ' + JSON.stringify(vErr).slice(0, 200); }
      } catch (e) { vidStep.status = 500; vidStep.error = String(e && e.message || e); }
      steps.push(vidStep);

      // 5) PHOTOS: copy the images FROM THE ORIGINAL ETSY LISTING (Mae already curated those to the right 20, incl. the
      //    mandatory brand images). NOTHING from Shopify. Etsy refuses to delete a listing's LAST image and caps at 20,
      //    so: delete every old photo except ONE anchor, upload the originals, delete the anchor (deletable now that new
      //    photos exist), then upload any that didn't fit on the first pass.
      let warning = '';
      let firstImg = '';
      const imgStep = { step: 'photos', status: 200 };
      try {
        // the original listing's images (full-size), in display order
        const oi = await call('/listings/' + original + '/images');
        const srcImgs = ((oi.json && oi.json.results) || [])
          .slice()
          .sort((a, b) => (a.rank || 0) - (b.rank || 0))
          .map(im => im.url_fullxfull || im.url_570xN || im.url_300x300)
          .filter(Boolean);
        firstImg = srcImgs[0] || '';
        if (!srcImgs.length) {
          warning = 'The original listing has no images — photos were NOT changed.';
          imgStep.skipped = true; imgStep.note = warning;
        } else {
          // LIST the duplicate's current photos — Etsy v3 lists images at /listings/{id}/images (NOT shop-scoped).
          const cur = await call('/listings/' + target + '/images');
          const oldImgs = (cur.json && cur.json.results) || [];
          const anchor = oldImgs.length ? oldImgs[0] : null;   // keep one image so deleting the others never hits "the last image"
          let del = 0, delErr = null;
          const delImage = async (imgId) => {
            const dr = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images/' + imgId, { method: 'DELETE' });
            if (dr.status < 300) { del++; return true; }
            if (!delErr) delErr = { status: dr.status, body: dr.json };
            return false;
          };
          for (const im of oldImgs.slice(1)) await delImage(im.listing_image_id);   // delete all old photos EXCEPT the anchor
          const toSend = srcImgs.slice(0, 20);
          let up = 0, firstErr = null;
          const uploadOne = async (i) => {
            try {
              const ir = await fetch(toSend[i]);
              if (!ir.ok) { if (!firstErr) firstErr = { where: 'etsy-image-fetch', status: ir.status }; return false; }
              const buf = Buffer.from(await ir.arrayBuffer());
              const fd = new FormData();
              fd.append('image', new Blob([buf], { type: ir.headers.get('content-type') || 'image/jpeg' }), 'image-' + (i + 1) + '.jpg');
              fd.append('rank', String(i + 1));
              const r = await call('/shops/' + SHOP_ID + '/listings/' + target + '/images', { method: 'POST', body: fd });
              if (r.status < 300) return true;
              if (!firstErr) firstErr = { where: 'etsy-upload', status: r.status, body: r.json };
              return false;
            } catch (e) { if (!firstErr) firstErr = { where: 'exception', msg: String(e && e.message || e) }; return false; }
          };
          const pending = [];
          for (let i = 0; i < toSend.length; i++) { if (await uploadOne(i)) up++; else pending.push(i); }   // pass 1 (anchor still there)
          if (anchor && up > 0) await delImage(anchor.listing_image_id);   // now new photos exist -> the anchor is deletable
          const stillPending = [];
          for (const i of pending) { if (await uploadOne(i)) up++; else stillPending.push(i); }   // pass 2: the ones blocked by the 20-cap
          const fail = stillPending.length;
          imgStep.source = srcImgs.length; imgStep.found = oldImgs.length; imgStep.deleted = del; imgStep.uploaded = up; imgStep.failed = fail;
          if (up === 0 && toSend.length) {
            imgStep.status = 500;
            imgStep.error = 'src ' + srcImgs.length + ', found ' + oldImgs.length + ', deleted ' + del + (delErr ? ' (delete err ' + JSON.stringify(delErr).slice(0, 150) + ')' : '') + '; upload: ' + JSON.stringify(firstErr).slice(0, 250);
          } else if (fail) warning = fail + ' of ' + toSend.length + ' photos failed to upload' + (firstErr ? ': ' + JSON.stringify(firstErr).slice(0, 200) : '') + '.';
        }
      } catch (e) { imgStep.status = 500; imgStep.error = String(e && e.message || e); }
      steps.push(imgStep);

      // 5) register in Sent items (+ the video registry), so it shows in the Sent tab
      try {
        const s = await readSent();
        const item = { listing_id: target, sku: String(b.dup_sku || sku), title: o.title || '', section: '', image: firstImg || String(b.image || ''), ts: Date.now() };
        const items = [item].concat(s.items.filter(x => String(x.listing_id) !== item.listing_id));
        await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: tab2 applied ' + item.sku + ' (' + target + ')');
        try {
          const rg = await readReg();
          const key = baseSkuEtsy(item.sku);
          if (key) {
            const arr = Array.isArray(rg.map[key]) ? rg.map[key] : [];
            if (!arr.some(x => String(x.listing_id) === item.listing_id)) arr.push({ listing_id: item.listing_id, title: item.title, state: 'draft', image: item.image || '' });
            rg.map[key] = arr;
            await ghPut(REG_PATH, JSON.stringify(rg.map, null, 2), rg.sha, 'AWA ETSY: registry + ' + key + ' (' + target + ')');
          }
        } catch (e) { /* best-effort */ }
      } catch (e) { /* best-effort — the listing was still updated */ }

      const failed = steps.filter(s => s.status >= 300);
      const summary = 'Photos: ' + (imgStep.uploaded || 0) + ' copied from the original'
        + (imgStep.deleted ? ', ' + imgStep.deleted + ' old removed' : '')
        + (imgStep.failed ? ', ' + imgStep.failed + ' failed' : '')
        + '. Video: ' + (vidStep.found ? (vidStep.deleted + '/' + vidStep.found + ' old removed') : 'none');
      finish(200, { ok: !failed.length, listing_id: target, steps, failed: failed.length, warning: warning || undefined, summary });
      return;
    }

    // ================= TAB 1 — APPLY A NEW PRODUCT TO A TEMPLATE =================
    // List the draft "templates" (SKU contains "template") — they already carry the international pricing.
    if (q.action === 'tab1-templates') {
      const out = [];
      let offset = 0, total = Infinity;
      for (let page = 0; page < 300 && offset < total; page++) {
        const lr = await call('/shops/' + SHOP_ID + '/listings?state=draft&limit=100&offset=' + offset + '&includes=Inventory,Images');
        if (lr.status >= 300) break;
        const j = lr.json || {};
        total = (typeof j.count === 'number') ? j.count : 0;
        const results = j.results || [];
        if (!results.length) break;
        results.forEach(l => {
          const skus = [].concat(l.skus || [], ((l.inventory && l.inventory.products) || []).map(p => p.sku));
          const tpl = skus.find(s => /template/i.test(String(s || '')));
          if (tpl) { const im = (l.images && l.images[0]) || {}; out.push({ listing_id: String(l.listing_id), title: l.title || '', image: im.url_570xN || im.url_fullxfull || im.url_300x300 || '', sku: baseSkuEtsy(tpl) }); }
        });
        offset += 100;
      }
      out.sort((a, b) => a.sku.localeCompare(b.sku));
      finish(200, { ok: true, count: out.length, templates: out });
      return;
    }

    // Apply a NEW product (generated in Tab 1) to a chosen TEMPLATE draft. NEVER touches variations / prices.
    if (q.action === 'tab1-apply-template' && req.method === 'POST') {
      const b = req.body || {};
      const target = String(b.target_listing_id || '').trim();
      if (!target) { finish(400, { ok: false, error: 'Missing target template listing id' }); return; }
      const title = String(b.title || '').trim();
      if (!title || title.length > 140) { finish(400, { ok: false, error: 'Title empty or over 140 characters' }); return; }
      const steps = [];
      // 1) text: title, description (+ fixed footer), tags, materials, section + personalisation ON
      const tags = [];
      for (const raw of (b.tags || [])) { const c = clampTag(raw); if (c && !tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c); if (tags.length >= 13) break; }
      const mats = [...new Set((b.materials || []).map(sanitizeMaterial).filter(Boolean))].slice(0, 13);
      const fixedFooter = await buildFixedDescription(call, b.section_id, b.section_title, target);
      const description = (String(b.description || '').trim() + '\n\n' + fixedFooter).trim();
      const form = new URLSearchParams({ title, description, is_personalizable: 'true' });
      if (tags.length) form.set('tags', tags.join(','));
      if (mats.length) form.set('materials', mats.join(','));
      if (b.section_id) form.set('shop_section_id', String(b.section_id));
      const patch = await call('/shops/' + SHOP_ID + '/listings/' + target, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      steps.push({ step: 'text (title/description/tags/materials/section)', status: patch.status, error: patch.status >= 300 ? patch.json : undefined });
      // 2) attributes (clean value text the same way as publish)
      const attrs = Array.isArray(b.attributes) ? b.attributes : [];
      for (const a of attrs) {
        const ids = (a.value_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!a.property_id || !ids.length) continue;
        const vals = (a.values || []).map(v => String(v).replace(/\s*\([^)]*\)\s*$/, '').trim());
        const f = new URLSearchParams({ value_ids: ids.join(','), values: vals.join(',') });
        const pr = await call('/shops/' + SHOP_ID + '/listings/' + target + '/properties/' + a.property_id, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
        steps.push({ step: 'attribute ' + (a.name || a.property_id), status: pr.status, error: pr.status >= 300 ? pr.json : undefined });
      }
      // 3) personalisation (parity with publish) — best effort
      try {
        const persoBody = { personalization_questions: [{ question_text: 'Personalise your item', instructions: 'Tell us a custom size or a quote to add. Leave blank when no customisation is required', question_type: 'text_input', required: false, add_on_price: 5.00, max_allowed_characters: 256 }] };
        const perso = await call('/shops/' + SHOP_ID + '/listings/' + target + '/personalization?supports_multiple_personalization_questions=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persoBody) });
        steps.push({ step: 'personalisation', status: perso.status, error: perso.status >= 300 ? perso.json : undefined });
      } catch (e) { /* best-effort */ }
      // 4) media: remove the template's old video + photos, upload the picked Shopify photos
      const media = await replaceListingMedia(call, target, (b.images || []));
      const photosFailed = media.photos.uploaded === 0 && (b.images || []).length;
      steps.push({ step: 'photos', status: photosFailed ? 500 : 200, found: media.photos.found, deleted: media.photos.deleted, uploaded: media.photos.uploaded, failed: media.photos.failed, error: photosFailed ? (media.warning || 'all photos failed') : undefined });
      steps.push({ step: 'old video', status: 200, found: media.video.found, deleted: media.video.deleted });
      // 5) register in Sent items (store the REAL product SKU for display; the Etsy listing keeps the template SKU)
      try {
        const s = await readSent();
        const item = { listing_id: target, sku: String(b.sku || ''), title, section: String(b.section_title || ''), image: (b.images && b.images[0]) || '', ts: Date.now() };
        const items = [item].concat(s.items.filter(x => String(x.listing_id) !== item.listing_id));
        await ghPut(SENT_PATH, JSON.stringify(items, null, 2), s.sha, 'AWA ETSY: tab1 applied-to-template ' + item.sku + ' (' + target + ')');
      } catch (e) { /* best-effort */ }
      const failed = steps.filter(s => s.status >= 300);
      const summary = 'Photos: ' + media.photos.uploaded + ' uploaded' + (media.photos.deleted ? ', ' + media.photos.deleted + ' old removed' : '') + (media.photos.failed ? ', ' + media.photos.failed + ' failed' : '') + '. Video: ' + (media.video.found ? (media.video.deleted + '/' + media.video.found + ' old removed') : 'none');
      finish(200, { ok: !failed.length, listing_id: target, steps, failed: failed.length, warning: media.warning || undefined, summary });
      return;
    }

    res.status(400).json({ ok: false, error: 'Unknown action: ' + q.action });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
