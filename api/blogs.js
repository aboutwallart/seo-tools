// blogs.js — v4.0
// v4.0 (June 30, 2026): Money Page Doctor Winner-Hold — get-mpd-hold / save-mpd-hold actions
//                       (data/mpd-hold.json, array of URLs flagged "winner — don't optimise yet").
// v3.0: Blog Manager Batch 1 — send-to-sheet now auto-generates content sources (colG–colK):
//        authority article (title+URL) + YouTube video (title+link+embed) via Claude web search.
//        Fail-loud: if either is missing the row is NOT written; frontend collects missing parts manually.
//        maxDuration raised to 60s so the web search has time to finish.
// v3.1: colK embed format changed to width=100%/height=400; added colL = responsive embed (same video).
// v3.2: Blog Manager Batch 2 — send-to-sheet also generates People Also Ask (colP), More About (colQ),
//        More about URL (colR = colH), Meta Description (colT), Excerpt (colU), SEO Title (colV) via 3
//        parallel Claude writes; Visibility (colW)='Hidden' and Author (colX)='Mae Osz' fixed.
//        Fail-loud: if any write errors the row is NOT written; the user retries.
// v3.3: Blog Manager taxonomy — cluster classifier fills Primary (colY), Intent (colZ),
//        Supporting 1/2/3 (colAA/AB/AC, 2–3 picked), then Blogs by Topic (colO, JSON) using those clusters.
//        All values restricted to the CLUSTER SYSTEM MAP / allowed topic list. Fail-loud as above.
// v3.4: cluster classifier loosened — Supporting Clusters may come from ANY group (no more false
//        rejections like 'space-planning'); added fallbacks (living-room-decor for Primary, general
//        decor concept tags for Supporting) so a sensible result is always returned.
// v3.5: Blog Manager internal links — AD='full-metafields-blog-post', AE blank, AF–AM = the chosen
//        cluster tags (Primary + Supporting) as anchor text + their CLUSTER SYSTEM MAP URL. No new AI call.
// v3.6: Visual Inspiration (colAP HTML) — AI picks 3–5 trend pages by style/topic, also fills BB–BI
//        (first 4 as URL+anchor pairs). Video metafield (colAQ) = "WATCH:" + YouTube title linked to URL.
// v3.7: Products — picks 4 topic-matched products (2 About Wall Art + 2 Collective by value) from the
//        cluster collections → colAU–AX + colS (joined). Skips products used in the last ~30 blogs via
//        data/recent-blog-products.json (written AFTER the sheet append, best-effort, never blocks send).
// v3.8: Pro Tips / related blogs — 3 published blogs matched by Primary cluster concept in the TITLE
//        (then supporting clusters, then general recent posts as fallback). Fills AR + BM–BR + BU–CF.
//        Best-effort Shopify search; no new AI call (keyword used for the H2).
// v3.9: FIX related-blogs query — Blog.articles rejects query/sortKey; switched to the top-level
//        articles connection with query:"title:*term*" + sortKey PUBLISHED_AT (was silently failing → blank).
// v1.1: Added OPTIMISED_DATE column (col 11) to mark-optimized, unmark-optimized, get-registry
// v1.2: Strip \r from CSV lines to fix Windows line ending corruption; add-to-optimize action
// v1.3: Pad all written rows to 12 columns for consistent CSV structure
// v1.4: sanitizeRow() ensures 12 cols on every write; detectIntent() auto-sets intent from URL; repair-registry action fixes existing rows
// v1.5: delete-registry-row action — targeted single-row delete by keyword+url (used by Duplicate Finder)
// v1.6: repair-registry now overwrites intent on ALL rows (not just blank) — corrects historically wrong intent values
// v1.7: all write actions always use detectIntent(url) — frontend-passed intent is ignored, URL is ground truth
// v2.6: fix all write actions to use findIndex for header detection — prevents header row being wiped on CSV rewrite
import fs from 'fs';
import path from 'path';

// Raise serverless time limit — auto-generating content sources (web search) can take longer than the 10s default
export const config = { maxDuration: 60 };

// ── Cluster taxonomy (from CLUSTER SYSTEM MAP) — allowed tag names by group ──
const CLUSTER_TAXONOMY = {
  room: ['babies-kids-decor','bathroom-decor','bedroom-decor','breakfast-nook-decor','dressing-room-decor','dining-room-decor','fireplace-decor','games-room-decor','hallway-decor','home-bar-decor','kitchen-decor','laundry-room-decor','living-room-decor','pets-decor','office-decor','outdoor-decor','teens-decor','above-fireplace-decor'],
  style: ['abstract-style','bohemian-style','chinoiserie-style','christian-style','coastal-style','coffee-style','contemporary-style','eclectic-style','maximalist-style','farmhouse-style','french-country-style','islamic-style','japandi-style','marble-style','minimalist-style','scandinavian-style','shabby-chic-style','sun-moon-style','travel-style','tropical-style','wildlife-style','zen-style','industrial-style','masculine-style','mediterranean-style','mid-century-style','moroccan-style','old-money-style','preppy-style','transitional-style','biophilic-style','black-white-style'],
  colour: ['black-white','earth-toned','gold-accents','pastel-tones','pink-tones','neutral-tones','teal-tones','blue-tones'],
  accessory: ['appliances-decor','bar-decor','candles','clocks','sculptures','desk-decor','fireplace-accessories','shelves','foot-stools','games-decor','garden-decor','kitchen-accessories','lamps-lighting','mirrors','plants-pots','pet-accessories','rugs','storage-solutions','tableware','textiles','toilet-accessories','wall-panels','wallpaper'],
  occasion: ['birthday-decor','birthstone-decor','christmas-decor','family-decor','love-decor','zodiac-decor'],
  educational: ['interior-design-concepts','home-decor-theory','design-principles','interior-styling-frameworks','decor-mistakes','space-planning','room-layout-ideas','interior-trends','aesthetic-guides','colour-psychology','colour-theory','colour-combinations','how-to-use-colour','monochrome-design','contrast-in-design','warm-vs-cool-tones','accent-colour-ideas'],
  intent: ['styling-tips','buying-guide','inspiration','trend-report','how-to','gift-ideas','seasonal-decor','comparison','product-roundup']
};

// ── Blogs by Topic — allowed friendly labels (separate vocabulary from cluster tags) ──
const BLOGS_BY_TOPIC_OPTIONS = ['Kitchen','Bedroom','Bathroom','Living room','Office','Nursery','Hallways','Fireplaces','Laundry','Outdoor','Teens','Dressing Room','Breakfast Nook','Home Bar','Games Room','Pets','Above Fireplace','Minimalist','Scandinavian','Japandi','Bohemian','Farmhouse','Contemporary','Industrial','Mid-Century','Mediterranean','Moroccan','Coastal','Eclectic','Maximalist','Zen','Biophilic','Black & White','Christian','Islamic','Holidays','Gifts','Interior Design Concepts','Design Principles','Space Planning','Room Layout Ideas','Colour Theory','Colour Psychology','Colour Combinations','Accent Colour Ideas','Decor Mistakes','Colour Trends','Decor Trends','Buying Guides','How-To Guides','Styling Tips','Product Roundups','Trend Reports','Inspiration','Home Decor'];

// ── Cluster tag → destination URL (from CLUSTER SYSTEM MAP) — used for internal links (AF–AM) ──
const CLUSTER_URLS = {
  // Room
  'babies-kids-decor':'https://aboutwallart.com/collections/childrens-bedroom-decor-1','bathroom-decor':'https://aboutwallart.com/collections/bathroom-decor-for-walls','bedroom-decor':'https://aboutwallart.com/collections/wall-art-for-a-bedroom','breakfast-nook-decor':'https://aboutwallart.com/collections/breakfast-nook-decor','dressing-room-decor':'https://aboutwallart.com/collections/dressing-room-decor','dining-room-decor':'https://aboutwallart.com/collections/dining-room-decor','fireplace-decor':'https://aboutwallart.com/collections/above-fireplaces','games-room-decor':'https://aboutwallart.com/collections/games-room-decor-1','hallway-decor':'https://aboutwallart.com/collections/hallway-decor','home-bar-decor':'https://aboutwallart.com/collections/home-bar-decoration','kitchen-decor':'https://aboutwallart.com/collections/kitchen-wall-art-decor','laundry-room-decor':'https://aboutwallart.com/collections/laundry-room-decor','living-room-decor':'https://aboutwallart.com/collections/framed-wall-pictures-for-living-room','pets-decor':'https://aboutwallart.com/collections/all-you-need-for-your-pets-at-home','office-decor':'https://aboutwallart.com/collections/office-wall-artwork','outdoor-decor':'https://aboutwallart.com/collections/outdoors-home-decorations','teens-decor':'https://aboutwallart.com/collections/teens-bedroom-decor','above-fireplace-decor':'https://aboutwallart.com/collections/above-fireplaces',
  // Style
  'abstract-style':'https://aboutwallart.com/collections/abstract-art-prints','bohemian-style':'https://aboutwallart.com/collections/bohemian-wall-art','chinoiserie-style':'https://aboutwallart.com/collections/chinoiserie-wall-decor','christian-style':'https://aboutwallart.com/collections/christian-wall-art','coastal-style':'https://aboutwallart.com/collections/coastal-decor','coffee-style':'https://aboutwallart.com/collections/coffee-wall-art','contemporary-style':'https://aboutwallart.com/collections/contemporary-wall-art','eclectic-style':'https://aboutwallart.com/collections/eclectic-maximalist-decor','maximalist-style':'https://aboutwallart.com/collections/eclectic-maximalist-decor','farmhouse-style':'https://aboutwallart.com/collections/farmhouse-wall-art','french-country-style':'https://aboutwallart.com/collections/french-country-wall-art','islamic-style':'https://aboutwallart.com/collections/wall-islamic-art','japandi-style':'https://aboutwallart.com/pages/japandi-home-decor-trend','marble-style':'https://aboutwallart.com/collections/marble-wall-art','minimalist-style':'https://aboutwallart.com/collections/minimalist-art-prints','scandinavian-style':'https://aboutwallart.com/collections/scandinavian-wall-art','shabby-chic-style':'https://aboutwallart.com/collections/shabby-and-chic-home-decor','sun-moon-style':'https://aboutwallart.com/collections/sun-and-moon-art','travel-style':'https://aboutwallart.com/collections/travel-wall-art','tropical-style':'https://aboutwallart.com/collections/tropical-wall-art','wildlife-style':'https://aboutwallart.com/collections/wild-life-decor','zen-style':'https://aboutwallart.com/pages/zen-room-decorations','industrial-style':'https://aboutwallart.com/pages/industrial-home-decor-trend','masculine-style':'https://aboutwallart.com/pages/masculine-living-room-ideas','mediterranean-style':'https://aboutwallart.com/pages/mediterranean-home-decor-trend','mid-century-style':'https://aboutwallart.com/collections/mid-century-decor','moroccan-style':'https://aboutwallart.com/pages/moroccan-home-decor-trend','old-money-style':'https://aboutwallart.com/pages/old-money-home-decor','preppy-style':'https://aboutwallart.com/pages/preppy-style-interiors','transitional-style':'https://aboutwallart.com/pages/transitional-interior-design','biophilic-style':'https://aboutwallart.com/pages/biophilic-interior-design','black-white-style':'https://aboutwallart.com/pages/black-white-home-decor-trend',
  // Colour
  'black-white':'https://aboutwallart.com/collections/black-and-white-art-on-wall','earth-toned':'https://aboutwallart.com/collections/earth-tone-wall-decor','gold-accents':'https://aboutwallart.com/collections/gold-wall-art','pastel-tones':'https://aboutwallart.com/collections/pastel-art','pink-tones':'https://aboutwallart.com/collections/pink-wall-art','neutral-tones':'https://aboutwallart.com/collections/neutral-wall-art','teal-tones':'https://aboutwallart.com/collections/teal-colour-wall-art','blue-tones':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme',
  // Decor accessory
  'appliances-decor':'https://aboutwallart.com/collections/modern-smart-home-appliances','bar-decor':'https://aboutwallart.com/collections/bar-accessories-for-home','candles':'https://aboutwallart.com/collections/candles','clocks':'https://aboutwallart.com/collections/wall-clocks','sculptures':'https://aboutwallart.com/collections/sculptures-ornaments','desk-decor':'https://aboutwallart.com/collections/desk-accessories','fireplace-accessories':'https://aboutwallart.com/collections/fireplace-accessories','shelves':'https://aboutwallart.com/collections/floating-shelves-for-home','foot-stools':'https://aboutwallart.com/collections/footstools','games-decor':'https://aboutwallart.com/collections/tabletop-games','garden-decor':'https://aboutwallart.com/collections/garden-decor-accessories','kitchen-accessories':'https://aboutwallart.com/collections/kitchen-items','lamps-lighting':'https://aboutwallart.com/collections/lightning-lamps','mirrors':'https://aboutwallart.com/collections/wall-mirrors','plants-pots':'https://aboutwallart.com/collections/plants-pots-planters','pet-accessories':'https://aboutwallart.com/collections/all-you-need-for-your-pets-at-home','rugs':'https://aboutwallart.com/collections/rugs','storage-solutions':'https://aboutwallart.com/collections/storage-items','tableware':'https://aboutwallart.com/collections/dining-tableware','textiles':'https://aboutwallart.com/collections/home-textiles','toilet-accessories':'https://aboutwallart.com/collections/bathroom-accessories','wall-panels':'https://aboutwallart.com/collections/wall-paneling','wallpaper':'https://aboutwallart.com/collections/wallpaper',
  // Occasion
  'birthday-decor':'https://aboutwallart.com/collections/unique-birthday-gifts','birthstone-decor':'https://aboutwallart.com/collections/birthstone-gifts-that-arent-jewelry','christmas-decor':'https://aboutwallart.com/collections/christmas-wall-decor','family-decor':'https://aboutwallart.com/collections/personalised-family-gifts','love-decor':'https://aboutwallart.com/collections/prints-of-love','zodiac-decor':'https://aboutwallart.com/collections/zodiac-in-art',
  // Educational / concept
  'interior-design-concepts':'https://aboutwallart.com/pages/home-decor-by-trend','home-decor-theory':'https://aboutwallart.com/pages/home-decor-by-trend','design-principles':'https://aboutwallart.com/pages/home-decor-by-trend','interior-styling-frameworks':'https://aboutwallart.com/pages/home-decor-by-trend','decor-mistakes':'https://aboutwallart.com/pages/home-decor-by-trend','space-planning':'https://aboutwallart.com/pages/home-decor-by-room','room-layout-ideas':'https://aboutwallart.com/pages/home-decor-by-room','interior-trends':'https://aboutwallart.com/pages/home-decor-by-trend','aesthetic-guides':'https://aboutwallart.com/pages/home-decor-by-trend','colour-psychology':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','colour-theory':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','colour-combinations':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','how-to-use-colour':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','monochrome-design':'https://aboutwallart.com/collections/black-and-white-art-on-wall','contrast-in-design':'https://aboutwallart.com/pages/home-decor-by-trend','warm-vs-cool-tones':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme','accent-colour-ideas':'https://aboutwallart.com/pages/gallery-wall-art-shop-by-colour-scheme',
  // Intent
  'styling-tips':'https://aboutwallart.com/pages/home-decor-by-room','buying-guide':'https://aboutwallart.com/pages/home-decor-items','inspiration':'https://aboutwallart.com/pages/home-decor-by-trend','trend-report':'https://aboutwallart.com/pages/home-decor-by-trend','how-to':'https://aboutwallart.com/pages/home-decor-by-room','comparison':'https://aboutwallart.com/pages/home-decor-by-type','product-roundup':'https://aboutwallart.com/collections/best-sellers','gift-ideas':'https://aboutwallart.com/pages/celebration-gifts-shop-by-ocassion','seasonal-decor':'https://aboutwallart.com/collections/holiday-home-decor'
};

// ── Allowed Trend Pages (for Visual Inspiration AP + BB–BI) — name → URL ──
const TREND_PAGES = {
  'Mid Century Trend':'https://aboutwallart.com/pages/mid-century-trend',
  'Modern Glam Luxe Interior Trend':'https://aboutwallart.com/pages/modern-glam-luxe-interiors',
  'Boho Home Decor Trend':'https://aboutwallart.com/pages/boho-home-decor-trend',
  'Coastal Home Decor Trend':'https://aboutwallart.com/pages/coastal-home-decor-trend',
  'Modern Contemporary Home Decor Trend':'https://aboutwallart.com/pages/modern-contemporary-home-decor',
  'Eclectic Maximalist Home Decor Trend':'https://aboutwallart.com/pages/eclectic-maximalist-home-decor-trend',
  'Modern Farmhouse Home Decor Trend':'https://aboutwallart.com/pages/modern-farmhouse-home-decor',
  'French Country Home Decor Trend':'https://aboutwallart.com/pages/french-country-home-decor',
  'Industrial Home Decor Trend':'https://aboutwallart.com/pages/industrial-home-decor-trend',
  'Japandi Home Decor Trend':'https://aboutwallart.com/pages/japandi-home-decor-trend',
  'Mediterranean Home Decor Trend':'https://aboutwallart.com/pages/mediterranean-home-decor-trend',
  'Cosy Minimalism Home Decor Trend':'https://aboutwallart.com/pages/cosy-minimalism-home-decor-trend',
  'Moroccan Home Decor Trend':'https://aboutwallart.com/pages/moroccan-home-decor-trend',
  'Country Cottage Home Decor Trend':'https://aboutwallart.com/pages/country-cottage-home-decor-trend',
  'Scandi Home Decor Trend':'https://aboutwallart.com/pages/scandi-home-decor-trend',
  'Wildlife Home Decor Trend':'https://aboutwallart.com/pages/wildlife-home-decor-trend',
  'Biophilic Interior Design Trend':'https://aboutwallart.com/pages/biophilic-interior-design',
  'Zen Room Decoration Trend':'https://aboutwallart.com/pages/zen-room-decorations',
  'Tropical Decor for Home Trend':'https://aboutwallart.com/pages/tropical-decor-for-home',
  'Transitional Interior Design Trend':'https://aboutwallart.com/pages/transitional-interior-design',
  'Preppy Style Interiors Trend':'https://aboutwallart.com/pages/preppy-style-interiors',
  'Old Money Home Decor Trend':'https://aboutwallart.com/pages/old-money-home-decor',
  'Coffee House Interior Design Trend':'https://aboutwallart.com/pages/coffee-house-interior-design',
  'Masculine Home Decor Trend':'https://aboutwallart.com/pages/masculine-living-room-ideas',
  'Black & White Home Decor Trend':'https://aboutwallart.com/pages/black-white-home-decor-trend'
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = 'aboutwallart/seo-tools';
  const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;

  // Helper: fetch file from GitHub
  async function getGitHubFile(filePath) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
    const data = await response.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha
    };
  }

  // Helper: update file on GitHub
  async function updateGitHubFile(filePath, content, sha, message) {
    const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to update ${filePath}: ${err}`);
    }
    return true;
  }

  // Helper: quote a CSV field if it contains commas, quotes or newlines
  function csvField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // Helper: detect intent from URL
  function detectIntent(url) {
    if (!url || url === 'N/A') return 'UNKNOWN';
    if (url.includes('/collections/') || url.includes('/products/')) return 'COMMERCIAL';
    if (url.includes('/blog')) return 'INFORMATIONAL';
    if (url.includes('/pages/')) return 'NAVIGATIONAL';
    return 'UNKNOWN';
  }

  // Helper: find title lines, header line, and data start index in registry CSV
  // Returns { titleLines, header, startIdx } — works whether CSV has a title row or not
  function findRegistryHeader(lines) {
    const FALLBACK_HEADER = 'Keyword,Page URL,LOCKED,Status,Action,Clicks,Position,Match Score,AI Score,Source,INTENT,OPTIMIZED DATE';
    const headerIdx = lines.findIndex(l => l.includes('Keyword') && l.includes('Page URL'));
    const titleLines = headerIdx > 0 ? lines.slice(0, headerIdx) : [];
    const header = headerIdx >= 0 ? lines[headerIdx] : FALLBACK_HEADER;
    const startIdx = headerIdx >= 0 ? headerIdx + 1 : 1;
    return { titleLines, header, startIdx };
  }

  // Helper: pad cols array to exactly 12 and return a properly quoted CSV row string
  function sanitizeRow(cols) {
    const padded = [...cols];
    while (padded.length < 12) padded.push('');
    padded.length = 12;
    return padded.map(csvField).join(',');
  }

  // Helper: parse CSV line handling quoted fields
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"'; i++; // escaped quote "" → "
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim()); current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Helper: append row to Google Sheet via Apps Script webhook
  // sources (optional) = { authorityTitle, authorityUrl, youtubeTitle, youtubeLink, youtubeEmbed } → columns G–K
  async function appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl, sources = {}) {
    if (!SHEETS_WEBHOOK) {
      console.log('SHEETS_WEBHOOK_URL not configured - skipping Google Sheets append');
      return { skipped: true };
    }
    const response = await fetch(SHEETS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        colA: 'BLOG MANAGER TOOL',
        colB: perspective || '',
        colC: keyword || '',
        colD: galleryCode || '',
        colE: collectionUrl || '',
        colF: title || '',
        colG: sources.authorityTitle || '',
        colH: sources.authorityUrl || '',
        colI: sources.youtubeTitle || '',
        colJ: sources.youtubeLink || '',
        colK: sources.youtubeEmbed || '',
        colL: sources.youtubeEmbedResponsive || '',
        colO: sources.blogsByTopic || '',
        colP: sources.peopleAlsoAsk || '',
        colQ: sources.moreAbout || '',
        colR: sources.moreAboutUrl || '',
        colS: sources.productList || '',
        colT: sources.metaDescription || '',
        colU: sources.excerpt || '',
        colV: sources.seoTitle || '',
        colW: sources.visibility || '',
        colX: sources.author || '',
        colY: sources.primaryCluster || '',
        colZ: sources.intentTag || '',
        colAA: sources.supporting1 || '',
        colAB: sources.supporting2 || '',
        colAC: sources.supporting3 || '',
        colAD: 'full-metafields-blog-post',   // Theme template (fixed)
        colAE: '',                            // Visibility date (always blank)
        colAF: sources.anchor1 || '',
        colAG: sources.url1 || '',
        colAH: sources.anchor2 || '',
        colAI: sources.url2 || '',
        colAJ: sources.anchor3 || '',
        colAK: sources.url3 || '',
        colAL: sources.anchor4 || '',
        colAM: sources.url4 || '',
        colAP: sources.visualInspirationHtml || '',
        colAQ: sources.videoMetafield || '',
        colAR: sources.proTipsMetafield || '',
        colAS: 'READY TO GENERATE BLOG',
        colAU: sources.product1 || '',
        colAV: sources.product2 || '',
        colAW: sources.product3 || '',
        colAX: sources.product4 || '',
        colAY: '',
        colBB: sources.viUrl1 || '',
        colBC: sources.viAnchor1 || '',
        colBD: sources.viUrl2 || '',
        colBE: sources.viAnchor2 || '',
        colBF: sources.viUrl3 || '',
        colBG: sources.viAnchor3 || '',
        colBH: sources.viUrl4 || '',
        colBI: sources.viAnchor4 || '',
        colBM: sources.pt1Anchor || '',
        colBN: sources.pt1Url || '',
        colBO: sources.pt2Anchor || '',
        colBP: sources.pt2Url || '',
        colBQ: sources.pt3Anchor || '',
        colBR: sources.pt3Url || '',
        colBU: sources.pt1Handle || '',
        colBV: sources.pt2Handle || '',
        colBW: sources.pt3Handle || '',
        colBX: sources.pt1Image || '',
        colBY: sources.pt2Image || '',
        colBZ: sources.pt3Image || '',
        colCA: sources.blog1Gid || '',
        colCB: sources.blog1Id || '',
        colCC: sources.blog2Gid || '',
        colCD: sources.blog2Id || '',
        colCE: sources.blog3Gid || '',
        colCF: sources.blog3Id || ''
      })
    });
    if (!response.ok) throw new Error(`Sheets webhook error: ${response.status}`);
    return await response.json();
  }

  // Helper: extract the 11-char YouTube video id from a watch/share/embed/shorts link. Returns '' if none.
  function extractYouTubeId(link) {
    if (!link) return '';
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,        // watch?v=ID
      /youtu\.be\/([A-Za-z0-9_-]{11})/,    // youtu.be/ID
      /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/, // /embed/ID
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/ // /shorts/ID
    ];
    for (const p of patterns) {
      const m = link.match(p);
      if (m) return m[1];
    }
    return '';
  }

  // Column K — simple fixed embed. Returns '' if no id.
  function buildYouTubeEmbed(id) {
    if (!id) return '';
    return `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe>`;
  }

  // Column L — responsive embed wrapped in a 16:9 sizing div. Returns '' if no id.
  function buildYouTubeEmbedResponsive(id) {
    if (!id) return '';
    return `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;"><iframe src="https://www.youtube.com/embed/${id}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen></iframe></div>`;
  }

  // Helper: auto-generate Batch 1 content sources via Claude web search.
  // Returns { authorityTitle, authorityUrl, youtubeTitle, youtubeLink } — any field may be '' if not found.
  async function generateContentSources(keyword, title) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const prompt = `You are preparing a blog post for aboutwallart.com, an interior design and wall art e-commerce site.
Blog topic / main keyword: "${keyword}"
Blog working title: "${title}"

Use web search to find:
1. ONE authoritative, trustworthy external article on this topic from a reputable source (a design magazine, established publication, museum, university, or recognised expert site). It MUST NOT be an online shop selling wall art, prints or home decor (no competitor stores). Give its exact published title and full URL.
2. ONE relevant, good-quality YouTube video on this topic. Give its exact title and full watch URL in the form https://www.youtube.com/watch?v=VIDEOID

Return ONLY a JSON object, with no commentary before or after, in exactly this shape:
{"authorityTitle":"","authorityUrl":"","youtubeTitle":"","youtubeLink":""}
If you genuinely cannot find one of the two, leave its two fields as empty strings.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      const low = (errText || '').toLowerCase();
      const outOfCredits = response.status === 402 || response.status === 429 || low.includes('credit') || low.includes('billing') || low.includes('quota') || low.includes('insufficient');
      throw new Error(outOfCredits
        ? 'Claude is out of credits or rate-limited — top up your Anthropic account, then press again.'
        : `Claude API error: ${response.status} ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not read the search result (no data returned)');

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) { throw new Error('Search result was not in a readable format'); }

    return {
      authorityTitle: (parsed.authorityTitle || '').trim(),
      authorityUrl: (parsed.authorityUrl || '').trim(),
      youtubeTitle: (parsed.youtubeTitle || '').trim(),
      youtubeLink: (parsed.youtubeLink || '').trim()
    };
  }

  // Helper: fetch ALL live-published blog articles (title + real URL) for the cannibalisation check.
  // Paginates the Shopify articles connection; skips drafts and future-scheduled posts.
  async function fetchPublishedBlogs() {
    const out = [];
    let cursor = null;
    const now = Date.now();
    for (let page = 0; page < 12; page++) {
      const data = await shopifyGraphQL(
        `query($cursor:String){ articles(first:250, after:$cursor, sortKey:PUBLISHED_AT, reverse:true){ edges{ cursor node{ title handle publishedAt blog{ handle } } } pageInfo{ hasNextPage } } }`,
        { cursor }
      );
      const conn = data.articles;
      if (!conn) break;
      const edges = conn.edges || [];
      for (const e of edges) {
        const n = e.node;
        if (!n || !n.publishedAt) continue;                       // draft / not published
        if (new Date(n.publishedAt).getTime() > now) continue;    // scheduled for the future
        const blogHandle = (n.blog && n.blog.handle) || 'news-articles-home-decor-inspiration';
        out.push({ title: n.title || '', url: `https://aboutwallart.com/blogs/${blogHandle}/${n.handle || ''}` });
      }
      if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
      cursor = edges.length ? edges[edges.length - 1].cursor : null;
      if (!cursor) break;
    }
    return out;
  }

  // Helper: for each working title, derive the TRUE short main keyword and flag cannibalisation
  // against the already-published blogs — judged the way Google would: by SEARCH INTENT, not shared words.
  // Method: (1) derive the real short keyword, (2) NARROW to a shortlist of published blogs that share a
  // distinctive word (generic site words like "wall art" ignored; a few synonyms expanded), (3) let Claude
  // pick the SINGLE closest blog by whether a searcher would be satisfied by the same page.
  // Returns [{ title, keyword, cannibalization, conflictingKeyword (blog TITLE), conflictingUrl, looserCount }].
  async function analyzeTitlesForKeywords(titles, published) {
    // Words shared across the whole site — not clues to cannibalisation.
    const GENERIC = new Set(['wall','art','arts','decor','decoration','home','house','best','how','what','why','can','do','does','i','my','me','the','a','an','in','on','for','to','of','with','your','you','and','or','is','are','be','ideas','idea','tips','tip','guide','using','use','into','without','make','made']);
    // Tiny synonym map so a same-intent blog worded differently still gets shortlisted.
    const SYN = { protect:['care','maintain','preserve','clean'], care:['protect','maintain','preserve'], maintain:['care','protect','preserve'], colour:['color','colours','colors','colourway','colorway'], color:['colour','colours','colors'], small:['tiny','compact','little'], kids:['children','child','nursery'], budget:['cheap','affordable','inexpensive'] };
    const sig = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !GENERIC.has(w));
    const expand = (words) => { const out = new Set(words); words.forEach(w => (SYN[w] || []).forEach(x => out.add(x))); return out; };

    const results = [];
    const CHUNK = 8;
    for (let i = 0; i < titles.length; i += CHUNK) {
      const chunk = titles.slice(i, i + CHUNK);
      // Build a per-title candidate shortlist (max 15) from shared distinctive words.
      const blocks = chunk.map((t, j) => {
        const want = expand(sig(t));
        const cands = [];
        for (const b of published) {
          const bw = sig(b.title);
          if (bw.some(w => want.has(w))) cands.push(b);
          if (cands.length >= 15) break;
        }
        const candText = cands.length
          ? cands.map((c, k) => `  C${k + 1}. ${c.title}`).join('\n')
          : '  (none)';
        return { title: t, cands, text: `T${j + 1}. ${t}\n${candText}` };
      });
      const titlesBlock = blocks.map(b => b.text).join('\n\n');

      const prompt = `You are an SEO editor for aboutwallart.com (wall art + home decor). Judge cannibalisation the way Google would — by the FULL SEARCH INTENT, not shared words.

For EACH working title (T#), with its candidate published blogs (C#):
1) Give the TRUE main keyword a real person types into Google. CRUCIAL: keep the QUALIFIER that defines the intent — e.g. "gallery wall WITHOUT NAILS", "biophilic design in SMALL SPACES", "wall art FOR KIDS". The qualifier is the whole point; never strip it to the head topic ("gallery wall"). 2 to 6 words, UK spelling ("colour", "decor" no accent), lowercase.
2) Decide if any CANDIDATE targets the SAME QUALIFIED SEARCH. THE HARD RULE: sharing the head topic word (gallery, match, bohemian, colour, small...) is NOT a clash by itself. Two blogs clash ONLY when the QUALIFIER — the specific thing the searcher wants — is essentially the SAME. If the qualifiers differ, it is NO CONFLICT.
   Worked examples (follow this exactly):
   - "gallery wall WITHOUT NAILS" vs "gallery wall IDEAS" → NO CONFLICT (nails ≠ ideas).
   - "match wall art with OFFICE FURNITURE" vs "match wall art to PAINT COLOURS" → NO CONFLICT (furniture ≠ paint).
   - "mix patterns in BOHEMIAN wall art" vs "master BOHEMIAN wall decor" → NO CONFLICT (mixing patterns ≠ general boho decor).
   - "gallery wall without nails" vs "how to hang a gallery wall WITHOUT DAMAGE / no nails" → DANGER (same qualified search).
   DEFAULT TO NO CONFLICT. Only flag when you are confident the qualified intent is the same.
   - "DANGER"      = same qualified search (a real clash).
   - "CAUTION"     = the qualifier is nearly the same, only a small framing difference. Use RARELY.
   - "NO CONFLICT" = qualifiers differ, or no candidate matches (the normal answer).
   Pick only the SINGLE closest candidate.

WORKING TITLES with candidates:
${titlesBlock}

Return ONLY a JSON array, one object per working title in order, exactly:
[{"t":1,"keyword":"","verdict":"NO CONFLICT","closest":0,"shared":"","looser":0}]
- keyword: the full main keyword WITH its qualifier.
- verdict: NO CONFLICT | CAUTION | DANGER.
- closest: the C-number of the single closest candidate for THIS title, or 0 if none clash. Never invent a number.
- shared: if it clashes, the short search phrase BOTH target (2-5 words, e.g. "hanging a gallery wall without nails"); "" if no clash.
- looser: how many OTHER candidates are loosely related but not the closest (a count, 0 if none).`;
      const raw = await callClaudeText(prompt, 3000);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('Could not read the keyword check result');
      let arr;
      try { arr = JSON.parse(m[0]); }
      catch (e) { throw new Error('Keyword check result was not in a readable format'); }
      for (let j = 0; j < chunk.length; j++) {
        const o = arr.find(x => Number(x.t) === j + 1) || arr[j] || {};
        const verdict = ['NO CONFLICT', 'CAUTION', 'DANGER'].includes(String(o.verdict || '').toUpperCase())
          ? String(o.verdict).toUpperCase() : 'NO CONFLICT';
        const cands = blocks[j].cands;
        const ci = parseInt(o.closest, 10);
        let blogTitle = '', blogUrl = '';
        if (verdict !== 'NO CONFLICT' && ci >= 1 && ci <= cands.length) {
          blogTitle = cands[ci - 1].title;
          blogUrl = cands[ci - 1].url;
        }
        const finalVerdict = blogTitle ? verdict : 'NO CONFLICT';
        results.push({
          title: chunk[j],
          keyword: String(o.keyword || '').trim(),
          cannibalization: finalVerdict,
          conflictingKeyword: blogTitle,
          conflictingUrl: blogUrl,
          clashIntent: finalVerdict === 'NO CONFLICT' ? '' : String(o.shared || '').trim(),
          looserCount: Math.max(0, parseInt(o.looser, 10) || 0)
        });
      }
    }
    return results;
  }

  // Helper: build the pre-write brief from the top-ranking competitor pages (reuse MPD's approach).
  async function generateCompetitorBrief(keyword, pages) {
    const summary = pages.map((p, i) => `Competitor ${i + 1}: ${p.url}\n  H1: ${(p.h1 || []).join(' | ') || '-'}\n  H2s: ${(p.h2 || []).join(' | ') || '-'}\n  ~words: ${p.words || 0}`).join('\n\n');
    const prompt = `You are an SEO content strategist for aboutwallart.com (wall art + home decor). A NEW blog will target the keyword "${keyword}". Below are the pages currently ranking top for it. Build a brief to OUTRANK them.

${summary}

Return ONLY a JSON object, no commentary, exactly:
{"wordTarget":0,"faqCount":4,"mustCover":["",""],"gaps":["",""],"angle":""}
- wordTarget: integer word count to match/beat their depth.
- faqCount: how many FAQ questions the blog should answer, 3 to 5.
- mustCover: the key H2 topics the blog MUST include to compete.
- gaps: topics they MISS that this blog can win on.
- angle: one sentence on the winning angle.`;
    const raw = await callClaudeText(prompt, 1500);
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not read the competitor brief');
    let o;
    try { o = JSON.parse(m[0]); }
    catch (e) { throw new Error('Competitor brief was not in a readable format'); }
    return {
      wordTarget: Math.min(2500, parseInt(o.wordTarget, 10) || 2200), // never ask for more than 2500 words (avoids cut-offs)
      faqCount: Math.min(5, Math.max(3, parseInt(o.faqCount, 10) || 4)),
      mustCover: Array.isArray(o.mustCover) ? o.mustCover.filter(Boolean) : [],
      gaps: Array.isArray(o.gaps) ? o.gaps.filter(Boolean) : [],
      angle: String(o.angle || '').trim()
    };
  }

  // Helper: plain Claude text call (no web search) — used by Batch 2 writers
  async function callClaudeText(prompt, maxTokens) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      const low = (errText || '').toLowerCase();
      const outOfCredits = response.status === 402 || response.status === 429 || low.includes('credit') || low.includes('billing') || low.includes('quota') || low.includes('insufficient');
      throw new Error(outOfCredits
        ? 'Claude is out of credits or rate-limited — top up your Anthropic account, then press again.'
        : `Claude API error: ${response.status} ${errText.slice(0, 150)}`);
    }
    const data = await response.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    return text.trim();
  }

  // Column P — 3 "People Also Ask" Q&A pairs, plain text
  async function generatePeopleAlsoAsk(keyword, title) {
    const prompt = `You are a professional home decor expert writing in a calm, authoritative, and helpful tone.

Generate exactly 3 "People Also Ask" style questions based on the blog title provided.

Blog title: "${title}"
Main keyword: "${keyword}"

SEO Requirements:
- At least ONE question must include the main keyword phrase "${keyword}".
- Questions must sound like real Google search queries.
- Questions must be directly related to the blog topic.

Answer Style Requirements:
- Write in a professional, advisory tone.
- Do NOT write in first person.
- Do NOT sound overly casual.
- Provide clear, practical guidance.
- Each answer must be 4-6 sentences.
- Maintain a structured, informative style similar to high-quality interior design blogs.
- Avoid fluff and repetition.
- Avoid overly sales-focused language.

Formatting Rules:
Return PLAIN TEXT ONLY. DO NOT use HTML tags.
Format exactly like this:

1. Question text here

Answer paragraph...

2. Question text here

Answer paragraph...

3. Question text here

Answer paragraph...

Rules:
- Use plain text only - NO HTML tags
- Include the number at the start of each question
- Add a blank line between question and answer
- Add a blank line between each Q&A pair
- Do not add any HTML, markdown, or formatting
- Return only plain text`;
    const text = await callClaudeText(prompt, 2500);
    if (!text) throw new Error('People Also Ask came back empty');
    return text;
  }

  // Column Q — single <p> "More About" paragraph introducing the authority article
  async function generateMoreAbout(keyword, title, articleTitle) {
    const prompt = `You are a professional home decor writer.

Write a short section that introduces an authoritative external article related to the blog topic.

Blog title: "${title}"
Blog topic / main keyword: "${keyword}"
External article title: "${articleTitle}"

Tone Requirements:
- Professional and editorial.
- Informative and supportive.
- Not salesy. Not overly promotional.
- Natural and contextual.

Content Rules:
- Mention the external article title "${articleTitle}" naturally.
- Encourage readers to explore it for deeper insight.
- Keep the paragraph 3-5 sentences.
- Do not exaggerate authority.
- Do not use first person.

Formatting Rules:
Return valid HTML only. Use a single <p> block.
Rules:
- Use only a single <p> block.
- Do not add extra tags.
- Do not add commentary.
- Return only valid HTML.`;
    let text = await callClaudeText(prompt, 1000);
    text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    if (!text) throw new Error('More About paragraph came back empty');
    return text;
  }

  // Columns V, T, U — SEO title + meta description + excerpt, returned as JSON
  async function generateSeoMeta(keyword, title) {
    const prompt = `You are an SEO optimization specialist for a home decor blog.

Blog title: "${title}"
Main keyword: "${keyword}"

Generate:
- SEO_Title
- Meta_Description
- Excerpt

STRICT RULES:
SEO_Title:
- Maximum 59 characters.
- Include the main keyword naturally.
- No emojis. No clickbait. No quotation marks.
Meta_Description:
- Maximum 155 characters.
- Include the main keyword once.
- Clear, compelling, natural.
- No emojis. No quotation marks.
Excerpt:
- 150-300 characters.
- Engaging summary. Professional tone.
- No emojis. No quotation marks. No HTML.

Return valid JSON only using this exact structure:
{
"SEO_Title": "",
"Meta_Description": "",
"Excerpt": ""
}
Do not exceed character limits.
Return only JSON.`;
    let text = await callClaudeText(prompt, 1500);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('SEO/meta result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('SEO/meta result was not valid JSON'); }
    const seoTitle = (parsed.SEO_Title || '').trim();
    const metaDescription = (parsed.Meta_Description || '').trim();
    const excerpt = (parsed.Excerpt || '').trim();
    if (!seoTitle || !metaDescription || !excerpt) throw new Error('SEO/meta result was incomplete');
    return { seoTitle, metaDescription, excerpt };
  }

  // Columns Y, Z, AA, AB, AC — cluster classifier. 1 Primary + 1 Intent + 2-3 Supporting, only from the taxonomy.
  async function generateClusters(keyword, title) {
    const prompt = `You are a strict blog tag classification engine.
You must assign tags ONLY from the taxonomy lists below. You may not create, modify, guess, or rephrase tags.

Blog title: "${title}"
Main keyword: "${keyword}"

TAGGING RULES
1. Select exactly ONE Primary_Cluster — the single most relevant ROOM, STYLE or COLOUR cluster for the blog. If none clearly applies, use living-room-decor.
2. Select exactly ONE Intent_Tag — from INTENT clusters (mandatory). Do NOT choose the "how-to" intent tag unless this blog is a GENUINE step-by-step how-to guide; for anything that is not step-by-step, pick a different intent tag.
3. Select 2 or 3 Supporting_Clusters related to the blog's topic — these may come from ANY group (Room, Style, Colour, Decor Accessory, Occasion or Educational/Concept). If fewer than 2 clearly apply, add general decor concept tags such as home-decor-theory, design-principles or interior-design-concepts.
4. Minimum 4 tags total.
5. Do NOT invent new tags. Do NOT modify spelling. Do NOT repeat tags.
6. Every selected tag must appear EXACTLY in the lists below.

ROOM CLUSTERS: ${CLUSTER_TAXONOMY.room.join(', ')}
STYLE CLUSTERS: ${CLUSTER_TAXONOMY.style.join(', ')}
COLOUR CLUSTERS: ${CLUSTER_TAXONOMY.colour.join(', ')}
DECOR ACCESSORY CLUSTERS: ${CLUSTER_TAXONOMY.accessory.join(', ')}
OCCASION CLUSTERS: ${CLUSTER_TAXONOMY.occasion.join(', ')}
EDUCATIONAL / CONCEPT CLUSTERS: ${CLUSTER_TAXONOMY.educational.join(', ')}
INTENT CLUSTERS: ${CLUSTER_TAXONOMY.intent.join(', ')}

OUTPUT FORMAT (STRICT)
Return valid JSON only:
{
"Primary_Cluster": "",
"Intent_Tag": "",
"Supporting_Cluster_1": "",
"Supporting_Cluster_2": "",
"Supporting_Cluster_3": ""
}
If only 2 supporting clusters apply, leave Supporting_Cluster_3 as an empty string.
Return only JSON. No extra text.`;
    let text = await callClaudeText(prompt, 800);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Cluster result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Cluster result was not valid JSON'); }

    const primary = (parsed.Primary_Cluster || '').trim();
    const intent  = (parsed.Intent_Tag || '').trim();
    const supps   = [parsed.Supporting_Cluster_1, parsed.Supporting_Cluster_2, parsed.Supporting_Cluster_3]
      .map(s => (s || '').trim()).filter(Boolean);

    // Any non-intent tag is valid for Primary and Supporting (no group restriction beyond "not an intent tag")
    const nonIntent = new Set([...CLUSTER_TAXONOMY.room, ...CLUSTER_TAXONOMY.style, ...CLUSTER_TAXONOMY.colour, ...CLUSTER_TAXONOMY.accessory, ...CLUSTER_TAXONOMY.occasion, ...CLUSTER_TAXONOMY.educational]);
    const allowedPrimary    = nonIntent;
    const allowedIntent     = new Set(CLUSTER_TAXONOMY.intent);
    const allowedSupporting = nonIntent;

    if (!primary) throw new Error('No Primary Cluster returned');
    if (!intent)  throw new Error('No Intent Tag returned');
    if (supps.length < 2) throw new Error('Fewer than 2 Supporting Clusters returned');
    if (!allowedPrimary.has(primary)) throw new Error('Invalid Primary Cluster: ' + primary);
    if (!allowedIntent.has(intent))   throw new Error('Invalid Intent Tag: ' + intent);
    for (const s of supps) if (!allowedSupporting.has(s)) throw new Error('Invalid Supporting Cluster: ' + s);
    const all = [primary, ...supps];
    if (new Set(all).size !== all.length) throw new Error('Duplicate cluster tags returned');

    return { primaryCluster: primary, intentTag: intent, supporting: supps };
  }

  // Column O — Blogs by Topic. 2-4 friendly labels, only from the allowed list, using the clusters as input.
  async function generateBlogsByTopic(keyword, title, clusters) {
    const prompt = `You are a strict blog topic selector.
Select relevant values ONLY from the predefined list below. Do not create new values, modify spelling, or return anything outside the list.

Blog Title: "${title}"
Main keyword: "${keyword}"
Primary Cluster: ${clusters.primaryCluster}
Intent Tag: ${clusters.intentTag}
Supporting Clusters: ${clusters.supporting.join(', ')}

Rules:
- Select between 2 and 4 relevant topics.
- Each value must EXACTLY match one of the allowed options below.
- If fewer than 4 apply, return only the applicable ones.
- Do not return empty strings.
- Do not return text outside JSON.

Allowed Options:
${BLOGS_BY_TOPIC_OPTIONS.join('\n')}

Return valid JSON only using this exact structure:
{
"Blogs_By_Topic": ["", "", ""]
}
Return only JSON.`;
    let text = await callClaudeText(prompt, 600);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Blogs by Topic result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Blogs by Topic result was not valid JSON'); }

    const arr = Array.isArray(parsed.Blogs_By_Topic)
      ? parsed.Blogs_By_Topic.map(s => (s || '').trim()).filter(Boolean)
      : [];
    if (arr.length < 2 || arr.length > 4) throw new Error('Blogs by Topic must have 2-4 values');
    const allowed = new Set(BLOGS_BY_TOPIC_OPTIONS);
    for (const t of arr) if (!allowed.has(t)) throw new Error('Invalid Blogs by Topic value: ' + t);
    if (new Set(arr).size !== arr.length) throw new Error('Duplicate Blogs by Topic values');

    return JSON.stringify({ Blogs_By_Topic: arr });
  }

  // Column AP (HTML) + BB–BI — Visual Inspiration. Picks 3–5 trend pages by style/topic.
  // Returns { html, trends: [{name, url, description}] }.
  async function generateVisualInspiration(keyword, title, styleCluster) {
    const allowedNames = Object.keys(TREND_PAGES);
    const prompt = `You are a strict internal linking assistant generating a Visual Inspiration section for a blog post.

Blog title: "${title}"
Main keyword: "${keyword}"
Style cluster: "${styleCluster || '(none provided)'}"

SELECTION RULES:
- Select EXACTLY 3 relevant Trend Pages from the ALLOWED list below.
- If a Style cluster is provided, choose the trend(s) most related to that style first.
- If the Style cluster is empty or too general, choose the trends closest to the blog topic.
- If nothing clearly fits, default to "Cosy Minimalism Home Decor Trend".
- Use ONLY names written EXACTLY as in the allowed list. Do NOT invent or modify names.
- Each trend needs a short descriptive phrase of 4-6 words.

ALLOWED TREND PAGES:
${allowedNames.join('\n')}

Return ONLY valid JSON in this exact shape, no other text:
{"trends":[{"name":"","description":""}]}
Include EXACTLY 3 items.`;
    let text = await callClaudeText(prompt, 900);
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Visual Inspiration result was not readable');
    let parsed;
    try { parsed = JSON.parse(m[0]); }
    catch (e) { throw new Error('Visual Inspiration result was not valid JSON'); }

    const items = Array.isArray(parsed.trends) ? parsed.trends : [];
    const trends = [];
    for (const it of items) {
      const name = (it.name || '').trim();
      const description = (it.description || '').trim();
      if (!name) continue;
      const url = TREND_PAGES[name];
      if (!url) throw new Error('Invalid trend page: ' + name);
      if (trends.some(t => t.name === name)) continue; // skip duplicates
      trends.push({ name, url, description });
    }
    if (trends.length < 2) throw new Error('Visual Inspiration returned fewer than 2 trends');
    if (trends.length > 3) trends.length = 3;

    const lis = trends.map(t => `<li><a href="${t.url}">${t.name}</a> - ${t.description}</li>`).join('');
    const html = `<h3>Visual Inspiration</h3><p>Explore complementary design ideas on our Home Decor by Trend page:</p><ul>${lis}</ul>`;
    return { html, trends };
  }

  // Helper: Shopify Admin GraphQL
  async function shopifyGraphQL(query, variables) {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token  = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!domain || !token) throw new Error('Shopify credentials not configured');
    const r = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) throw new Error('Shopify error: ' + r.status);
    const d = await r.json();
    if (d.errors) throw new Error('Shopify GraphQL error: ' + JSON.stringify(d.errors).slice(0, 200));
    return d.data;
  }

  // Columns S + AU–AX — 4 topic-matched products: 2 About Wall Art + 2 Collective (higher value first),
  // pulled from the collections behind the chosen cluster tags, skipping recently-used products when possible.
  async function selectProducts(clusterTags, recentSet) {
    const AWA_VENDOR = 'About Wall Art';
    const handles = [];
    for (const tag of clusterTags) {
      const url = CLUSTER_URLS[tag];
      if (url && url.includes('/collections/')) {
        const h = url.split('/collections/')[1].split('/')[0].split('?')[0];
        if (h && !handles.includes(h)) handles.push(h);
      }
    }
    if (!handles.length) handles.push('best-sellers'); // fallback when clusters map to /pages/ only

    const seen = new Set();
    const candidates = [];
    for (const handle of handles) {
      const data = await shopifyGraphQL(
        `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:60){ edges{ node{ id vendor variants(first:1){ edges{ node{ price } } } } } } } }`,
        { handle }
      );
      const coll = data.collectionByHandle;
      if (!coll) continue;
      for (const e of coll.products.edges) {
        const n = e.node;
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const price = parseFloat((n.variants.edges[0] && n.variants.edges[0].node.price) || '0');
        candidates.push({ gid: n.id, vendor: n.vendor || '', price });
      }
    }
    if (candidates.length < 4) throw new Error('Not enough products in the matching collections');

    const awa  = candidates.filter(c => c.vendor === AWA_VENDOR);
    const coll = candidates.filter(c => c.vendor !== AWA_VENDOR).sort((a, b) => b.price - a.price);

    const pick = (arr, n) => {
      const fresh = arr.filter(c => !recentSet.has(c.gid));
      const used  = arr.filter(c => recentSet.has(c.gid));
      return [...fresh, ...used].slice(0, n);
    };
    let chosen = [...pick(awa, 2), ...pick(coll, 2)];

    // top up to 4 from whatever is left if one vendor type was short
    if (chosen.length < 4) {
      const have = new Set(chosen.map(c => c.gid));
      const rest = candidates.filter(c => !have.has(c.gid));
      const fresh = rest.filter(c => !recentSet.has(c.gid));
      const used  = rest.filter(c => recentSet.has(c.gid));
      for (const c of [...fresh, ...used]) { if (chosen.length >= 4) break; chosen.push(c); }
    }
    if (chosen.length < 4) throw new Error('Could not assemble 4 products');
    return chosen.slice(0, 4).map(c => c.gid);
  }

  // Helper: derive the room/style/colour concept word(s) from a cluster tag (bedroom-decor → "bedroom")
  function deriveSearchTerm(tag) {
    if (!tag) return '';
    return tag.replace(/-(decor|style|tones|toned|accents)$/, '').replace(/-/g, ' ').trim().toLowerCase();
  }

  // Columns AR + BM–BR + BU–CF — 3 related published blogs matched by cluster concept in the TITLE,
  // topping up via supporting clusters then general recent posts. Best-effort; never throws.
  async function getRelatedBlogs(orderedClusterTags) {
    const FALLBACK_BLOG_GID = 'gid://shopify/Blog/93572858142'; // About Wall Art blog
    const found = [];
    const seen = new Set();
    const addArticle = (a) => {
      if (found.length >= 3 || !a || seen.has(a.id)) return;
      seen.add(a.id);
      found.push({
        articleGid: a.id,
        blogGid: (a.blog && a.blog.id) || FALLBACK_BLOG_GID,
        title: a.title || '',
        handle: a.handle || '',
        url: `https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/${a.handle || ''}`,
        image: (a.image && a.image.url) || ''
      });
    };

    // 1 + 2: cluster concepts (primary, then supporting) matched in the title (top-level articles search)
    for (const tag of orderedClusterTags) {
      if (found.length >= 3) break;
      const term = deriveSearchTerm(tag);
      if (!term) continue;
      const firstWord = term.split(' ')[0];
      try {
        const data = await shopifyGraphQL(
          `query($q:String!){ articles(first:25, query:$q, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} blog{id} } } } }`,
          { q: `title:*${firstWord}*` }
        );
        const arts = data.articles ? data.articles.edges.map(e => e.node) : [];
        for (const a of arts) { if (found.length >= 3) break; addArticle(a); }
      } catch (e) { /* best-effort */ }
    }

    // 3: general fallback — most recent published posts
    if (found.length < 3) {
      try {
        const data = await shopifyGraphQL(
          `query{ articles(first:12, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} blog{id} } } } }`,
          {}
        );
        const arts = data.articles ? data.articles.edges.map(e => e.node) : [];
        for (const a of arts) { if (found.length >= 3) break; addArticle(a); }
      } catch (e) { /* best-effort */ }
    }

    return found;
  }

  // Build the Pro Tips metafield (AR) plain-text block from the related blogs
  function buildProTips(keyword, blogs) {
    if (!blogs.length) return '';
    let out = `H2: Pro Tips for ${keyword}`;
    blogs.forEach((b, i) => {
      const n = i + 1;
      out += `\n\nBLOG${n}_TITLE: ${b.title}\nBLOG${n}_URL: ${b.url}\nBLOG${n}_HANDLE: ${b.handle}`;
    });
    return out;
  }

  try {

    // ============================================
    // GET - Read published blogs from registry
    // ============================================
    if (req.method === 'GET') {

      // ── NEW ACTION: get-published-keywords ──
      if (req.query.action === 'get-published-keywords') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) {
          return res.status(404).json({ error: 'Registry file not found' });
        }
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const publishedBlogs = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 10) {
            const keyword = cols[0];
            const url = cols[1];
            const source = cols[9];
            if ((source === 'Published Blog' || source === 'To_Write_Blog') && keyword) {
              publishedBlogs.push({ keyword: keyword.toLowerCase(), url });
            }
          }
        }
        return res.status(200).json({ success: true, publishedBlogs });
      }

      // ── ACTION: get-registry ──
      if (req.query.action === 'get-registry') {
        const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');
        if (!fs.existsSync(csvPath)) return res.status(200).json({ success: true, registry: [] });
        const csvText = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvText.split('\n');
        const registry = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim().replace(/\r/g, '');
          if (!line) continue;
          const cols = parseCSVLine(line);
          if (cols.length >= 2 && cols[0]) {
            registry.push({
              keyword: cols[0],
              url: cols[1],
              locked: cols[2] === 'LOCKED',
              status: cols[3] || '',
              action: cols[4] || '',
              winnerUrl: cols[5] || '',
              source: cols[9] || '',
              intent: cols[10] || '',
              optimisedDate: cols[11] || ''
            });
          }
        }
        return res.status(200).json({ success: true, registry });
      }

      // ── ACTION: get-revenue-by-month ──
      if (req.query.action === 'get-revenue-by-month') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const months = {};
        const since = new Date();
        since.setMonth(since.getMonth() - 13);
        since.setDate(1);
        since.setHours(0, 0, 0, 0);

        let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=created_at,total_price,financial_status`;

        while (url) {
          const orderRes = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': shopifyToken }
          });
          if (!orderRes.ok) throw new Error('Shopify Orders API error: ' + orderRes.status);
          const data = await orderRes.json();

          for (const order of (data.orders || [])) {
            if (['voided', 'refunded'].includes(order.financial_status)) continue;
            const month = order.created_at.slice(0, 7);
            months[month] = (months[month] || 0) + parseFloat(order.total_price || 0);
          }

          const linkHeader = orderRes.headers.get('Link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = nextMatch ? nextMatch[1] : null;
        }

        const revenue = {};
        Object.entries(months).forEach(([month, total]) => {
          revenue[month.replace('-', '')] = Math.round(total);
        });

        return res.status(200).json({ success: true, revenue });
      }

      // ── ACTION: get-social-revenue ──
      if (req.query.action === 'get-social-revenue') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const days = parseInt(req.query.days || '90');
        const since = new Date();
        since.setDate(since.getDate() - days);
        since.setHours(0, 0, 0, 0);

        const socialMap = {
          'facebook': 'Facebook', 'instagram': 'Instagram', 'pinterest': 'Pinterest',
          'tiktok': 'TikTok', 'youtube': 'YouTube', 'twitter': 'Twitter/X',
          't.co': 'Twitter/X', 'x.com': 'Twitter/X', 'linkedin': 'LinkedIn'
        };

        function getPlatform(referringSite) {
          if (!referringSite) return null;
          const s = referringSite.toLowerCase();
          const key = Object.keys(socialMap).find(k => s.includes(k));
          return key ? socialMap[key] : null;
        }

        function getLandingPath(landingSite) {
          if (!landingSite) return null;
          try {
            const url = new URL(landingSite.startsWith('http') ? landingSite : 'https://x.com' + landingSite);
            return url.pathname || '/';
          } catch(e) { return landingSite.split('?')[0] || '/'; }
        }

        const byPlatform = {};
        const byPage = {};

        let url = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250&fields=created_at,total_price,financial_status,referring_site,landing_site`;

        while (url) {
          const orderRes = await fetch(url, { headers: { 'X-Shopify-Access-Token': shopifyToken } });
          if (!orderRes.ok) throw new Error('Shopify Orders API error: ' + orderRes.status);
          const data = await orderRes.json();

          for (const order of (data.orders || [])) {
            if (['voided', 'refunded'].includes(order.financial_status)) continue;
            const platform = getPlatform(order.referring_site);
            if (!platform) continue;
            const amount = parseFloat(order.total_price || 0);
            byPlatform[platform] = (byPlatform[platform] || 0) + amount;
            const path = getLandingPath(order.landing_site) || '/';
            if (!byPage[path]) byPage[path] = { total: 0, orders: 0, topPlatform: platform, topAmount: 0 };
            byPage[path].total  += amount;
            byPage[path].orders += 1;
            if (amount > byPage[path].topAmount) { byPage[path].topPlatform = platform; byPage[path].topAmount = amount; }
          }

          const linkHeader = orderRes.headers.get('Link') || '';
          const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          url = nextMatch ? nextMatch[1] : null;
        }

        // Round revenue values
        Object.keys(byPlatform).forEach(k => { byPlatform[k] = Math.round(byPlatform[k] * 100) / 100; });
        Object.keys(byPage).forEach(k => { byPage[k].total = Math.round(byPage[k].total * 100) / 100; });

        return res.status(200).json({ success: true, byPlatform, byPage });
      }

      // ── ACTION: get-susp-events ──
      if (req.query.action === 'get-susp-events') {
        try {
          const file = await getGitHubFile('data/suspicious-events.json');
          return res.status(200).json({ success: true, events: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, events: [] });
        }
      }

      // ── ACTION: get-optimisations ──
      if (req.query.action === 'get-optimisations') {
        try {
          const file = await getGitHubFile('data/keyword-optimisations.json');
          return res.status(200).json({ success: true, optimisations: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, optimisations: {} });
        }
      }

      // ── ACTION: get-tracked-keywords ──
      if (req.query.action === 'get-tracked-keywords') {
        try {
          const file = await getGitHubFile('data/tracked-keywords.json');
          const keywords = JSON.parse(file.content);
          return res.status(200).json({ success: true, keywords });
        } catch(e) {
          return res.status(200).json({ success: true, keywords: [] });
        }
      }

      // ── ACTION: get-dismissed-keywords ──
      if (req.query.action === 'get-dismissed-keywords') {
        try {
          const file = await getGitHubFile('data/kwr-dismissed.json');
          const keywords = JSON.parse(file.content);
          return res.status(200).json({ success: true, keywords });
        } catch(e) {
          return res.status(200).json({ success: true, keywords: [] });
        }
      }

      // ── ACTION: get-tech-status ──
      if (req.query.action === 'get-tech-status') {
        try {
          const file = await getGitHubFile('data/tech-status.json');
          return res.status(200).json({ success: true, statuses: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, statuses: {} });
        }
      }

      // ── ACTION: get-reindex-done ──
      if (req.query.action === 'get-reindex-done') {
        try {
          const file = await getGitHubFile('data/reindex-done.json');
          return res.status(200).json({ success: true, done: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, done: [] });
        }
      }

      // ── ACTION: get-keyword-tabs ──
      if (req.query.action === 'get-keyword-tabs') {
        try {
          const file = await getGitHubFile('data/keyword-tracker.json');
          const tabs = JSON.parse(file.content);
          return res.status(200).json({ success: true, tabs });
        } catch(e) {
          return res.status(200).json({ success: true, tabs: [] });
        }
      }

      // ── ACTION: get-autolink-rules ──
      if (req.query.action === 'get-autolink-rules') {
        try {
          const file = await getGitHubFile('data/autolink-rules.json');
          return res.status(200).json({ success: true, rules: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, rules: [] });
        }
      }

      // ── ACTION: get-metafield-links ──
      if (req.query.action === 'get-metafield-links') {
        try {
          const file = await getGitHubFile('data/metafield-product-links.json');
          return res.status(200).json({ success: true, links: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, links: [] });
        }
      }

      // ── ACTION: get-lw-counters ──
      if (req.query.action === 'get-lw-counters') {
        try {
          const file = await getGitHubFile('data/lw-counters.json');
          const data = JSON.parse(file.content);
          return res.status(200).json({ success: true, brokenLinks: data.brokenLinks ?? null, orphanedProducts: data.orphanedProducts ?? null });
        } catch(e) {
          return res.status(200).json({ success: true, brokenLinks: null, orphanedProducts: null });
        }
      }

      // ── ACTION: get-rank-audits ──
      if (req.query.action === 'get-rank-audits') {
        try {
          const file = await getGitHubFile('data/rank-recent-audits.json');
          return res.status(200).json({ success: true, audits: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, audits: [] });
        }
      }

      // ── ACTION: get-lw-settings ──
      if (req.query.action === 'get-lw-settings') {
        try {
          const file = await getGitHubFile('data/lw-settings.json');
          return res.status(200).json({ success: true, settings: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, settings: null });
        }
      }

      // ── ACTION: get-mpd-checklist ── (Money Page Doctor — checkbox states)
      if (req.query.action === 'get-mpd-checklist') {
        try {
          const file = await getGitHubFile('data/mpd-checklist.json');
          return res.status(200).json({ success: true, checklist: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, checklist: {} });
        }
      }

      // ── ACTION: get-mpd-snapshots ── (Money Page Doctor — 90-day GSC baselines)
      if (req.query.action === 'get-mpd-snapshots') {
        try {
          const file = await getGitHubFile('data/mpd-snapshots.json');
          return res.status(200).json({ success: true, snapshots: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, snapshots: {} });
        }
      }

      // ── ACTION: get-mpd-push-state ── (Money Page Doctor — Push to Shopify state)
      if (req.query.action === 'get-mpd-push-state') {
        try {
          const file = await getGitHubFile('data/mpd-push-state.json');
          return res.status(200).json({ success: true, pushState: JSON.parse(file.content) });
        } catch(e) {
          return res.status(200).json({ success: true, pushState: {} });
        }
      }

      // ── ACTION: get-mpd-hold ── (Money Page Doctor — Winner-Hold: URLs to NOT optimise yet)
      if (req.query.action === 'get-mpd-hold') {
        try {
          const file = await getGitHubFile('data/mpd-hold.json');
          const arr = JSON.parse(file.content);
          return res.status(200).json({ success: true, hold: Array.isArray(arr) ? arr : [] });
        } catch(e) {
          return res.status(200).json({ success: true, hold: [] });
        }
      }

      // ── ACTION: get-briefs ── (saved competitor briefs, keyed by lowercased blog title)
      if (req.query.action === 'get-briefs') {
        try {
          const file = await getGitHubFile('data/blog-briefs.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, briefs: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, briefs: {} });
        }
      }

      // ── ACTION: get-drafts ── (saved written blogs, keyed by lowercased blog title)
      if (req.query.action === 'get-drafts') {
        try {
          const file = await getGitHubFile('data/blog-drafts.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, drafts: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, drafts: {} });
        }
      }

      // ── ACTION: get-products ── (saved product picks per blog, keyed by lowercased blog title)
      if (req.query.action === 'get-products') {
        try {
          const file = await getGitHubFile('data/blog-products.json');
          const map = JSON.parse(file.content || '{}');
          return res.status(200).json({ success: true, products: (map && typeof map === 'object') ? map : {} });
        } catch(e) {
          return res.status(200).json({ success: true, products: {} });
        }
      }

      // ── ACTION: seo-metafield-scan ──
      if (req.query.action === 'seo-metafield-scan') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const cursor = req.query.cursor || null;
        const gqlQuery = `
          query($cursor: String) {
            products(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  title
                  handle
                  metafield(namespace: "SEO", key: "meta_description") {
                    id
                    value
                  }
                }
              }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: gqlQuery, variables: { cursor } })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const products = data.data.products;
        const found = [];

        for (const edge of products.edges) {
          const p = edge.node;
          if (p.metafield) {
            found.push({
              productId: p.id.replace('gid://shopify/Product/', ''),
              productGid: p.id,
              title: p.title,
              handle: p.handle,
              metafieldId: p.metafield.id.replace('gid://shopify/Metafield/', ''),
              value: p.metafield.value
            });
          }
        }

        return res.status(200).json({
          success: true,
          found,
          hasNextPage: products.pageInfo.hasNextPage,
          endCursor: products.pageInfo.endCursor
        });
      }

      // ── ACTION: bulk-get-options ── (Bulk Editor — collections list for filter dropdowns)
      if (req.query.action === 'bulk-get-options') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const gqlQuery = `{
          collections(first: 250, sortKey: TITLE) {
            edges { node { id title } }
          }
        }`;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gqlQuery })
        });
        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });
        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const collections = data.data.collections.edges.map(e => ({ id: e.node.id, title: e.node.title }));
        return res.status(200).json({ success: true, collections });
      }

      // ── ACTION: bulk-product-scan ── (Bulk Editor — filtered product fetch)
      if (req.query.action === 'bulk-product-scan') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const cursor = req.query.cursor || null;
        const queryParts = [];

        if (req.query.vendor) queryParts.push(`vendor:'${req.query.vendor.replace(/'/g, "\\'")}' `);
        if (req.query.productType) queryParts.push(`product_type:'${req.query.productType.replace(/'/g, "\\'")}'`);
        if (req.query.status) queryParts.push(`status:${req.query.status}`);
        if (req.query.collection) queryParts.push(`collection_id:${req.query.collection.replace('gid://shopify/Collection/', '')}`);
        if (req.query.keyword) queryParts.push(`title:*${req.query.keyword}*`);
        if (req.query.tags) {
          req.query.tags.split(',').forEach(t => { if (t.trim()) queryParts.push(`tag:'${t.trim()}'`); });
        }

        const queryStr = queryParts.join(' AND ');

        const gqlQuery = `
          query($cursor: String, $queryStr: String) {
            products(first: 50, after: $cursor, query: $queryStr) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id title handle vendor productType status tags
                  descriptionHtml publishedAt
                  seo { title description }
                  featuredImage { url altText }
                  metafields(first: 30) {
                    edges { node { id namespace key value type } }
                  }
                  variants(first: 100) {
                    edges {
                      node {
                        id sku barcode price compareAtPrice weight weightUnit inventoryQuantity
                        inventoryItem { unitCost { amount currencyCode } }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: gqlQuery, variables: { cursor, queryStr } })
        });
        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });
        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        let products = data.data.products.edges.map(edge => {
          const p = edge.node;
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor,
            productType: p.productType,
            status: p.status,
            tags: p.tags,
            descriptionHtml: p.descriptionHtml,
            publishedAt: p.publishedAt,
            seo: p.seo,
            featuredImage: p.featuredImage,
            metafields: p.metafields.edges.map(e => e.node),
            variants: p.variants.edges.map(e => e.node)
          };
        });

        if (req.query.excludeKeyword) {
          const excl = req.query.excludeKeyword.toLowerCase();
          products = products.filter(p => !p.title.toLowerCase().includes(excl));
        }
        if (req.query.excludeTags) {
          const exclTags = req.query.excludeTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          products = products.filter(p => !exclTags.some(et => p.tags.map(t => t.toLowerCase()).includes(et)));
        }

        return res.status(200).json({
          success: true,
          products,
          hasNextPage: data.data.products.pageInfo.hasNextPage,
          endCursor: data.data.products.pageInfo.endCursor
        });
      }

      // ── ORIGINAL GET: Read published blogs from registry ──
      const csvPath = path.resolve(process.cwd(), 'data', 'keyword-locker-registry.csv');

      if (!fs.existsSync(csvPath)) {
        return res.status(404).json({ error: 'Registry file not found', path: csvPath });
      }

      const csvText = fs.readFileSync(csvPath, 'utf-8');
      const lines = csvText.split('\n');
      const blogs = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim().replace(/\r/g, '');
        if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length >= 10) {
          const keyword = cols[0];
          const url = cols[1];
          const source = cols[9];
          if (source === 'Published Blog' && keyword) {
            blogs.push({ title: keyword, keyword, status: 'published', url, date: null });
          }
        }
      }

      return res.status(200).json({ blogs });
    }

    // ============================================
    // POST
    // ============================================
    if (req.method === 'POST') {

      // ── ACTION: lock-keyword ──
      if (req.body.action === 'lock-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url, intent, losers } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // ── DUPLICATE CHECK — reject if keyword already locked anywhere ──
        // ── Proper CSV line parser (handles quoted fields) ──
        function parseCSVLine(line) {
          const cols = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
          cols.push(cur.trim());
          return cols;
        }
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols    = parseCSVLine(line);
          const rowKw     = (cols[0]||'').toLowerCase();
          const rowLocked = (cols[2]||'').toUpperCase();
          const rowStatus = (cols[3]||'').toUpperCase();
          const rowAction = (cols[4]||'').toUpperCase();
          const rowUrl    = cols[1]||'';
          const isRealLock = rowLocked === 'LOCKED' && rowStatus === 'DONE' && ['TO_OPTIMIZE','OPTIMIZED'].includes(rowAction);
          if (isRealLock && rowKw === keyword.toLowerCase()) {
            return res.status(409).json({ duplicate: true, error: `DUPLICATE_KEYWORD`, lockedTo: rowUrl });
          }
        }
        const resolvedIntent = detectIntent(url);
        // Remove any existing SAVED_FOR_FUTURE row for this keyword before adding the locked row
        const cleanedLines = lines.filter(line => {
          if (!line.trim()) return true;
          const cols = parseCSVLine(line);
          const rowKw = (cols[0]||'').toLowerCase();
          const rowAction = (cols[4]||'').toUpperCase();
          return !(rowKw === keyword.toLowerCase() && rowAction === 'SAVED_FOR_FUTURE');
        });
        // 12 columns — empty 12th col keeps registry consistent with mark-optimized rows
        let newRows = `${csvField(keyword)},${csvField(url)},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,User Resolved,${resolvedIntent},`;
        // Add loser rows for internal linking
        if (Array.isArray(losers)) {
          losers.forEach(loser => {
            newRows += `\n${csvField(keyword)},${csvField(loser.url)},,DONE,INTERNAL_LINK,${csvField(url)},${loser.clicks || 'N/A'},${loser.impressions || 'N/A'},${loser.position || 'N/A'},Auto Detected,${resolvedIntent},`;
          });
        }
        const updated = cleanedLines.join('\n').trimEnd() + '\n' + newRows + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Lock keyword: ${keyword}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: mark-optimized ──
      if (req.body.action === 'mark-optimized') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        let found = false;
        const updatedLines = [...titleLines, header];
        const today = new Date().toISOString().split('T')[0];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          const rowUrl = cols[1]?.trim().toLowerCase();
          const rowKeyword = cols[0]?.trim().toLowerCase();
          if (rowUrl === url.toLowerCase() && rowKeyword === keyword.toLowerCase()) {
            cols[2] = 'LOCKED'; cols[3] = 'DONE'; cols[4] = 'OPTIMIZED';
            cols[11] = today;
            updatedLines.push(sanitizeRow(cols));
            found = true;
          } else {
            updatedLines.push(sanitizeRow(cols));
          }
        }
        if (!found) {
          updatedLines.push(`${keyword},${url},LOCKED,DONE,OPTIMIZED,,,,,,User Resolved,${today}`);
        }
        const updated = updatedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Mark optimized: ${keyword} on ${url}`);
        return res.status(200).json({ success: true, keyword, url });
      }

      // ── ACTION: unmark-optimized ──
      if (req.body.action === 'unmark-optimized') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        let found = false;
        const updatedLines = [...titleLines, header];
        for (let i = startIdx; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const cols = parseCSVLine(lines[i]);
          while (cols.length < 12) cols.push('');
          if (cols[1]?.trim().toLowerCase() === url.toLowerCase() && cols[0]?.trim().toLowerCase() === keyword.toLowerCase()) {
            cols[4] = 'TO_OPTIMIZE';
            cols[11] = '';
            updatedLines.push(sanitizeRow(cols));
            found = true;
          } else { updatedLines.push(sanitizeRow(cols)); }
        }
        if (!found) return res.status(404).json({ error: 'Page not found in registry' });
        await updateGitHubFile('data/keyword-locker-registry.csv', updatedLines.join('\n') + '\n', registry.sha, `Unmark optimized: ${keyword}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: add-to-optimize ──
      if (req.body.action === 'add-to-optimize') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        // Check if already exists
        const exists = lines.slice(1).some(l => {
          const cols = l.split(',');
          return cols[1]?.trim().toLowerCase() === url.toLowerCase() && cols[0]?.trim().toLowerCase() === keyword.toLowerCase();
        });
        if (exists) return res.status(200).json({ success: true, alreadyExists: true });
        const newRow = `${csvField(keyword)},${csvField(url)},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,User Resolved,${detectIntent(url)},`;
        const updated = lines.filter(l => l.trim()).join('\n') + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Add to optimize: ${keyword} on ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: repurpose-page ── (saves a URL as REPURPOSE — no keyword assigned yet)
      if (req.body.action === 'repurpose-page') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const urlLower = url.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[1]||'').toLowerCase() === urlLower && (cols[4]||'').toUpperCase() === 'REPURPOSE';
        });
        if (alreadyExists) return res.status(200).json({ success: true, skipped: true });
        const intent = detectIntent(url);
        const urlPath = url.replace('https://aboutwallart.com','').replace('https://www.aboutwallart.com','');
        const newRow = sanitizeRow([urlPath,url,'','DONE','REPURPOSE','','','','','System',intent,'']);
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Repurpose page: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-for-later ──
      if (req.body.action === 'save-for-later') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, intent } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // Duplicate check — skip if already exists with any action
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[0]||'').toLowerCase() === kwLower;
        });
        if (alreadyExists) return res.status(200).json({ success: true, keyword, skipped: true });
        const newRow = `${csvField(keyword)},N/A,LOCKED,DONE,SAVED_FOR_FUTURE,N/A,N/A,N/A,N/A,User Action,UNKNOWN,`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Save for later: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: delete-keyword ──
      if (req.body.action === 'delete-keyword') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, intent } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        // Duplicate check — skip if already exists with any action
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const alreadyExists = lines.some(line => {
          const cols = parseCSVLine(line.trim());
          return (cols[0]||'').toLowerCase() === kwLower;
        });
        if (alreadyExists) return res.status(200).json({ success: true, keyword, skipped: true });
        const newRow = `${csvField(keyword)},N/A,LOCKED,DONE,DELETED,N/A,N/A,N/A,N/A,User Action,UNKNOWN,`;
        const updated = registry.content.trimEnd() + '\n' + newRow + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Delete keyword: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: remove-from-registry ──
      if (req.body.action === 'remove-from-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const filtered = lines.filter(line => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          const cols = parseCSVLine(trimmed);
          return cols[0].toLowerCase() !== keyword.toLowerCase();
        });
        const updated = filtered.join('\n');
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Remove from registry: ${keyword}`);
        return res.status(200).json({ success: true, keyword });
      }

      // ── ACTION: delete-registry-row ── (targeted: removes one specific keyword+url row)
      if (req.body.action === 'delete-registry-row') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keyword, url } = req.body;
        if (!keyword || !url) return res.status(400).json({ error: 'keyword and url required' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n');
        const kwLower = keyword.toLowerCase();
        const urlLower = url.toLowerCase();
        const filtered = lines.filter(line => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          const cols = parseCSVLine(trimmed);
          return !((cols[0]||'').toLowerCase() === kwLower && (cols[1]||'').toLowerCase() === urlLower);
        });
        await updateGitHubFile('data/keyword-locker-registry.csv', filtered.join('\n'), registry.sha, `Delete registry row: ${keyword} on ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: repair-registry ── (one-time fix: pad all rows to 12 cols, fill blank intent)
      if (req.body.action === 'repair-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const repairedLines = [...titleLines, header];
        let fixedCount = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          while (cols.length < 12) cols.push('');
          cols.length = 12;
          const correctIntent = detectIntent(cols[1] || 'N/A');
          if (cols[10] !== correctIntent) {
            cols[10] = correctIntent;
            fixedCount++;
          }
          repairedLines.push(sanitizeRow(cols));
        }
        const updated = repairedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Repair registry: pad to 12 columns, fill blank intent`);
        return res.status(200).json({ success: true, fixedCount, totalRows: repairedLines.length - 1 });
      }

      // ── ACTION: deduplicate-registry ── (removes duplicate SAVED_FOR_FUTURE and DELETED rows, keeps one per keyword)
      if (req.body.action === 'deduplicate-registry') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const seen = new Set();
        const cleaned = [...titleLines, header];
        let removed = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const action = (cols[4]||'').toUpperCase();
          const kw = (cols[0]||'').toLowerCase();
          if (action === 'SAVED_FOR_FUTURE' || action === 'DELETED') {
            const key = kw + '::' + action;
            if (seen.has(key)) { removed++; continue; }
            seen.add(key);
          }
          cleaned.push(sanitizeRow(cols));
        }
        const updated = cleaned.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Deduplicate registry: removed ${removed} duplicate rows`);
        return res.status(200).json({ success: true, removed, total: cleaned.length - 1 });
      }

      // ── ACTION: fix-url-format ── (replaces https://www.aboutwallart.com with https://aboutwallart.com in all rows)
      if (req.body.action === 'fix-url-format') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const registry = await getGitHubFile('data/keyword-locker-registry.csv');
        const lines = registry.content.split('\n').map(l => l.replace(/\r/g, ''));
        const { titleLines, header, startIdx } = findRegistryHeader(lines);
        const fixedLines = [...titleLines, header];
        let fixedCount = 0;
        const totalRows = lines.length - startIdx;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const before = cols[1] || '';
          cols[1] = before.replace('https://www.aboutwallart.com', 'https://aboutwallart.com');
          if (cols[1] !== before) fixedCount++;
          fixedLines.push(sanitizeRow(cols));
        }
        const updated = fixedLines.join('\n') + '\n';
        await updateGitHubFile('data/keyword-locker-registry.csv', updated, registry.sha, `Fix URL format: remove www from registry URLs`);
        return res.status(200).json({ success: true, fixed: fixedCount, total: totalRows });
      }

      // ── ACTION: save-susp-events ──
      if (req.body.action === 'save-susp-events') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { events } = req.body;
        const jsonContent = JSON.stringify(events, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/suspicious-events.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/suspicious-events.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update suspicious traffic events', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-optimisations ──
      if (req.body.action === 'save-optimisations') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { optimisations } = req.body;
        const jsonContent = JSON.stringify(optimisations, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-optimisations.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-optimisations.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword optimisations', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-tracked-keywords ──
      if (req.body.action === 'save-tracked-keywords') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords must be an array' });
        const jsonContent = JSON.stringify(keywords, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/tracked-keywords.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/tracked-keywords.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update tracked keywords', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: keywords.length });
      }

      // ── ACTION: save-dismissed-keywords ──
      if (req.body.action === 'save-dismissed-keywords') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) return res.status(400).json({ error: 'keywords must be an array' });
        const jsonContent = JSON.stringify(keywords, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/kwr-dismissed.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/kwr-dismissed.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update dismissed keywords', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: keywords.length });
      }

      // ── ACTION: save-tech-status ──
      if (req.body.action === 'save-tech-status') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { statuses } = req.body;
        if (!statuses || typeof statuses !== 'object') return res.status(400).json({ error: 'statuses object required' });
        await updateGitHubFile('data/tech-status.json', JSON.stringify(statuses, null, 2), null, 'Update tech health statuses');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-reindex-done ──
      if (req.body.action === 'save-reindex-done') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { done } = req.body;
        if (!Array.isArray(done)) return res.status(400).json({ error: 'done must be an array' });
        await updateGitHubFile('data/reindex-done.json', JSON.stringify(done, null, 2), null, 'Update reindex done list');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-checklist ── (Money Page Doctor — checkbox states)
      if (req.body.action === 'save-mpd-checklist') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { checklist } = req.body;
        if (!checklist || typeof checklist !== 'object') return res.status(400).json({ error: 'checklist object required' });
        let sha = null;
        try { const existing = await getGitHubFile('data/mpd-checklist.json'); sha = existing.sha; } catch(e) {}
        await updateGitHubFile('data/mpd-checklist.json', JSON.stringify(checklist, null, 2), sha, 'Update MPD checklist state');
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-snapshot ── (Money Page Doctor — save one GSC baseline)
      if (req.body.action === 'save-mpd-snapshot') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, snapshot } = req.body;
        if (!url || !snapshot) return res.status(400).json({ error: 'url and snapshot required' });
        let existing = {};
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-snapshots.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        existing[url] = snapshot;
        await updateGitHubFile('data/mpd-snapshots.json', JSON.stringify(existing, null, 2), sha, `Save MPD snapshot: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-push-state ── (Money Page Doctor — Push to Shopify state)
      if (req.body.action === 'save-mpd-push-state') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, pushed, linksPushed } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        let existing = {};
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-push-state.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        existing[url] = { pushed: !!pushed, linksPushed: !!linksPushed };
        await updateGitHubFile('data/mpd-push-state.json', JSON.stringify(existing, null, 2), sha, `Save MPD push state: ${url}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-mpd-hold ── (Money Page Doctor — toggle a Winner-Hold URL)
      if (req.body.action === 'save-mpd-hold') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { url, hold } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        let existing = [];
        let sha = null;
        try { const file = await getGitHubFile('data/mpd-hold.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (!Array.isArray(existing)) existing = [];
        const set = new Set(existing);
        if (hold) set.add(url); else set.delete(url);
        const updated = [...set];
        await updateGitHubFile('data/mpd-hold.json', JSON.stringify(updated, null, 2), sha, `${hold ? 'Hold' : 'Unhold'} MPD winner: ${url}`);
        return res.status(200).json({ success: true, hold: updated });
      }

      // ── ACTION: save-keyword-tabs ──
      if (req.body.action === 'save-keyword-tabs') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { tabs } = req.body;
        if (!Array.isArray(tabs)) return res.status(400).json({ error: 'tabs must be an array' });
        const jsonContent = JSON.stringify(tabs, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/keyword-tracker.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/keyword-tracker.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update keyword tracker tabs', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: tabs.length });
      }

      // ── ACTION: save-metafield-links ──
      if (req.body.action === 'save-metafield-links') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { links } = req.body;
        if (!Array.isArray(links)) return res.status(400).json({ error: 'links must be an array' });
        const jsonContent = JSON.stringify(links, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/metafield-product-links.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/metafield-product-links.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update metafield product links', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: links.length });
      }

      // ── ACTION: save-lw-counters ──
      if (req.body.action === 'save-lw-counters') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let existing = { brokenLinks: 0, orphanedProducts: 0 };
        let sha = null;
        try { const file = await getGitHubFile('data/lw-counters.json'); existing = JSON.parse(file.content); sha = file.sha; } catch(e) {}
        if (req.body.brokenLinks !== undefined) existing.brokenLinks = req.body.brokenLinks;
        if (req.body.orphanedProducts !== undefined) existing.orphanedProducts = req.body.orphanedProducts;
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/lw-counters.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update LW counters', content: Buffer.from(JSON.stringify(existing, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-rank-audits ──
      if (req.body.action === 'save-rank-audits') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { audits } = req.body;
        if (!Array.isArray(audits)) return res.status(400).json({ error: 'audits must be an array' });
        let sha = null;
        try { const file = await getGitHubFile('data/rank-recent-audits.json'); sha = file.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/rank-recent-audits.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update rank recent audits', content: Buffer.from(JSON.stringify(audits, null, 2)).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-lw-settings ──
      if (req.body.action === 'save-lw-settings') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { wordsToIgnore, dataTypes, ignoreNumbers } = req.body;
        const settings = {
          wordsToIgnore: Array.isArray(wordsToIgnore) ? wordsToIgnore : [],
          dataTypes: Array.isArray(dataTypes) ? dataTypes : [],
          ignoreNumbers: ignoreNumbers !== false
        };
        const jsonContent = JSON.stringify(settings, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/lw-settings.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/lw-settings.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update link whisperer settings', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-autolink-rules ──
      if (req.body.action === 'save-autolink-rules') {
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const { rules } = req.body;
        if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules must be an array' });
        const jsonContent = JSON.stringify(rules, null, 2);
        let sha = null;
        try { const existing = await getGitHubFile('data/autolink-rules.json'); sha = existing.sha; } catch(e) {}
        const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data/autolink-rules.json`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Update autolink rules', content: Buffer.from(jsonContent).toString('base64'), ...(sha ? { sha } : {}) })
        });
        if (!response.ok) { const err = await response.text(); return res.status(500).json({ error: `GitHub save failed: ${err}` }); }
        return res.status(200).json({ success: true, count: rules.length });
      }

      // ── ACTION: seo-metafield-delete ──
      if (req.body.action === 'seo-metafield-delete') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const { productGid } = req.body;
        if (!productGid) return res.status(400).json({ error: 'productGid required' });

        const mutation = `
          mutation {
            metafieldsDelete(metafields: [{ ownerId: "${productGid}", namespace: "SEO", key: "meta_description" }]) {
              deletedMetafields { key namespace ownerId }
              userErrors { field message }
            }
          }
        `;

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: mutation })
        });

        if (!shopifyRes.ok) return res.status(500).json({ error: `Shopify error: ${shopifyRes.status}` });

        const data = await shopifyRes.json();
        if (data.errors) return res.status(500).json({ error: data.errors[0].message });

        const result = data.data.metafieldsDelete;
        if (result.userErrors.length > 0) return res.status(500).json({ error: result.userErrors[0].message });

        return res.status(200).json({ success: true });
      }

      // ── ACTION: bulk-product-update ── (Bulk Editor — apply changes to one product)
      if (req.body.action === 'bulk-product-update') {
        const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
        const shopifyToken  = process.env.SHOPIFY_ACCESS_TOKEN;
        if (!shopifyDomain || !shopifyToken) return res.status(500).json({ error: 'Shopify credentials not configured' });

        const { productId, productFields, variantUpdates, metafieldUpdates } = req.body;
        if (!productId) return res.status(400).json({ error: 'productId required' });

        const headers = { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' };
        const endpoint = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;

        if (productFields && Object.keys(productFields).length > 0) {
          const mutation = `
            mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { input: { id: productId, ...productFields } } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.productUpdate.userErrors.length > 0) return res.status(500).json({ error: d.data.productUpdate.userErrors[0].message });
        }

        if (variantUpdates && variantUpdates.length > 0) {
          const mutation = `
            mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants { id }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { productId, variants: variantUpdates } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.productVariantsBulkUpdate.userErrors.length > 0) return res.status(500).json({ error: d.data.productVariantsBulkUpdate.userErrors[0].message });
        }

        if (metafieldUpdates && metafieldUpdates.length > 0) {
          const mutation = `
            mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields { namespace key }
                userErrors { field message }
              }
            }
          `;
          const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: mutation, variables: { metafields: metafieldUpdates } }) });
          const d = await r.json();
          if (d.errors) return res.status(500).json({ error: d.errors[0].message });
          if (d.data.metafieldsSet.userErrors.length > 0) return res.status(500).json({ error: d.data.metafieldsSet.userErrors[0].message });
        }

        return res.status(200).json({ success: true });
      }

      // ── ACTION: mark-blog-done ── (title → STATUS=PUBLISHED + clear MONTH, so it leaves the write list for good.
      // Uses the SAME columns the publish flow uses: match on title (col 1), STATUS = col 5, MONTH = col 9.)
      if (req.body.action === 'mark-blog-done') {
        const title = String(req.body.title || '').trim();
        if (!title) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const nrm = (s) => String(s || '').trim().toLowerCase();
        const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const f = await getGitHubFile('data/blog_ideas.csv');
        let found = false;
        const out = f.content.split('\n').map(line => {
          const t = line.trim().replace(/\r/g, '');
          if (!t) return line;
          const cols = parseCSVLine(t);
          if (nrm(cols[1]) === 'blog post title') return line;
          if (nrm(cols[1]) === nrm(title)) { while (cols.length < 10) cols.push(''); cols[5] = 'PUBLISHED'; cols[9] = ''; found = true; return cols.map(esc).join(','); }
          return line;
        });
        if (!found) return res.status(404).json({ error: 'blog not found in the list' });
        await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, 'Mark blog done: ' + title);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: swap-month-blog ── (ONE CSV write: clear removeTitle's month AND set addTitle's month.
      // Atomic so a remove-and-replace can never half-apply and shrink the month. MONTH = col 9, title = col 1.)
      if (req.body.action === 'swap-month-blog') {
        const month = String(req.body.month || '').trim();
        const removeTitle = String(req.body.removeTitle || '').trim();
        const addTitle = String(req.body.addTitle || '').trim();
        if (!month || !removeTitle) return res.status(400).json({ error: 'month and removeTitle required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const nrm = (s) => String(s || '').trim().toLowerCase();
        const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const f = await getGitHubFile('data/blog_ideas.csv');
        let removed = false, added = false;
        const out = f.content.split('\n').map(line => {
          const t = line.trim().replace(/\r/g, '');
          if (!t) return line;
          const cols = parseCSVLine(t);
          if (nrm(cols[1]) === 'blog post title') return line;
          if (nrm(cols[1]) === nrm(removeTitle)) { while (cols.length < 10) cols.push(''); cols[9] = ''; removed = true; return cols.map(esc).join(','); }
          if (addTitle && nrm(cols[1]) === nrm(addTitle)) { while (cols.length < 10) cols.push(''); cols[9] = month; added = true; return cols.map(esc).join(','); }
          return line;
        });
        await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, `Swap month ${month}: -${removeTitle} +${addTitle || '(none)'}`);
        return res.status(200).json({ success: true, removed, added });
      }

      // ── ACTION: update-blog-status ── (single keyword — updates STATUS column in blog_ideas.csv)
      if (req.body.action === 'update-blog-status') {
        const { keyword, status } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const ideasLines = ideasFile.content.split('\n');
        let found = false;
        const updatedIdeas = ideasLines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if ((cols[0] || '').toLowerCase() === keyword.toLowerCase()) {
            while (cols.length < 7) cols.push('');
            cols[6] = status || '';
            found = true;
            return cols.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
          }
          return line;
        }).join('\n');
        if (!found) return res.status(404).json({ error: 'keyword not found in blog_ideas.csv' });
        await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Update blog status: ${keyword} → ${status || 'blank'}`);
        return res.status(200).json({ success: true, keyword, status });
      }

      // ── ACTION: send-to-sheet ── (only calls Apps Script — no GitHub writes)
      // Batch 1: auto-generates content sources (colG–colK) via web search, or accepts manual values (manual:true).
      // Fail-loud: the row is written ONLY when authority article + YouTube video are both complete.
      if (req.body.action === 'send-to-sheet') {
        const { keyword, title, perspective, galleryCode, collectionUrl, manual } = req.body;
        if (!keyword) return res.status(400).json({ error: 'keyword required' });

        let authorityTitle = (req.body.authorityTitle || '').trim();
        let authorityUrl   = (req.body.authorityUrl || '').trim();
        let youtubeTitle   = (req.body.youtubeTitle || '').trim();
        let youtubeLink    = (req.body.youtubeLink || '').trim();

        // Auto mode (first send): search the web for both sources
        if (!manual) {
          try {
            const gen = await generateContentSources(keyword, title);
            authorityTitle = gen.authorityTitle;
            authorityUrl   = gen.authorityUrl;
            youtubeTitle   = gen.youtubeTitle;
            youtubeLink    = gen.youtubeLink;
          } catch (genError) {
            console.error('Content source generation failed:', genError.message);
            // Hand back to the user for manual entry — nothing written to the sheet
            return res.status(200).json({
              success: false,
              needsManual: true,
              error: genError.message,
              found: { authorityTitle: '', authorityUrl: '', youtubeTitle: '', youtubeLink: '' }
            });
          }
        }

        // Build both embed formats from whatever link we have (same video id)
        const youtubeId = extractYouTubeId(youtubeLink);
        const youtubeEmbed = buildYouTubeEmbed(youtubeId);
        const youtubeEmbedResponsive = buildYouTubeEmbedResponsive(youtubeId);

        // Completeness check — both groups must be fully present, and the video link must be a valid YouTube link
        const articleOk = !!(authorityTitle && authorityUrl);
        const youtubeOk = !!(youtubeTitle && youtubeLink && youtubeEmbed);
        if (!articleOk || !youtubeOk) {
          let error;
          if (!articleOk && !youtubeOk) error = 'Could not find a trustworthy article or a YouTube video — please add them manually.';
          else if (!articleOk)         error = 'Could not find a trustworthy article — please add it manually.';
          else if (youtubeTitle && youtubeLink && !youtubeEmbed) error = 'That YouTube link is not valid — please check it.';
          else                         error = 'Could not find a YouTube video — please add it manually.';
          return res.status(200).json({
            success: false,
            needsManual: true,
            error,
            found: { authorityTitle, authorityUrl, youtubeTitle, youtubeLink }
          });
        }

        // Batch 2 + taxonomy — generate in parallel: People Also Ask (P), More About (Q),
        // SEO title+meta+excerpt (V/T/U), and the cluster classifier (Y/Z/AA/AB/AC).
        // Blogs by Topic (O) runs after, because it needs the clusters.
        // Fail-loud: if any write errors, nothing is written; the user simply sends again.
        let peopleAlsoAsk, moreAbout, metaDescription, excerpt, seoTitle;
        let primaryCluster, intentTag, supporting1, supporting2, supporting3, blogsByTopic;
        let linkAnchor1 = '', linkUrl1 = '', linkAnchor2 = '', linkUrl2 = '', linkAnchor3 = '', linkUrl3 = '', linkAnchor4 = '', linkUrl4 = '';
        let visualInspirationHtml = '', videoMetafield = '';
        let viUrl1 = '', viAnchor1 = '', viUrl2 = '', viAnchor2 = '', viUrl3 = '', viAnchor3 = '', viUrl4 = '', viAnchor4 = '';
        let productList = '', product1 = '', product2 = '', product3 = '', product4 = '', chosenProductGids = [];
        let proTipsMetafield = '';
        let pt1Anchor = '', pt1Url = '', pt2Anchor = '', pt2Url = '', pt3Anchor = '', pt3Url = '';
        let pt1Handle = '', pt2Handle = '', pt3Handle = '', pt1Image = '', pt2Image = '', pt3Image = '';
        let blog1Gid = '', blog1Id = '', blog2Gid = '', blog2Id = '', blog3Gid = '', blog3Id = '';
        try {
          const [paa, more, seo, clusters] = await Promise.all([
            generatePeopleAlsoAsk(keyword, title),
            generateMoreAbout(keyword, title, authorityTitle),
            generateSeoMeta(keyword, title),
            generateClusters(keyword, title)
          ]);
          peopleAlsoAsk   = paa;
          moreAbout       = more;
          metaDescription = seo.metaDescription;
          excerpt         = seo.excerpt;
          seoTitle        = seo.seoTitle;
          primaryCluster  = clusters.primaryCluster;
          intentTag       = clusters.intentTag;
          supporting1     = clusters.supporting[0] || '';
          supporting2     = clusters.supporting[1] || '';
          supporting3     = clusters.supporting[2] || '';

          // Blogs by Topic (O), Visual Inspiration (AP/BB–BI) and Products (S/AU–AX) all need the clusters — run together
          const styleTags = [primaryCluster, supporting1, supporting2, supporting3].filter(t => CLUSTER_TAXONOMY.style.includes(t));
          const prodClusterTags = [primaryCluster, supporting1, supporting2, supporting3].filter(Boolean);
          let recentProductSet = new Set();
          try { const rf = await getGitHubFile('data/recent-blog-products.json'); recentProductSet = new Set(JSON.parse(rf.content)); } catch (e) {}
          const [bbt, vi, prodGids, relatedBlogs] = await Promise.all([
            generateBlogsByTopic(keyword, title, clusters),
            generateVisualInspiration(keyword, title, styleTags[0] || ''),
            selectProducts(prodClusterTags, recentProductSet),
            getRelatedBlogs(prodClusterTags)
          ]);
          blogsByTopic = bbt;
          chosenProductGids = prodGids;
          product1 = prodGids[0] || ''; product2 = prodGids[1] || ''; product3 = prodGids[2] || ''; product4 = prodGids[3] || '';
          productList = prodGids.join(',');

          // Pro Tips / related blogs (AR + BM–BR + BU–CF)
          proTipsMetafield = buildProTips(keyword, relatedBlogs);
          if (relatedBlogs[0]) { pt1Anchor = relatedBlogs[0].title; pt1Url = relatedBlogs[0].url; pt1Handle = relatedBlogs[0].handle; pt1Image = relatedBlogs[0].image; blog1Gid = relatedBlogs[0].articleGid; blog1Id = relatedBlogs[0].blogGid; }
          if (relatedBlogs[1]) { pt2Anchor = relatedBlogs[1].title; pt2Url = relatedBlogs[1].url; pt2Handle = relatedBlogs[1].handle; pt2Image = relatedBlogs[1].image; blog2Gid = relatedBlogs[1].articleGid; blog2Id = relatedBlogs[1].blogGid; }
          if (relatedBlogs[2]) { pt3Anchor = relatedBlogs[2].title; pt3Url = relatedBlogs[2].url; pt3Handle = relatedBlogs[2].handle; pt3Image = relatedBlogs[2].image; blog3Gid = relatedBlogs[2].articleGid; blog3Id = relatedBlogs[2].blogGid; }

          visualInspirationHtml = vi.html;
          if (vi.trends[0]) { viUrl1 = vi.trends[0].url; viAnchor1 = vi.trends[0].name; }
          if (vi.trends[1]) { viUrl2 = vi.trends[1].url; viAnchor2 = vi.trends[1].name; }
          if (vi.trends[2]) { viUrl3 = vi.trends[2].url; viAnchor3 = vi.trends[2].name; }
          if (vi.trends[3]) { viUrl4 = vi.trends[3].url; viAnchor4 = vi.trends[3].name; }

          // Video metafield (AQ) — built from the YouTube title + link we already have
          videoMetafield = `WATCH: <a href="${youtubeLink}">${youtubeTitle}</a>`;

          // Internal links (AF–AM): the chosen cluster tags as anchor text + their CLUSTER SYSTEM MAP URL
          const linkTags = [primaryCluster, supporting1, supporting2, supporting3].filter(Boolean);
          const links = linkTags.map(tag => {
            const url = CLUSTER_URLS[tag];
            if (!url) throw new Error('No URL in cluster map for tag: ' + tag);
            return { anchor: tag, url };
          });
          if (links[0]) { linkAnchor1 = links[0].anchor; linkUrl1 = links[0].url; }
          if (links[1]) { linkAnchor2 = links[1].anchor; linkUrl2 = links[1].url; }
          if (links[2]) { linkAnchor3 = links[2].anchor; linkUrl3 = links[2].url; }
          if (links[3]) { linkAnchor4 = links[3].anchor; linkUrl4 = links[3].url; }
        } catch (b2Error) {
          console.error('Batch 2/taxonomy generation failed:', b2Error.message);
          return res.status(200).json({ success: false, error: 'Could not generate blog details — ' + b2Error.message });
        }

        // Complete row — write to the sheet
        try {
          const sheetsResult = await appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl, {
            authorityTitle, authorityUrl, youtubeTitle, youtubeLink, youtubeEmbed, youtubeEmbedResponsive,
            peopleAlsoAsk,
            moreAbout,
            moreAboutUrl: authorityUrl,   // column R = column H
            metaDescription, excerpt, seoTitle,
            visibility: 'Hidden',
            author: 'Mae Osz',
            blogsByTopic,
            primaryCluster, intentTag, supporting1, supporting2, supporting3,
            anchor1: linkAnchor1, url1: linkUrl1,
            anchor2: linkAnchor2, url2: linkUrl2,
            anchor3: linkAnchor3, url3: linkUrl3,
            anchor4: linkAnchor4, url4: linkUrl4,
            visualInspirationHtml, videoMetafield,
            viUrl1, viAnchor1, viUrl2, viAnchor2, viUrl3, viAnchor3, viUrl4, viAnchor4,
            productList, product1, product2, product3, product4,
            proTipsMetafield,
            pt1Anchor, pt1Url, pt2Anchor, pt2Url, pt3Anchor, pt3Url,
            pt1Handle, pt2Handle, pt3Handle, pt1Image, pt2Image, pt3Image,
            blog1Gid, blog1Id, blog2Gid, blog2Id, blog3Gid, blog3Id
          });

          // Record the products just used (best-effort — runs AFTER the sheet append, never blocks the send)
          try {
            let rSha = null, rExisting = [];
            try { const rf = await getGitHubFile('data/recent-blog-products.json'); rExisting = JSON.parse(rf.content); rSha = rf.sha; } catch (e) {}
            const rUpdated = [...rExisting, ...chosenProductGids].slice(-120); // ~30 blogs × 4
            await fetch(`https://api.github.com/repos/${REPO}/contents/data/recent-blog-products.json`, {
              method: 'PUT',
              headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Update recent blog products', content: Buffer.from(JSON.stringify(rUpdated, null, 2)).toString('base64'), ...(rSha ? { sha: rSha } : {}) })
            });
          } catch (e) { console.error('Recent products save failed (non-fatal):', e.message); }

          return res.status(200).json({ success: true, sheetsResult });
        } catch (sheetsError) {
          console.error('Google Sheets append failed:', sheetsError.message);
          return res.status(200).json({ success: false, error: sheetsError.message });
        }
      }

      // ── ACTION: bulk-update-blog-status ── (multiple keywords — one GitHub write)
      if (req.body.action === 'bulk-update-blog-status') {
        const { keywords, status } = req.body;
        if (!Array.isArray(keywords) || keywords.length === 0) return res.status(400).json({ error: 'keywords array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const keywordSet = new Set(keywords.map(k => (k || '').toLowerCase()));
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const ideasLines = ideasFile.content.split('\n');
        const updatedIdeas = ideasLines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (keywordSet.has((cols[0] || '').toLowerCase())) {
            while (cols.length < 7) cols.push('');
            cols[6] = status || '';
            return cols.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(',');
          }
          return line;
        }).join('\n');
        await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Bulk update blog status: ${keywords.length} keywords → ${status || 'blank'}`);
        return res.status(200).json({ success: true, count: keywords.length, status });
      }

      // ── ACTION: analyze-blog-titles ── (the brain: real short keyword + cannibalisation flag)
      // Input: { titles: ["...", ...] }. Fetches live published blogs once, then judges each title.
      // Saves NOTHING — the tool shows the result for review first.
      if (req.body.action === 'analyze-blog-titles') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles.map(t => String(t || '').trim()).filter(Boolean) : [];
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        const published = await fetchPublishedBlogs();
        const results = await analyzeTitlesForKeywords(titles, published);
        return res.status(200).json({ success: true, publishedCount: published.length, results });
      }

      // ── ACTION: save-blog-ideas ── (writes reviewed keyword + cannibalisation into blog_ideas.csv)
      // Input: { rows: [{ title, keyword, cannibalization, conflictingKeyword, conflictingUrl, perspective?, isNew? }] }
      // Existing rows (matched by Blog Post Title) get their Keyword + CANNIBALIZATION + conflict columns updated.
      // Rows flagged isNew that aren't already present are APPENDED with STATUS = TO_WRITE.
      if (req.body.action === 'save-blog-ideas') {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ error: 'rows array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const byTitle = new Map(rows.map(r => [norm(r.title), r]));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          // Header row — make sure the CLASH INTENT (8th) + CHECKED (9th) column names exist.
          if (norm(cols[1]) === 'blog post title') {
            while (cols.length < 9) cols.push('');
            if (!cols[7]) cols[7] = 'CLASH INTENT';
            if (!cols[8]) cols[8] = 'CHECKED';
            return cols.map(esc).join(',');
          }
          const key = norm(cols[1]);
          const r = byTitle.get(key);
          if (r && !done.has(key)) {
            while (cols.length < 9) cols.push('');
            if (r.keyword !== undefined && r.keyword !== null) cols[0] = r.keyword;
            if (r.newTitle) cols[1] = r.newTitle;
            if (r.cannibalization) cols[3] = r.cannibalization;
            cols[4] = r.conflictingKeyword || '';
            cols[5] = r.conflictingUrl || '';
            cols[7] = r.clashIntent || '';
            cols[8] = '1';
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        while (updated.length && updated[updated.length - 1].trim() === '') updated.pop();
        let appended = 0;
        for (const r of rows) {
          if (r.isNew && !done.has(norm(r.title))) {
            const newCols = [
              r.keyword || '', r.title || '', r.perspective || '',
              r.cannibalization || 'NO CONFLICT', r.conflictingKeyword || '', r.conflictingUrl || '', 'TO_WRITE', r.clashIntent || ''
            ];
            updated.push(newCols.map(esc).join(','));
            done.add(norm(r.title));
            appended++;
          }
        }
        const out = updated.join('\n') + '\n';
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Blog keywords + cannibalisation: ${done.size} rows (${appended} new)`);
        return res.status(200).json({ success: true, updated: done.size, appended });
      }

      // ── ACTION: clean-keywords ── (LIGHT PASS: derive the real keyword only, NO clash check)
      // Input: { titles: ["...", ...] } — one batch (the frontend loops in batches). Saves NOTHING.
      if (req.body.action === 'clean-keywords') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles.map(t => String(t || '').trim()).filter(Boolean) : [];
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        const titlesBlock = titles.map((t, j) => `T${j + 1}. ${t}`).join('\n');
        const prompt = `You are an SEO editor for aboutwallart.com (wall art + home decor).
For EACH blog title below, give the TRUE main keyword a real person types into Google.
CRUCIAL: keep the QUALIFIER that defines the intent — e.g. "gallery wall WITHOUT NAILS", "biophilic design in SMALL SPACES", "wall art FOR KIDS". Never strip it to the head topic, and NEVER just repeat the long title. 2 to 6 words, UK spelling ("colour", "decor" no accent), lowercase.

TITLES:
${titlesBlock}

Return ONLY a JSON array, one object per title in order, exactly:
[{"t":1,"keyword":""}]`;
        const raw = await callClaudeText(prompt, 2000);
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const m = cleaned.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('Could not read the keyword result');
        let arr;
        try { arr = JSON.parse(m[0]); }
        catch (e) { throw new Error('Keyword result was not in a readable format'); }
        const results = titles.map((t, j) => {
          const o = arr.find(x => Number(x.t) === j + 1) || arr[j] || {};
          return { title: t, keyword: String(o.keyword || '').trim() };
        });
        return res.status(200).json({ success: true, results });
      }

      // ── ACTION: save-keywords ── (writes ONLY the Keyword column — used by the light pass)
      // Input: { rows: [{ title, keyword }] }. Touches nothing else (no clash/checked columns).
      if (req.body.action === 'save-keywords') {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ error: 'rows array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const byTitle = new Map(rows.filter(r => r.keyword).map(r => [norm(r.title), r]));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (norm(cols[1]) === 'blog post title') return line; // header untouched
          const key = norm(cols[1]);
          const r = byTitle.get(key);
          if (r && !done.has(key)) {
            cols[0] = r.keyword;
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        const out = updated.join('\n');
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Clean keywords (light pass): ${done.size} rows`);
        return res.status(200).json({ success: true, updated: done.size });
      }

      // ── ACTION: competitor-check ── (pre-write brief: SerpAPI top 3 → analyse → brief)
      // Input: { keyword, manualUrls?: [] }. Detects SerpAPI out-of-credits → { outOfCredits:true }.
      if (req.body.action === 'competitor-check') {
        const keyword = String(req.body.keyword || '').trim();
        const manualUrls = Array.isArray(req.body.manualUrls) ? req.body.manualUrls.map(u => String(u || '').trim()).filter(Boolean) : [];
        if (!keyword && !manualUrls.length) return res.status(400).json({ error: 'keyword or manualUrls required' });

        let competitors = [];
        if (manualUrls.length) {
          competitors = manualUrls.slice(0, 3).map((u, i) => ({ position: i + 1, title: '', url: u }));
        } else {
          const SERPAPI_KEY = process.env.SERPAPI_KEY;
          if (!SERPAPI_KEY) return res.status(200).json({ success: false, error: 'SERPAPI_KEY not configured' });
          let data;
          try {
            const r = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${SERPAPI_KEY}&num=10&gl=uk&hl=en`);
            data = await r.json();
          } catch (e) {
            return res.status(200).json({ success: false, error: 'Could not reach SerpAPI: ' + e.message });
          }
          // SerpAPI signals problems in data.error — detect the "out of searches/credits" case explicitly.
          if (data.error) {
            const e = String(data.error).toLowerCase();
            const outOfCredits = e.includes('run out') || e.includes('ran out') || e.includes('exceeded') || e.includes('no searches') || e.includes('out of searches') || e.includes('plan') || e.includes('limit');
            return res.status(200).json({ success: false, outOfCredits, error: data.error });
          }
          const organic = data.organic_results || [];
          const isMine = (u) => /aboutwallart\.com/i.test(u || '');
          competitors = organic.filter(o => o.link && !isMine(o.link)).slice(0, 3).map((o, i) => ({ position: i + 1, title: o.title || '', url: o.link }));
          if (!competitors.length) {
            return res.status(200).json({ success: false, needsManual: true, error: 'No competitors found for this keyword — paste 3 competitor URLs.' });
          }
        }

        // Analyse each competitor page (headings + rough word count). Best-effort — never throws.
        const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const analyzed = [];
        for (const c of competitors) {
          try {
            const pr = await fetch(c.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AWA-Bot/1.0)' } });
            const html = await pr.text();
            const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 3);
            const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 15);
            const body = strip(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
            analyzed.push({ url: c.url, title: c.title, h1, h2, words: body ? body.split(' ').length : 0 });
          } catch (e) {
            analyzed.push({ url: c.url, title: c.title, h1: [], h2: [], words: 0, error: 'could not fetch page' });
          }
        }

        let brief;
        try { brief = await generateCompetitorBrief(keyword || (manualUrls[0] || ''), analyzed); }
        catch (e) { return res.status(200).json({ success: false, error: 'Could not build the brief — ' + e.message, competitors: analyzed }); }
        return res.status(200).json({ success: true, keyword, competitors: analyzed, brief });
      }

      // ── ACTION: save-month ── (tag picked blogs with a month, e.g. "2026-03"). New column MONTH (10th).
      // Input: { titles: [...], month: "YYYY-MM" }. Empty month clears the tag.
      if (req.body.action === 'save-month') {
        const titles = Array.isArray(req.body.titles) ? req.body.titles : [];
        const month = String(req.body.month || '').trim();
        if (!titles.length) return res.status(400).json({ error: 'titles array required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        const esc = (c) => {
          const s = String(c == null ? '' : c);
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const want = new Set(titles.map(norm));
        const done = new Set();
        const ideasFile = await getGitHubFile('data/blog_ideas.csv');
        const lines = ideasFile.content.split('\n');
        const updated = lines.map(line => {
          const trimmed = line.trim().replace(/\r/g, '');
          if (!trimmed) return line;
          const cols = parseCSVLine(trimmed);
          if (norm(cols[1]) === 'blog post title') {
            while (cols.length < 10) cols.push('');
            if (!cols[9]) cols[9] = 'MONTH';
            return cols.map(esc).join(',');
          }
          const key = norm(cols[1]);
          if (want.has(key) && !done.has(key)) {
            while (cols.length < 10) cols.push('');
            cols[9] = month;
            done.add(key);
            return cols.map(esc).join(',');
          }
          return line;
        });
        const out = updated.join('\n');
        await updateGitHubFile('data/blog_ideas.csv', out, ideasFile.sha, `Assign month ${month || '(cleared)'}: ${done.size} blogs`);
        return res.status(200).json({ success: true, updated: done.size, month });
      }

      // ── ACTION: save-brief ── (persist a competitor brief per blog so it survives reload + works across days)
      // Input: { title, keyword, brief }. Stored in data/blog-briefs.json keyed by lowercased title.
      if (req.body.action === 'save-brief') {
        const t = String(req.body.title || '').trim();
        const kw = String(req.body.keyword || '').trim();
        const brief = req.body.brief && typeof req.body.brief === 'object' ? req.body.brief : null;
        if (!t) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-briefs.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { keyword: kw, brief, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-briefs.json', JSON.stringify(map, null, 2), sha, `Save competitor brief: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: save-draft ── (persist a written blog so it survives reload / a reset)
      // Input: { title, draft:{bodyHtml,featuredBase,authority,youtube} }. Stored in data/blog-drafts.json keyed by lowercased title.
      if (req.body.action === 'save-draft') {
        const t = String(req.body.title || '').trim();
        const draft = req.body.draft && typeof req.body.draft === 'object' ? req.body.draft : null;
        if (!t || !draft) return res.status(400).json({ error: 'title and draft required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { ...draft, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-drafts.json', JSON.stringify(map, null, 2), sha, `Save blog draft: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: pick-products ── (Products batch, chunk 1: topic-matched products with ALL images, split About Wall Art vs Collective)
      // Input: { keyword, title }. Output: { success, awa:[{gid,title,vendor,handle,url,sku,images:[url]}], collective:[...] }
      if (req.body.action === 'pick-products') {
        const kw = String(req.body.keyword || '').trim();
        const ti = String(req.body.title || '').trim();
        if (!kw && !ti) return res.status(400).json({ error: 'keyword or title required' });
        const AWA_VENDOR = 'About Wall Art';
        // Every blog topic (room / style / colour / occasion) has a matching collection — and a trend PAGE
        // shares its handle with a collection that holds BOTH the wall-art prints AND the partner items.
        // So take the LAST path segment of each cluster URL as a collection handle (works for /collections/<h> AND /pages/<h>).
        let handles = [];
        try {
          const clusters = await generateClusters(kw || ti, ti || kw);
          const tags = [clusters.primaryCluster, ...(clusters.supporting || [])].filter(Boolean);
          for (const tag of tags) {
            const url = CLUSTER_URLS[tag];
            if (!url) continue;
            const h = url.split('?')[0].replace(/\/$/, '').split('/').pop();
            if (h && !handles.includes(h)) handles.push(h);
          }
        } catch (e) { /* fall back below */ }
        // If she picked a trend collection for this blog, use ONLY that collection so EVERY spot
        // (wall-art AND partner) fills from the one collection she chose — no topic guessing mixed in.
        const chosenColl = String(req.body.collectionHandle || '').trim();
        if (chosenColl) handles = [chosenColl];
        if (!handles.length) handles = ['framed-wall-pictures-for-living-room'];

        const seen = new Set();
        const awa = [], coll = [];
        const toProd = (n) => {
          const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
          const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
          return { gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images };
        };
        const PFIELDS = 'id title vendor handle productType status onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        for (const handle of handles) {
          let data;
          try {
            data = await shopifyGraphQL(
              `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:50){ edges{ node{ ${PFIELDS} } } } } }`,
              { handle }
            );
          } catch (e) { continue; }
          const c = data && data.collectionByHandle;
          if (!c || !c.products) continue;
          for (const e of c.products.edges) {
            const n = e.node;
            if (n.status && n.status !== 'ACTIVE') continue; // only ACTIVE products may be picked
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            const p = toProd(n);
            if (p.vendor === AWA_VENDOR) awa.push(p); else coll.push(p);
          }
        }
        // Guarantee prints: if the topic collection(s) gave no About Wall Art prints, fall back to the
        // Living Room Pictures collection and match prints by title to the blog topic (Mae's rule).
        if (!awa.length) {
          const term = (kw || ti).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)[0] || '';
          try {
            const fb = await shopifyGraphQL(
              `query($handle:String!){ collectionByHandle(handle:$handle){ products(first:60){ edges{ node{ ${PFIELDS} } } } } }`,
              { handle: 'framed-wall-pictures-for-living-room' }
            );
            const fc = fb && fb.collectionByHandle;
            const prints = (fc && fc.products ? fc.products.edges : []).map(e => e.node).filter(n => n.vendor === AWA_VENDOR && (!n.status || n.status === 'ACTIVE'));
            const matched = term ? prints.filter(n => (n.title || '').toLowerCase().includes(term)) : [];
            const use = (matched.length ? matched : prints).slice(0, 8);
            for (const n of use) { if (seen.has(n.id)) continue; seen.add(n.id); awa.push(toProd(n)); }
          } catch (e) { /* best effort */ }
        }
        // Match partner items to the blog's NEEDS: topic collection (done above) → the TYPE needed → highest price.
        // Frontend sends needs: [{ topic, type, keys:[...] }]. We return one product per need, aligned in order.
        const needs = Array.isArray(req.body.needs) ? req.body.needs : [];
        const pool = coll.slice().sort((a, b) => b.price - a.price); // highest price first
        const usedC = new Set();
        let collectiveByNeed;
        if (needs.length) {
          collectiveByNeed = needs.map(nd => {
            const keys = Array.isArray(nd.keys) ? nd.keys.map(k => String(k).toLowerCase()).filter(Boolean) : [];
            let p = null;
            if (keys.length) p = pool.find(x => !usedC.has(x.gid) && keys.some(k => ((x.productType || '') + ' ' + (x.title || '')).toLowerCase().includes(k)));
            if (!p && !keys.length) p = pool.find(x => !usedC.has(x.gid)); // "choose freely" → best remaining
            if (p) usedC.add(p.gid);
            return p || null; // no match for this type → null (frontend shows "add by SKU"), never a wrong type
          });
        } else {
          // no needs sent — a few varied highest-price items as a fallback
          const byType = {};
          for (const p of coll) { const t = p.productType || 'Other'; if (!byType[t] || p.price > byType[t].price) byType[t] = p; }
          collectiveByNeed = Object.values(byType).sort((a, b) => b.price - a.price).slice(0, 4);
        }
        // collectivePool = every partner (non-wall-art) product in the collection, so the tool page can
        // show a "choose from this collection" browse under each partner spot (with pictures).
        return res.status(200).json({ success: true, awa: awa.slice(0, 40), collective: collectiveByNeed, collectivePool: coll.slice(0, 60) });
      }

      // ── ACTION: search-wall-art ── (Pick freely: search the WHOLE About Wall Art print range by a word)
      // Input: { term }. Output: { success, products:[{gid,title,vendor,handle,url,sku,images:[url]}] }
      if (req.body.action === 'search-wall-art') {
        const term = String(req.body.term || '').trim().replace(/["\\]/g, '');
        const AWA_VENDOR = 'About Wall Art';
        const PFIELDS = 'id title vendor handle productType status onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        const q = "status:active vendor:'About Wall Art'" + (term ? ' ' + term : '');
        const out = [];
        try {
          const data = await shopifyGraphQL(
            `query($q:String!){ products(first:40, query:$q){ edges{ node{ ${PFIELDS} } } } }`,
            { q }
          );
          const edges = (data && data.products && data.products.edges) || [];
          for (const e of edges) {
            const n = e.node;
            if (n.vendor !== AWA_VENDOR) continue;
            if (n.status && n.status !== 'ACTIVE') continue;
            const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
            const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
            out.push({ gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images });
          }
        } catch (e) { return res.status(200).json({ success: false, error: 'Search failed — try another word.' }); }
        return res.status(200).json({ success: true, products: out });
      }

      // ── ACTION: lookup-product ── (Add a product by its print-files SKU, or by product name)
      // Input: { sku }. Output: { success, product:{gid,title,vendor,handle,url,sku,images:[url]} }
      if (req.body.action === 'lookup-product') {
        const q = String(req.body.sku || '').trim();
        if (!q) return res.status(400).json({ error: 'sku required' });
        const PFIELDS = 'id title vendor handle productType onlineStoreUrl sku:metafield(namespace:"custom",key:"sku_for_print_files"){ value } variants(first:1){ edges{ node{ price } } } media(first:15){ edges{ node{ ... on MediaImage { image{ url } } } } }';
        const toProduct = (n) => {
          const images = (n.media && n.media.edges ? n.media.edges : []).map(m => m.node && m.node.image && m.node.image.url).filter(Boolean);
          const price = parseFloat((n.variants && n.variants.edges[0] && n.variants.edges[0].node.price) || '0') || 0;
          return { gid: n.id, title: n.title || '', vendor: n.vendor || '', handle: n.handle || '', productType: n.productType || '', price, url: n.onlineStoreUrl || ('https://aboutwallart.com/products/' + (n.handle || '')), sku: (n.sku && n.sku.value) || '', images };
        };
        const ql = q.toLowerCase();
        // 1) EXACT print-files SKU only. Fetch a few (the search can prefix-match, e.g. LIVLND1 → LIVLND10)
        //    then keep ONLY the one whose SKU equals what was typed.
        try {
          const d = await shopifyGraphQL(`query($q:String!){ products(first:20, query:$q){ edges{ node{ ${PFIELDS} } } } }`, { q: 'metafield:custom.sku_for_print_files:' + q });
          const nodes = (d.products && d.products.edges || []).map(e => e.node);
          const exact = nodes.find(n => ((n.sku && n.sku.value) || '').toLowerCase() === ql);
          if (exact) return res.status(200).json({ success: true, product: toProduct(exact) });
        } catch (e) { /* try name next */ }
        // 2) name search — only accept a result whose TITLE actually contains what was typed (no unrelated hits).
        try {
          const d = await shopifyGraphQL(`query($q:String!){ products(first:10, query:$q){ edges{ node{ ${PFIELDS} } } } }`, { q: 'title:*' + q.replace(/[*"()]/g, ' ').trim() + '*' });
          const nodes = (d.products && d.products.edges || []).map(e => e.node);
          const hit = nodes.find(n => (n.title || '').toLowerCase().includes(ql));
          if (hit) return res.status(200).json({ success: true, product: toProduct(hit) });
        } catch (e) { /* not found */ }
        return res.status(200).json({ success: false, error: 'No exact match for "' + q + '". Check the print-files SKU, or paste the full product name.' });
      }

      // ── ACTION: product-image ── (Copy image: fetch a Shopify image and return it as base64 for the clipboard)
      // Input: { url }. Output: { ok, dataBase64, mime }
      if (req.body.action === 'product-image') {
        const url = String(req.body.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'valid image url required' });
        try {
          const ir = await fetch(url);
          if (!ir.ok) return res.status(200).json({ ok: false, error: 'image fetch failed: ' + ir.status });
          const mime = ir.headers.get('content-type') || 'image/jpeg';
          const dataBase64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
          return res.status(200).json({ ok: true, mime, dataBase64 });
        } catch (e) {
          return res.status(200).json({ ok: false, error: e.message });
        }
      }

      // ── ACTION: save-products ── (persist the product picks per blog so they survive reload / a reset — no re-fetch, no AI)
      // Input: { title, data }. Stored in data/blog-products.json keyed by lowercased title.
      if (req.body.action === 'save-products') {
        const t = String(req.body.title || '').trim();
        const data = req.body.data && typeof req.body.data === 'object' ? req.body.data : null;
        if (!t || !data) return res.status(400).json({ error: 'title and data required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
        let map = {}, sha;
        try { const f = await getGitHubFile('data/blog-products.json'); map = JSON.parse(f.content || '{}'); sha = f.sha; } catch (e) { map = {}; sha = undefined; }
        map[t.toLowerCase()] = { ...data, savedAt: new Date().toISOString() };
        await updateGitHubFile('data/blog-products.json', JSON.stringify(map, null, 2), sha, `Save blog product picks: ${t}`);
        return res.status(200).json({ success: true });
      }

      // ── ACTION: finish-blog ── (Batch B: fetch the saved images from Shopify Files, drop the scene photos + the 6
      // product blocks into the blog body, and save the finished body so the Publish step can use it.)
      // Input: { title, keyword }. Output: { success, report:[{ok,label,fix}], finishedBody, featuredUrl }.
      if (req.body.action === 'finish-blog') {
        const fbT = String(req.body.title || '').trim();
        const fbKwIn = String(req.body.keyword || '').trim();
        if (!fbT) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

        // 1) load the draft (the blog body) + the saved product picks
        let draftsMap = {}, draftsSha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); draftsMap = JSON.parse(f.content || '{}'); draftsSha = f.sha; } catch (e) { draftsMap = {}; }
        const draft = draftsMap[fbT.toLowerCase()];
        if (!draft || !draft.bodyHtml) return res.status(200).json({ success: false, error: 'No written blog found for "' + fbT + '". Write the blog first (step 2).' });
        let prodMap = {};
        try { const f = await getGitHubFile('data/blog-products.json'); prodMap = JSON.parse(f.content || '{}'); } catch (e) { prodMap = {}; }
        const prods = prodMap[fbT.toLowerCase()] || { awa: [], needs: [], collective: [], extra: [], selected: {}, chosen: {} };
        prods.selected = prods.selected || {}; prods.chosen = prods.chosen || {};

        const fbKw = fbKwIn || prods.keyword || '';
        const report = [];
        const escF = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // the plain name inside a Shopify file URL (lowercased, no extension, no ?v= version)
        const urlName = (u) => { try { const seg = (u || '').split('/files/').pop() || ''; return decodeURIComponent(seg.split('?')[0].replace(/\.[a-z0-9]+$/i, '')).toLowerCase(); } catch (e) { return ''; } };
        // Find a saved image by name. The Files search is fuzzy (word-based), so we ALWAYS filter for the real match.
        // exact=false → the file name must EQUAL the wanted name; prefix=true → it must START WITH it (used for the
        // featured image, so everything after "-option" is ignored).
        async function findImage(name, prefix) {
          const want = String(name || '').toLowerCase();
          if (!want) return null;
          let data;
          try { data = await shopifyGraphQL(`query($q:String!){ files(first:40, query:$q){ edges{ node{ __typename ... on MediaImage { image{ url } } } } } }`, { q: 'filename:' + want }); }
          catch (e) { return null; }
          const nodes = (data && data.files && data.files.edges || []).map(e => e.node).filter(n => n && n.image && n.image.url);
          const hit = nodes.find(n => { const nm = urlName(n.image.url); return prefix ? (nm.indexOf(want) === 0) : (nm === want); });
          return hit ? hit.image.url : null;
        }

        // Same TYPE map the picker uses (to place any add-by-SKU extras into the best free spot).
        const SVR_TYPES = [
          { re: /plant|greenery|fern|succulent|tree|foliage|palm|monstera/, keys: ['plant','fern','succulent','tree','foliage','palm','greenery'] },
          { re: /\bpot\b|planter/, keys: ['pot','planter'] },
          { re: /lamp|light|pendant|sconce|lantern/, keys: ['lamp','light','pendant','sconce','lantern'] },
          { re: /chair|stool|\bseat|sofa|armchair|bench|ottoman/, keys: ['chair','sofa','bench','stool','armchair','ottoman'] },
          { re: /table|desk|console|sideboard|nightstand|bedside/, keys: ['table','desk','console','sideboard'] },
          { re: /\brug\b|carpet/, keys: ['rug','carpet'] },
          { re: /basket|storage|box/, keys: ['basket','storage'] },
          { re: /mirror/, keys: ['mirror'] },
          { re: /vase|vessel/, keys: ['vase','vessel'] },
          { re: /shelf|shelving|ladder/, keys: ['shelf','shelving','ladder'] },
          { re: /cushion|pillow|throw|blanket|textile|linen/, keys: ['cushion','pillow','throw','blanket'] },
          { re: /clock/, keys: ['clock'] },
          { re: /candle/, keys: ['candle'] }
        ];
        const topicKeys = (topic) => { const s = (topic || '').toLowerCase(); for (const t of SVR_TYPES) if (t.re.test(s)) return t.keys; return []; };
        const extraFitsSpot = (topic, p) => { const keys = topicKeys(topic); if (!keys.length) return true; const hay = ((p.productType || '') + ' ' + (p.title || '')).toLowerCase(); return keys.some(k => hay.includes(k)); };
        const slugSku = (p) => String(p.sku || p.handle || 'product').toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-');

        // Build one product block: About Wall Art → the static lifestyle photo saved in Files;
        // Collective (any other vendor) → a LIVE block that hides itself if the product ever goes unavailable.
        // Same block your published blogs use: a centred, full-width image that links to the product,
        // with a black "Shop Here" button under it. Wall art = the saved lifestyle photo; Collective = the
        // product's chosen photo (and it quietly hides itself if that product ever goes unavailable).
        async function productBlock(p) {
          const isAwa = (p.vendor === 'About Wall Art');
          let imgUrl = '';
          if (isAwa) {
            const name = slugSku(p) + '-lifestyle';
            imgUrl = await findImage(name, false);
            if (!imgUrl) return { ok: false, label: 'Wall art photo not found: ' + name, fix: 'Make the lifestyle photo for "' + p.title + '" and save it in Shopify named "' + name + '", then press again.' };
          } else {
            imgUrl = (prods.chosen && prods.chosen[p.gid]) || (p.images && p.images[0]) || '';
            if (!imgUrl) return { ok: false, label: 'No image chosen for: ' + p.title, fix: 'Open “Pick products”, choose an image for "' + p.title + '", save, then press again.' };
            imgUrl = imgUrl + (imgUrl.indexOf('?') >= 0 ? '&' : '?') + 'width=1024';
          }
          const url = p.url || ('https://aboutwallart.com/products/' + (p.handle || ''));
          const alt = altMap['prod:' + p.gid] || ((fbKw ? fbKw + ' — ' : '') + p.title + (isAwa ? ' styled in a room' : ''));
          const inner =
            '<a rel="noopener" href="' + escF(url) + '" target="_blank"><img style="max-width: 1024px; width: 100%; height: auto;" alt="' + escF(alt) + '" src="' + escF(imgUrl) + '"></a>' +
            '<br>' +
            '<a style="display: inline-block; margin-top: 15px; padding: 12px 30px; background-color: #000; color: #fff; text-decoration: none; border-radius: 4px;" rel="noopener" href="' + escF(url) + '" target="_blank">SHOP HERE</a>';
          if (isAwa) {
            return { ok: true, label: 'Wall art product placed: ' + p.title, html: '<div style="text-align: center; margin: 30px 0;">' + inner + '</div>' };
          }
          const handle = p.handle || '';
          const html =
            '<div class="awa-partner" data-handle="' + escF(handle) + '" style="text-align: center; margin: 30px 0;">' + inner + '</div>' +
            '<script>(function(){var s=document.currentScript,el=s&&s.previousElementSibling;if(!el)return;var h=' + JSON.stringify(handle) + ';fetch("/products/"+h+".js").then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(p){if(p&&p.available===false)el.style.display="none";}).catch(function(){el.style.display="none";});})();<\/script>';
          return { ok: true, label: 'Collective product placed (live · auto-hides): ' + p.title, html };
        }

        // Always start from the ORIGINAL body (markers intact) so this step can be run again safely.
        let body = String(draft.bodyHtml);

        // ---- ALT TEXT — real descriptions of what's in each image, with the keyword woven in naturally ----
        // One small AI pass writes every image's alt at once. If the AI is unavailable (e.g. out of credits),
        // we fall back to a readable name + keyword so a blog can still be finished.
        let altMap = {};
        const rawReadable = (fname) => String(fname || '').trim()
          .replace(/\.[a-z0-9]+$/i, '')                 // drop any file extension
          .replace(/-(featured|option)s?(-\d+)?$/i, '') // drop trailing role words + number
          .replace(/-\d+$/, '')                         // drop any remaining trailing number
          .replace(/[-_]+/g, ' ')                       // hyphens/underscores → spaces
          .replace(/\s+/g, ' ').trim();
        const readableAlt = (fname) => (fbKw ? fbKw + ' — ' : '') + (rawReadable(fname) || fbT);

        // ---- FEATURED — one image, ignore everything after "-option" ----
        const featuredBase = draft.featuredBase || '';
        let featuredUrl = '';
        if (featuredBase) {
          featuredUrl = await findImage(featuredBase + '-featured', true);
          if (!featuredUrl) report.push({ ok: false, label: 'Featured image not found', fix: 'Save your favourite featured photo in Shopify with a name starting "' + featuredBase + '-featured-option", then press again.' });
        } else {
          report.push({ ok: false, label: 'This blog has no featured name yet', fix: 'Re-write the blog (step 2) so it has a featured name, then press again.' });
        }

        // ---- SCENE PHOTOS — each [[IMG|name|ratio|kind|prompt]]; keep each photo's own written description for its alt ----
        const imgRe = /<h2[^>]*>([\s\S]*?)<\/h2>|\[\[IMG\|([^|]*)\|([^|]*)\|([^|]*)\|([\s\S]*?)\]\]/g;
        let mm, curSec = '';
        const sceneMarkers = [];
        while ((mm = imgRe.exec(body)) !== null) {
          if (mm[1] !== undefined) curSec = mm[1].replace(/<[^>]+>/g, '').trim();
          else sceneMarkers.push({ full: mm[0], filename: (mm[2] || '').trim(), section: curSec, prompt: (mm[5] || '').trim() });
        }

        // Gather every product that will appear (unique) so its alt can describe the actual product.
        const _seenP = new Set(); const selProducts = [];
        [].concat(prods.prints || [], prods.awa || [], prods.collective || [], prods.extra || []).forEach(p => {
          if (p && p.gid && prods.selected && prods.selected[p.gid] && !_seenP.has(p.gid)) { _seenP.add(p.gid); selProducts.push(p); }
        });

        // One AI pass → a real, unique, SEO-natural alt for every image (featured + scenes + products).
        async function writeAltTexts() {
          try {
            const items = [];
            items.push({ id: 'featured', hint: 'Main featured photo. Shows: ' + (rawReadable(featuredBase) || fbT) });
            sceneMarkers.forEach(s => { const shows = (s.prompt && s.prompt.length > 4) ? s.prompt : (s.section || rawReadable(s.filename)); items.push({ id: 'scene:' + s.filename, hint: 'Scene photo. Shows: ' + shows }); });
            selProducts.forEach(p => { items.push({ id: 'prod:' + p.gid, hint: 'Product photo of "' + (p.title || '') + '"' + (p.productType ? ' (' + p.productType + ')' : '') }); });
            if (!items.length) return {};
            const listTxt = items.map(it => it.id + ' :: ' + it.hint.replace(/\s+/g, ' ').slice(0, 400)).join('\n');
            const prompt = `You are writing image ALT TEXT for a home-decor blog on aboutwallart.com. Use UK spelling ("colour", "decor").
Blog title: "${fbT}". Main keyword: "${fbKw}".

Write ONE alt line for EACH image id below. Each alt MUST:
- DESCRIBE what the image actually shows, concretely, for a blind reader (the room, objects, colours, or the product). 8 to 16 words.
- Read like natural English. Never begin with "image of" or "photo of".
- Include the keyword "${fbKw}" (or a close natural variation) ONLY on the few images where it genuinely fits — do NOT put it on every image, and never stuff it. Most alts should simply describe the image.
- Be different from every other alt.

Images (id :: what it shows):
${listTxt}

Return ONLY a JSON object mapping each id to its alt line, and nothing else.`;
            const raw = await callClaudeText(prompt, 2000);
            const jsonStr = (raw.match(/\{[\s\S]*\}/) || [raw])[0];
            const map = JSON.parse(jsonStr);
            const clean = {};
            Object.keys(map).forEach(k => { if (typeof map[k] === 'string' && map[k].trim()) clean[k] = map[k].trim().replace(/\s+/g, ' '); });
            return clean;
          } catch (e) { return {}; }
        }
        altMap = await writeAltTexts();

        const featuredAlt = altMap['featured'] || readableAlt(featuredBase);
        if (featuredBase && featuredUrl) report.push({ ok: true, label: 'Featured image found — "' + featuredAlt + '"' });

        let sceneOk = 0;
        for (const im of sceneMarkers) {
          const alt = altMap['scene:' + im.filename] || readableAlt(im.filename);
          const url = await findImage(im.filename, false);
          if (url) {
            body = body.split(im.full).join('<div style="text-align: center; margin: 20px 0;"><img style="max-width: 1024px; width: 100%; height: auto;" alt="' + escF(alt) + '" src="' + escF(url) + '"></div>');
            sceneOk++;
          } else {
            report.push({ ok: false, label: 'Photo not saved yet: ' + im.filename, fix: 'Save that image in Shopify with the exact name "' + im.filename + '", then press again.' });
          }
        }
        if (sceneOk) report.push({ ok: true, label: sceneOk + ' scene photo' + (sceneOk === 1 ? '' : 's') + ' placed with alt text' });

        // ---- PRODUCT BLOCKS — the [[PRODUCT|topic]] spots, in order ----
        // Rebuild the picker's alignment: print-type spots ← the chosen prints; the other spots ← the aligned
        // Collective items (one per need). Any add-by-SKU extras fill the best free spot, else go at the end.
        const printRe = /wall art|\bprint|artwork|poster|picture|painting/i;
        const prodMarkers = body.match(/\[\[PRODUCT\|[^\]]*\]\]/g) || [];
        const spots = prodMarkers.map(mk => ({ full: mk, topic: mk.slice(10, -2).trim() }));
        spots.forEach(sp => { sp.kind = printRe.test(sp.topic) ? 'print' : 'need'; sp.product = null; });
        // Prints: prefer the per-spot picks (prods.prints); for any spot without one, fall back to the
        // pool — the auto About Wall Art prints PLUS any About Wall Art print she added by SKU (extras).
        const printsAligned = Array.isArray(prods.prints) ? prods.prints : null;
        const printPool = [
          ...(prods.awa || []).filter(p => p && prods.selected[p.gid]),
          ...(prods.extra || []).filter(p => p && prods.selected[p.gid] && p.vendor === 'About Wall Art')
        ];
        const collAligned = prods.collective || [];
        let pi = 0, ni = 0;
        spots.forEach(sp => {
          if (sp.kind === 'print') {
            let pp = (printsAligned && printsAligned[pi] && prods.selected[printsAligned[pi].gid]) ? printsAligned[pi] : null;
            if (!pp) pp = printPool[pi] || null;
            pi++;
            sp.product = (pp && prods.selected[pp.gid]) ? pp : null;
          } else { const cp = collAligned[ni++]; sp.product = (cp && prods.selected[cp.gid]) ? cp : null; }
        });
        // extras → first fill any EMPTY spot they fit; the rest go into the best-matching H2 below
        const extrasSel = (prods.extra || []).filter(p => p && prods.selected[p.gid]);
        extrasSel.forEach(ex => { const spot = spots.find(sp => !sp.product && extraFitsSpot(sp.topic, ex)); if (spot) spot.product = ex; });

        // place the in-body [[PRODUCT]] spots first
        for (const sp of spots) {
          if (!sp.product) { report.push({ ok: false, label: 'No product chosen for a spot: ' + sp.topic, fix: 'Open “Pick products”, choose an item for “' + sp.topic + '”, save, then press again.' }); continue; }
          const r = await productBlock(sp.product);
          report.push({ ok: r.ok, label: r.label, fix: r.fix });
          if (r.ok) body = body.split(sp.full).join(r.html); // leave the marker if it failed, so a re-run can fix it
        }

        // anything selected but NOT placed in a spot → drop into the H2 section it fits best (closest if none). Never at the end.
        const placedGids = new Set(spots.filter(s => s.product).map(s => s.product.gid));
        const leftovers = [];
        printPool.forEach(p => { if (p && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        (Array.isArray(prods.prints) ? prods.prints : []).forEach(p => { if (p && prods.selected[p.gid] && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        collAligned.forEach(p => { if (p && prods.selected[p.gid] && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });
        extrasSel.forEach(p => { if (p && !placedGids.has(p.gid)) { leftovers.push(p); placedGids.add(p.gid); } });

        const productTermsFor = (p) => {
          const keys = [];
          const hay = ((p.productType || '') + ' ' + (p.title || '')).toLowerCase();
          for (const t of SVR_TYPES) if (t.re.test(hay)) keys.push(...t.keys);
          (p.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).forEach(w => keys.push(w));
          return [...new Set(keys)];
        };
        // Insert a block at the end of the H2 section whose heading/text best fits the product; ties/none → closest (first-highest).
        const insertIntoBestH2 = (html, block, p) => {
          const parts = html.split(/(?=<h2)/); // parts[0] = intro; each later part begins with an <h2>
          if (parts.length < 2) return html + '\n' + block;
          // never insert into or after the video (WATCH) section — the video is the last visual piece
          let videoI = parts.length;
          for (let i = 1; i < parts.length; i++) { if (/youtube\.com\/embed|watch:/i.test(parts[i])) { videoI = i; break; } }
          const terms = productTermsFor(p);
          let bestI = 1, bestScore = -1;
          for (let i = 1; i < videoI; i++) {
            const hm = parts[i].match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
            const head = hm ? hm[1].replace(/<[^>]+>/g, '').toLowerCase() : '';
            const secText = parts[i].replace(/<[^>]+>/g, ' ').toLowerCase();
            let score = 0;
            for (const t of terms) { if (head.includes(t)) score += 3; else if (secText.includes(t)) score += 1; }
            if (score > bestScore) { bestScore = score; bestI = i; }
          }
          if (bestI >= videoI) bestI = Math.max(1, videoI - 1); // safety: stay before the video
          parts[bestI] = parts[bestI] + '\n' + block;
          return parts.join('');
        };

        for (const p of leftovers) {
          const r = await productBlock(p);
          report.push({ ok: r.ok, label: (r.ok ? 'Placed in best-matching section: ' + p.title : r.label), fix: r.fix });
          if (r.ok) body = insertIntoBestH2(body, r.html, p);
        }

        // ---- SAVE the finished body next to the draft (bodyHtml stays untouched so this can be re-run) ----
        draftsMap[fbT.toLowerCase()] = { ...draft, finishedBody: body, featuredUrl, featuredAlt, finished: true, finishedAt: new Date().toISOString() };
        try { await updateGitHubFile('data/blog-drafts.json', JSON.stringify(draftsMap, null, 2), draftsSha, `Finish blog body: ${fbT}`); }
        catch (e) { return res.status(200).json({ success: false, error: 'Built the blog but could not save it: ' + e.message, report }); }
        report.push({ ok: true, label: 'Finished blog saved — ready for the Publish step' });
        return res.status(200).json({ success: true, report, finishedBody: body, featuredUrl });
      }

      // ── ACTION: publish-blog ── (STAGE 3: create + schedule the finished blog on Shopify, fill every
      // metafield / tag / SEO field, register it in the blog index, add the auto-link rule + reciprocal
      // links from the related older blogs, prepare the Google reindex, mark it done + clear the month.)
      // Input: { title, keyword }. Output: { success, report:[{ok,label,fix,copy}], articleUrl, adminUrl, gscUrl, month, monthCleared, monthLeft }.
      if (req.body.action === 'publish-blog') {
        const pbTitle = String(req.body.title || '').trim();
        const pbKwIn  = String(req.body.keyword || '').trim();
        if (!pbTitle) return res.status(400).json({ error: 'title required' });
        if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

        const report = [];
        const NEWS_BLOG_GID = 'gid://shopify/Blog/93572858142';
        const ORIGIN = 'https://aboutwallart.com';
        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const norm = (s) => String(s || '').trim().toLowerCase();

        // 1) load the finished blog + the saved product picks
        let draftsMap = {}, draftsSha;
        try { const f = await getGitHubFile('data/blog-drafts.json'); draftsMap = JSON.parse(f.content || '{}'); draftsSha = f.sha; } catch (e) { draftsMap = {}; }
        const draft = draftsMap[pbTitle.toLowerCase()];
        if (!draft) return res.status(200).json({ success: false, error: 'No blog found for "' + pbTitle + '". Write + finish it first.' });
        if (!draft.finished || !draft.finishedBody) return res.status(200).json({ success: false, error: 'This blog is not finished yet — do step 5 (Images saved — fetch & finish) first.' });
        if (draft.publishedArticleId) return res.status(200).json({ success: false, alreadyDone: true, error: 'This blog is already on Shopify (published ' + (draft.publishedAt || '') + '). Delete it there first if you want to publish it again.', articleUrl: draft.publishedHandle ? (ORIGIN + '/blogs/news-articles-home-decor-inspiration/' + draft.publishedHandle) : '' });

        let prodMap = {};
        try { const f = await getGitHubFile('data/blog-products.json'); prodMap = JSON.parse(f.content || '{}'); } catch (e) { prodMap = {}; }
        const prods = prodMap[pbTitle.toLowerCase()] || { awa: [], collective: [], extra: [], selected: {} };
        prods.selected = prods.selected || {};

        const keyword = pbKwIn || prods.keyword || draft.keyword || '';
        const body = String(draft.finishedBody);
        const bodyText = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
        let handle = slugify(pbTitle).slice(0, 110) || slugify(keyword);
        const featuredUrl = draft.featuredUrl || '';
        const featuredAlt = draft.featuredAlt || ((keyword ? keyword + ' — ' : '') + pbTitle);
        const brief = (draft.brief && typeof draft.brief === 'object') ? draft.brief : {};
        const faqCount = Math.max(3, Math.min(5, parseInt(brief.faqCount) || 4));

        // ---- 2) SEO boxes + snippets (ONE AI call, strict JSON, formats copied from the live blogs) ----
        let boxes = {};
        try {
          const seoPrompt = `You are writing the SEO metafields for a NEW About Wall Art blog. UK spelling. Always "decor", never "décor".
Blog title: "${pbTitle}"
Main keyword: "${keyword}"
Blog text (for context): """${bodyText}"""

Return ONE valid JSON object, no code fences, exactly these keys:
{
"seoTitle": "SEO page title, 60 characters or fewer, includes the keyword naturally",
"metaDescription": "Google meta description, 155 characters or fewer, keyword near the start, one or two clean sentences. NO shipping line. No quotes.",
"excerpt": "2 to 3 sentence plain-text summary, no HTML, keyword once, warm and specific",
"relatedQuestions": "HTML only: <h2>People Also Ask About [topic]</h2> then 3 or 4 <p><strong>Question?</strong> Short answer.</p>. Use only h2, p and strong. No ul, li, br or div.",
"summaryBlock": "HTML only: <h2>Summary: [Topic]</h2> then 5 to 7 <p><strong>Label:</strong> point.</p>. Use only h2, p and strong.",
"comparisonSnippet": "ALWAYS find the most genuine, useful comparison angle for THIS topic (two or more real options / materials / styles / approaches relevant to it, e.g. real plants vs artificial vs botanical art for dark rooms) and write it as HTML: <h2>...</h2><p><strong>...:</strong> ...</p>. Return an empty string ONLY if there is truly no sensible comparison at all.",
"peopleAlsoAsk": "PLAIN TEXT in this EXACT shape: first line 'Frequently Asked Questions About [Topic]', then a blank line, then ${faqCount} pairs, each pair being '**Q: the question?**' on one line and 'A: the answer.' on the next line, with a blank line between pairs. No HTML.",
"completeTheLook": "short single-line heading, e.g. 'Complete Your Bedroom Look'",
"homeDecorTrendsTitle": "short single-line SEO heading for a trends section about this topic",
"isHowTo": true or false (true ONLY if this blog is a genuine step-by-step how-to),
"howToName": "if isHowTo a short how-to name, else empty string",
"howToDescription": "if isHowTo one sentence, else empty string",
"howToSteps": "if isHowTo an array of 3 to 6 real steps from the blog as {\\"name\\":\\"...\\",\\"text\\":\\"...\\"}, else an empty array"
}
Return only the JSON.`;
          let raw = await callClaudeText(seoPrompt, 2600);
          raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          const m = raw.match(/\{[\s\S]*\}/);
          boxes = m ? JSON.parse(m[0]) : {};
        } catch (e) { boxes = {}; report.push({ ok: false, label: 'Could not auto-write the SEO boxes', fix: 'Press Publish again. The blog still gets created either way — you can add the boxes by hand.' }); }

        const seoTitle = String(boxes.seoTitle || pbTitle).slice(0, 70);
        const metaDescription = String(boxes.metaDescription || '').slice(0, 160);
        const excerpt = String(boxes.excerpt || '');
        // How-To schema — Money Page Doctor's exact format (JSON-LD in a script tag), only for real how-tos
        let howToSchema = '';
        if (boxes.isHowTo && Array.isArray(boxes.howToSteps) && boxes.howToSteps.length) {
          const obj = { '@context': 'https://schema.org', '@type': 'HowTo', name: String(boxes.howToName || pbTitle), description: String(boxes.howToDescription || ''), step: boxes.howToSteps.map(s => ({ '@type': 'HowToStep', name: String(s.name || ''), text: String(s.text || '') })) };
          howToSchema = '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>';
        }

        // ---- 3) Tags (reuse the existing tag-maker) ----
        let tags = [];
        try { const c = await generateClusters(keyword, pbTitle); tags = [c.primaryCluster, c.intentTag, ...(c.supporting || [])].filter(Boolean); }
        catch (e) { report.push({ ok: false, label: 'Could not auto-pick the tags', fix: 'The blog still publishes — add tags by hand, or press Publish again.' }); }

        // ---- 4) Internal-link boxes (same logic as Money Page Doctor) ----
        const LINK_STOP = new Set(['art','wall','decor','home','print','prints','canvas','ideas','idea','guide','best','with','from','your','this','that','have','into','about','and','the','for','are','you','trend','trends','interior','design','style','room','living']);
        let linkedCollections = [], linkedTrends = [], linkedBlogs = [], relatedBlogObjs = [];
        try {
          const hayWords = new Set(((keyword + ' ' + tags.slice(0, 6).join(' ') + ' ' + pbTitle).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !LINK_STOP.has(w)));
          const q = keyword.replace(/["\\]/g, ' ').trim();
          if (q && hayWords.size) {
            const d = await shopifyGraphQL(`{ collections(first:30, query:${JSON.stringify(q)}){ edges{ node{ id title handle } } } }`);
            const nodes = (d && d.collections ? d.collections.edges.map(e => e.node) : []);
            linkedCollections = nodes.map(n => { const cw = (n.title || '').toLowerCase().match(/[a-z]+/g) || []; let sc = 0; cw.forEach(w => { if (hayWords.has(w)) sc++; }); return { gid: n.id, sc }; }).filter(c => c.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3).map(c => c.gid);
          }
        } catch (e) {}
        // Fallback: if the keyword search found no collections, use the topic's own cluster collections (tags → CLUSTER_URLS).
        if (!linkedCollections.length) {
          try {
            const handles = [];
            for (const tag of tags) { const u = CLUSTER_URLS[tag]; if (!u || !/\/collections\//.test(u)) continue; const h = u.split('?')[0].replace(/\/$/, '').split('/').pop(); if (h && !handles.includes(h)) handles.push(h); }
            for (const h of handles.slice(0, 3)) {
              const cd = await shopifyGraphQL(`query($h:String!){ collectionByHandle(handle:$h){ id } }`, { h });
              const cgid = cd && cd.collectionByHandle && cd.collectionByHandle.id;
              if (cgid && !linkedCollections.includes(cgid)) linkedCollections.push(cgid);
            }
          } catch (e) {}
        }
        try {
          const hay = (keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase();
          const d = await shopifyGraphQL(`{ pages(first:100){ edges{ node{ id title handle } } } }`);
          const pages = (d && d.pages ? d.pages.edges.map(e => e.node) : []).filter(p => /trend/i.test(p.title || ''));
          linkedTrends = pages.map(p => { const ws = (p.title || '').toLowerCase().match(/[a-z]+/g) || []; let sc = 0; ws.forEach(w => { if (w.length > 3 && !LINK_STOP.has(w) && hay.includes(w)) sc++; }); return { gid: p.id, sc }; }).filter(t => t.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 2).map(t => t.gid);
        } catch (e) {}
        try {
          const idxFile = await getGitHubFile('data/blog-index.json');
          const idx = JSON.parse(idxFile.content || '{}');
          const all = Array.isArray(idx.articles) ? idx.articles : [];
          const hay = new Set(((keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !LINK_STOP.has(w)));
          // Inbound-link count per blog (how many blogs already link to it) → spread link equity: fewest first.
          const inbound = {};
          try {
            let cursor = null, pg = 0;
            while (pg < 6) { pg++;
              const q = await shopifyGraphQL(`query($c:String){ articles(first:250, after:$c, query:"blog_id:93572858142"){ pageInfo{ hasNextPage endCursor } edges{ node{ metafield(namespace:"custom", key:"linked_blogs"){ value } } } } }`, { c: cursor });
              const conn = q && q.articles; if (!conn) break;
              for (const e of conn.edges) { let v = []; try { v = JSON.parse((e.node.metafield && e.node.metafield.value) || '[]'); } catch (e2) {} (Array.isArray(v) ? v : []).forEach(g => { inbound[g] = (inbound[g] || 0) + 1; }); }
              if (!conn.pageInfo.hasNextPage) break; cursor = conn.pageInfo.endCursor;
            }
          } catch (e) {}
          const candidates = all.filter(a => a.gid && norm(a.handle) !== norm(handle) && norm(a.title) !== norm(pbTitle))
            .map(a => { const ws = ((a.title || '') + ' ' + (a.tags || []).join(' ')).toLowerCase().match(/[a-z]+/g) || []; let sc = 0; const seen = new Set(); ws.forEach(w => { if (hay.has(w) && !seen.has(w)) { sc++; seen.add(w); } }); return { gid: a.gid, handle: a.handle, sc, inb: inbound[a.gid] || 0 }; })
            .filter(a => a.sc > 0);
          // topic-relevant only, then among them prefer the ones with the FEWEST inbound links (spread evenly).
          candidates.sort((a, b) => (a.inb - b.inb) || (b.sc - a.sc));
          relatedBlogObjs = candidates.slice(0, 3);
          linkedBlogs = relatedBlogObjs.map(a => a.gid);
        } catch (e) {}

        // ---- 5) Shoppable gallery — match by meaning, blank if no clear fit (never a default) ----
        let galleryId = '', bestGallery = null, galleriesList = [];
        const galleryProductGids = (g, exclude) => {
          const ex = new Set(exclude || []);
          const items = ((g && g.images) || [])
            .map(im => ({ gid: im.productId ? ('gid://shopify/Product/' + im.productId) : '', price: parseFloat(im.productPrice) || 0 }))
            .filter(x => x.gid && !ex.has(x.gid))
            .sort((a, b) => b.price - a.price);
          const seen = new Set(), out = [];
          for (const x of items) { if (!seen.has(x.gid)) { seen.add(x.gid); out.push(x.gid); } }
          return out.slice(0, 2); // 2 priciest = the Collective / partner items in the gallery
        };
        try {
          const gf = await getGitHubFile('data/galleries.json');
          const gsRaw = JSON.parse(gf.content || '[]');
          const arr = Array.isArray(gsRaw) ? gsRaw : (gsRaw.galleries || []);
          galleriesList = arr.filter(g => g && g.id != null && (!g.status || g.status === 'active')).map(g => ({ id: g.id, title: g.title || String(g.id) }));
          const hay = (keyword + ' ' + pbTitle + ' ' + tags.join(' ')).toLowerCase();
          let best = null, bestSc = 0;
          for (const g of arr) {
            if (!g || (g.status && g.status !== 'active') || g.id == null) continue;
            const words = ((g.title || '') + ' ' + (g.description || '')).toLowerCase().match(/[a-z]+/g) || [];
            let sc = 0; const seen = new Set();
            words.forEach(w => { if (w.length > 3 && !LINK_STOP.has(w) && hay.includes(w) && !seen.has(w)) { sc++; seen.add(w); } });
            if (sc > bestSc) { bestSc = sc; best = g; }
          }
          if (best && bestSc >= 1) { galleryId = String(best.id); bestGallery = best; } // one clear style word is enough
        } catch (e) {}

        // ---- 6) blog_products_list — 2 About Wall Art (priciest) + 2 from the matched gallery's collection
        //      (priciest = the Collective / partner items). No gallery yet → just the 2 About Wall Art; when she
        //      picks a gallery from the report, its 2 get added (set-blog-gallery). Separate from the body products.
        const awaGids = (prods.awa || []).filter(p => p && p.gid).sort((a, b) => (b.price || 0) - (a.price || 0)).map(p => p.gid).slice(0, 2);
        const galleryGids = bestGallery ? galleryProductGids(bestGallery, awaGids) : [];
        const productGids = [...awaGids, ...galleryGids].slice(0, 4);

        // ---- 7) Schedule — the first free day; today → 19:00 UK, any future day → 10:00 UK, one per day ----
        function londonOffsetMin(date) { const u = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })); const l = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/London' })); return Math.round((l - u) / 60000); }
        function ukIso(y, m0, d, hour) { const g = new Date(Date.UTC(y, m0, d, hour, 0, 0)); const off = londonOffsetMin(g); return new Date(g.getTime() - off * 60000).toISOString(); }
        let publishIso, scheduledToday = false;
        try {
          const d = await shopifyGraphQL(`{ articles(first:5, query:"blog_id:93572858142", sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ publishedAt } } } }`);
          const dates = (d && d.articles ? d.articles.edges : []).map(e => e.node.publishedAt).filter(Boolean).map(s => new Date(s));
          // ALSO read the blog list file — it includes hidden/scheduled blogs that Shopify's date-sorted query leaves out,
          // so scheduled-but-not-yet-live blogs no longer get ignored (which used to stack every new blog on the same day).
          try {
            const idxF = await getGitHubFile('data/blog-index.json');
            const idxJson = JSON.parse(idxF.content || '{}');
            (idxJson.articles || []).forEach(a => { if (a.publishedAt) dates.push(new Date(a.publishedAt)); });
          } catch (eIdx) {}
          const last = dates.length ? new Date(Math.max(...dates.map(x => x.getTime()))) : null;
          const nowUk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
          const todayMid = Date.UTC(nowUk.getFullYear(), nowUk.getMonth(), nowUk.getDate());
          let candMid = todayMid;
          if (last) { const lu = new Date(last.toLocaleString('en-US', { timeZone: 'Europe/London' })); const lNext = Date.UTC(lu.getFullYear(), lu.getMonth(), lu.getDate()) + 86400000; if (lNext > candMid) candMid = lNext; }
          scheduledToday = candMid === todayMid;
          const cd = new Date(candMid);
          publishIso = ukIso(cd.getUTCFullYear(), cd.getUTCMonth(), cd.getUTCDate(), scheduledToday ? 19 : 10);
        } catch (e) {
          const nowUk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
          scheduledToday = true;
          publishIso = ukIso(nowUk.getFullYear(), nowUk.getMonth(), nowUk.getDate(), 19);
        }

        // ---- 8) Create the blog on Shopify (Hidden until its date, right template + author) ----
        const mf = [];
        const addMf = (ns, key, type, value) => { if (value === '' || value == null) return; mf.push({ namespace: ns, key, type, value: String(value) }); };
        const addRef = (key, type, gids) => { if (gids && gids.length) mf.push({ namespace: 'custom', key, type, value: JSON.stringify(gids) }); };
        addMf('global', 'title_tag', 'single_line_text_field', seoTitle);
        addMf('global', 'description_tag', 'single_line_text_field', metaDescription);
        addMf('custom', 'ai_related_questions', 'multi_line_text_field', boxes.relatedQuestions || '');
        addMf('custom', 'ai_summary_block', 'multi_line_text_field', boxes.summaryBlock || '');
        addMf('custom', 'ai_comparison_snippet', 'multi_line_text_field', boxes.comparisonSnippet || '');
        addMf('custom', 'people_also_ask_new', 'multi_line_text_field', boxes.peopleAlsoAsk || '');
        addMf('custom', 'ai_how_to_schema_markup', 'multi_line_text_field', howToSchema);
        addMf('custom', 'complete_the_look', 'single_line_text_field', boxes.completeTheLook || '');
        addMf('custom', 'home_decor_trends_title', 'single_line_text_field', boxes.homeDecorTrendsTitle || '');
        addMf('custom', 'shoppable_gallery_new', 'number_integer', galleryId);
        addRef('linked_collections', 'list.collection_reference', linkedCollections);
        addRef('linked_blogs', 'list.article_reference', linkedBlogs);
        addRef('linked_trends', 'list.page_reference', linkedTrends);
        addRef('blog_products_list', 'list.product_reference', productGids);

        const articleInput = {
          blogId: NEWS_BLOG_GID,
          title: pbTitle,
          handle,
          body,
          summary: excerpt || undefined,
          author: { name: 'Mae Osz' },
          // Scheduling: give the future publish date and DON'T flag it published-now.
          // Shopify rejects isPublished:true together with a future publishDate; false + a future
          // date = scheduled (hidden until then, auto-publishes on the date).
          isPublished: false,
          publishDate: publishIso,
          templateSuffix: 'full-metafields-blog-post',
          tags,
          metafields: mf
        };
        if (featuredUrl) articleInput.image = { url: featuredUrl, altText: featuredAlt };

        async function tryCreate(input) {
          const d = await shopifyGraphQL(`mutation($article:ArticleCreateInput!){ articleCreate(article:$article){ article{ id handle } userErrors{ field message } } }`, { article: input });
          const ac = d && d.articleCreate;
          if (ac && ac.article) return { article: ac.article };
          return { error: (ac && ac.userErrors && ac.userErrors[0] && ac.userErrors[0].message) || 'unknown error' };
        }
        let created = null, createErr = '';
        try {
          let r = await tryCreate(articleInput);
          if (r.error && /handle/i.test(r.error)) { articleInput.handle = handle + '-' + Date.now().toString().slice(-4); r = await tryCreate(articleInput); }
          if (r.article) created = r.article; else createErr = r.error;
        } catch (e) { createErr = e.message; }

        if (!created) {
          report.unshift({ ok: false, label: 'Could not create the blog on Shopify: ' + createErr, fix: 'Nothing was published. Fix the message above, then press Publish again.' });
          return res.status(200).json({ success: false, report, error: createErr });
        }
        const finalHandle = created.handle || handle;
        const articleGid = created.id;
        const articleUrl = ORIGIN + '/blogs/news-articles-home-decor-inspiration/' + finalHandle;
        const adminId = (articleGid || '').split('/').pop();
        const storeHandle = (process.env.SHOPIFY_STORE_DOMAIN || '').split('.')[0] || 'aboutwallart';
        const whenTxt = new Date(publishIso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

        report.unshift({ ok: true, label: 'Blog created on Shopify — scheduled for ' + whenTxt + ' (UK), hidden until then' });
        report.push({ ok: true, label: mf.length + ' template boxes + SEO fields filled' });
        report.push({ ok: (tags.length > 0), label: tags.length ? ('Tags: ' + tags.join(', ')) : 'No tags set', fix: tags.length ? undefined : 'Add tags by hand in Shopify.' });
        report.push({ ok: !!featuredUrl, label: featuredUrl ? 'Featured image + alt set' : 'No featured image set', fix: featuredUrl ? undefined : 'Set the featured image on the blog in Shopify.' });
        if (boxes.peopleAlsoAsk) report.push({ ok: true, label: faqCount + ' People-Also-Ask questions + FAQ schema' });
        report.push({ ok: true, label: howToSchema ? 'How-To step schema added — glance it renders on this first how-to' : 'Not a how-to blog — step schema skipped (correct)' });
        if (galleryId) report.push({ ok: true, label: 'Shoppable gallery matched (#' + galleryId + ')' });
        report.push({ ok: true, label: 'Internal links — collections: ' + linkedCollections.length + ', trends: ' + linkedTrends.length + ', related blogs: ' + linkedBlogs.length });
        report.push({ ok: true, label: 'Product list — ' + productGids.length + ' product' + (productGids.length === 1 ? '' : 's') });

        // ---- 9) Register into the blog index ----
        try {
          const f = await getGitHubFile('data/blog-index.json');
          const idx = JSON.parse(f.content || '{}');
          idx.articles = Array.isArray(idx.articles) ? idx.articles : [];
          if (!idx.articles.some(a => norm(a.handle) === norm(finalHandle))) {
            idx.articles.unshift({ gid: articleGid, handle: finalHandle, title: pbTitle, tags, blogHandle: 'news-articles-home-decor-inspiration', publishedAt: publishIso });
            idx.count = idx.articles.length; idx.updatedAt = new Date().toISOString();
            await updateGitHubFile('data/blog-index.json', JSON.stringify(idx, null, 2), f.sha, 'Register new blog: ' + pbTitle);
          }
          report.push({ ok: true, label: 'Added to your blog list (so other blogs can link to it)' });
        } catch (e) { report.push({ ok: false, label: 'Could not add it to your blog list', fix: 'Run "Rebuild blog index" later — it will be picked up then.' }); }

        // ---- 10) Auto-link rule ----
        if (keyword) {
          try {
            const f = await getGitHubFile('data/autolink-rules.json');
            const rules = JSON.parse(f.content || '[]');
            if (!rules.some(r => norm(r.keyword) === norm(keyword))) {
              const maxId = rules.reduce((mx, r) => Math.max(mx, parseInt(r.id) || 0), 0);
              rules.unshift({ id: maxId + 1, keyword, url: '/blogs/news-articles-home-decor-inspiration/' + finalHandle, linksAdded: 0, verified: 'ok' });
              await updateGitHubFile('data/autolink-rules.json', JSON.stringify(rules, null, 2), f.sha, 'Auto-link rule for new blog: ' + keyword);
              report.push({ ok: true, label: 'Auto-link rule added ("' + keyword + '" → this blog)' });
            } else { report.push({ ok: true, label: 'Auto-link rule already existed for "' + keyword + '"' }); }
          } catch (e) { report.push({ ok: false, label: 'Could not add the auto-link rule', fix: 'Add it by hand in Auto-Link.', copy: keyword + ' → /blogs/news-articles-home-decor-inspiration/' + finalHandle }); }
        }

        // ---- 10b) Lock the keyword in the registry so it can't be reused for other content ----
        if (keyword) {
          try {
            const reg = await getGitHubFile('data/keyword-locker-registry.csv');
            const rlines = reg.content.split('\n').map(l => l.replace(/\r/g, ''));
            const csvQ = (s) => { s = String(s == null ? '' : s); return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const kwLow = keyword.toLowerCase();
            const already = rlines.some(line => { if (!line.trim()) return false; const c = parseCSVLine(line); const locked = (c[2] || '').toUpperCase(); const st = (c[3] || '').toUpperCase(); const ac = (c[4] || '').toUpperCase(); return (c[0] || '').toLowerCase() === kwLow && locked === 'LOCKED' && st === 'DONE' && (ac === 'TO_OPTIMIZE' || ac === 'OPTIMIZED'); });
            if (already) { report.push({ ok: true, label: 'Keyword already locked in the registry ("' + keyword + '")' }); }
            else {
              const row = `${csvQ(keyword)},${csvQ(articleUrl)},LOCKED,DONE,OPTIMIZED,N/A,N/A,N/A,N/A,Blog published,Informational,`;
              const updated = rlines.join('\n').replace(/\n+$/, '') + '\n' + row + '\n';
              await updateGitHubFile('data/keyword-locker-registry.csv', updated, reg.sha, 'Lock blog keyword: ' + keyword);
              report.push({ ok: true, label: 'Keyword locked in the registry ("' + keyword + '") — won\'t be reused for other content' });
            }
          } catch (e) { report.push({ ok: false, label: 'Could not lock the keyword in the registry', fix: 'Lock it by hand in the Keyword Locker.', copy: keyword + ' → ' + articleUrl }); }
        }

        // ---- 11) Reciprocal links — add THIS blog to the related older blogs' "You may also read" box ----
        if (relatedBlogObjs.length) {
          let done = 0;
          for (const rb of relatedBlogObjs) {
            try {
              const qd = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { metafield(namespace:"custom", key:"linked_blogs"){ value } } } }`, { id: rb.gid });
              let cur = [];
              try { cur = JSON.parse((qd && qd.node && qd.node.metafield && qd.node.metafield.value) || '[]'); } catch (e2) { cur = []; }
              if (!Array.isArray(cur)) cur = [];
              if (!cur.includes(articleGid)) {
                cur.push(articleGid);
                const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [{ ownerId: rb.gid, namespace: 'custom', key: 'linked_blogs', type: 'list.article_reference', value: JSON.stringify(cur) }] });
                if (!(sd && sd.metafieldsSet && sd.metafieldsSet.userErrors && sd.metafieldsSet.userErrors.length)) done++;
              } else { done++; }
            } catch (e) {}
          }
          report.push({ ok: done > 0, label: done + ' older blog' + (done === 1 ? '' : 's') + ' now link back to this one (helps it get found)', fix: done ? undefined : 'None added — not critical.' });
        }

        // ---- 12) Mark it done in your list + clear the month when it is empty ----
        let month = '', monthCleared = false, monthLeft = 0;
        try {
          const f = await getGitHubFile('data/blog_ideas.csv');
          const lines = f.content.split('\n');
          const esc = (c) => { const s = String(c == null ? '' : c); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
          const out = lines.map(line => {
            const trimmed = line.trim().replace(/\r/g, '');
            if (!trimmed) return line;
            const cols = parseCSVLine(trimmed);
            if (norm(cols[1]) === 'blog post title') return line;
            if (norm(cols[1]) === norm(pbTitle)) {
              while (cols.length < 10) cols.push('');
              month = cols[9] || '';
              cols[5] = 'PUBLISHED';
              cols[9] = '';
              return cols.map(esc).join(',');
            }
            return line;
          });
          if (month) {
            for (const line of out) { const t = line.trim().replace(/\r/g, ''); if (!t) continue; const cols = parseCSVLine(t); if (norm(cols[1]) === 'blog post title') continue; if ((cols[9] || '') === month) monthLeft++; }
            monthCleared = monthLeft === 0;
          }
          await updateGitHubFile('data/blog_ideas.csv', out.join('\n'), f.sha, 'Blog published: ' + pbTitle);
          report.push({ ok: true, label: month ? (monthCleared ? 'Marked done — that whole month is now sent 🎉' : ('Marked done in your list (' + monthLeft + ' left this month)')) : 'Marked done in your list' });
        } catch (e) { report.push({ ok: false, label: 'Could not update your blog list', fix: 'Mark it done by hand later.' }); }

        // ---- 13) Remember it is published (so it is not published twice) ----
        try {
          draftsMap[pbTitle.toLowerCase()] = { ...draft, published: true, publishedArticleId: articleGid, publishedHandle: finalHandle, publishedAt: publishIso };
          await updateGitHubFile('data/blog-drafts.json', JSON.stringify(draftsMap, null, 2), draftsSha, 'Mark blog published: ' + pbTitle);
        } catch (e) {}

        // ---- 14) Google reindex link (manual click, as Money Page Doctor does) ----
        const gscUrl = 'https://search.google.com/search-console/inspect?resource_id=' + encodeURIComponent('sc-domain:aboutwallart.com') + '&id=' + encodeURIComponent(articleUrl);
        report.push({ ok: true, label: 'Ready for Google — use the "Request indexing" button below' });

        // Any fillable box that came out EMPTY → an "add it yourself" row (never a dead end).
        const fillable = [
          { key: 'ai_comparison_snippet', type: 'multi_line_text_field', kind: 'text', label: 'AI Comparison Snippet', has: !!boxes.comparisonSnippet },
          { key: 'ai_summary_block', type: 'multi_line_text_field', kind: 'text', label: 'AI Summary Block', has: !!boxes.summaryBlock },
          { key: 'ai_related_questions', type: 'multi_line_text_field', kind: 'text', label: 'AI Related Questions', has: !!boxes.relatedQuestions },
          { key: 'people_also_ask_new', type: 'multi_line_text_field', kind: 'text', label: 'People Also Ask', has: !!boxes.peopleAlsoAsk },
          { key: 'complete_the_look', type: 'single_line_text_field', kind: 'line', label: 'Complete the Look title', has: !!boxes.completeTheLook },
          { key: 'home_decor_trends_title', type: 'single_line_text_field', kind: 'line', label: 'Home Decor Trends title', has: !!boxes.homeDecorTrendsTitle },
          { key: 'shoppable_gallery_new', type: 'number_integer', kind: 'gallery', label: 'Shoppable Gallery — pick one (it also adds its 2 products to the Product List)', has: !!galleryId },
          { key: 'linked_collections', type: 'list.collection_reference', kind: 'urls', label: 'Linked Collections (paste collection URLs, one per line)', has: linkedCollections.length > 0 },
          { key: 'linked_trends', type: 'list.page_reference', kind: 'urls', label: 'Linked Trends (paste trend-page URLs, one per line)', has: linkedTrends.length > 0 },
          { key: 'linked_blogs', type: 'list.article_reference', kind: 'urls', label: 'Linked Blogs (paste blog URLs, one per line)', has: linkedBlogs.length > 0 },
          { key: 'blog_products_list', type: 'list.product_reference', kind: 'urls', label: 'Product List (paste product URLs, one per line)', has: productGids.length > 0 }
        ];
        for (const fb of fillable) { if (!fb.has) report.push({ ok: false, label: fb.label + ' — empty', add: { key: fb.key, type: fb.type, kind: fb.kind, label: fb.label } }); }

        return res.status(200).json({ success: true, report, articleGid, articleUrl, adminUrl: adminId ? ('https://admin.shopify.com/store/' + storeHandle + '/content/articles/' + adminId) : '', gscUrl, galleries: galleriesList, month, monthCleared, monthLeft });
      }

      // ── ACTION: set-blog-metafield ── (Publish report: "add it yourself" — push ONE metafield onto the
      // just-created blog. Text/number = as typed; link = a URL; reference lists = pasted URLs/handles resolved to GIDs.)
      // Input: { articleGid, key, type, value }. Output: { success, error? }.
      if (req.body.action === 'set-blog-metafield') {
        const gid = String(req.body.articleGid || '').trim();
        const key = String(req.body.key || '').trim();
        const type = String(req.body.type || '').trim();
        let value = req.body.value;
        if (!gid || !key || !type) return res.status(400).json({ error: 'articleGid, key and type are required' });
        try {
          if (type.startsWith('list.')) {
            const raw = String(value == null ? '' : value).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            const gids = [];
            for (const item of raw) {
              const handle = item.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '').split('/').pop();
              if (!handle) continue;
              let g = null;
              if (type === 'list.collection_reference') { const d = await shopifyGraphQL(`query($h:String!){ collectionByHandle(handle:$h){ id } }`, { h: handle }); g = d && d.collectionByHandle && d.collectionByHandle.id; }
              else if (type === 'list.page_reference') { const d = await shopifyGraphQL(`query($q:String!){ pages(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.pages && d.pages.edges[0] && d.pages.edges[0].node.id; }
              else if (type === 'list.article_reference') { const d = await shopifyGraphQL(`query($q:String!){ articles(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.articles && d.articles.edges[0] && d.articles.edges[0].node.id; }
              else if (type === 'list.product_reference') { const d = await shopifyGraphQL(`query($q:String!){ products(first:1, query:$q){ edges{ node{ id } } } }`, { q: 'handle:' + handle }); g = d && d.products && d.products.edges[0] && d.products.edges[0].node.id; }
              if (g && !gids.includes(g)) gids.push(g);
            }
            if (!gids.length) return res.status(200).json({ success: false, error: 'Could not find any of those on your store — paste the full page/collection/product URLs, one per line.' });
            value = JSON.stringify(gids);
          } else if (type === 'link') {
            value = JSON.stringify({ url: String(value == null ? '' : value).trim(), text: null });
          } else if (type === 'number_integer') {
            const n = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
            if (isNaN(n)) return res.status(200).json({ success: false, error: 'That is not a number.' });
            value = String(n);
          } else {
            value = String(value == null ? '' : value);
          }
          const ns = (key === 'title_tag' || key === 'description_tag') ? 'global' : 'custom';
          const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [{ ownerId: gid, namespace: ns, key, type, value }] });
          const errs = sd && sd.metafieldsSet && sd.metafieldsSet.userErrors;
          if (errs && errs.length) return res.status(200).json({ success: false, error: errs[0].message });
          return res.status(200).json({ success: true });
        } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
      }

      // ── ACTION: set-blog-gallery ── (Publish report: pick a Shoppable Gallery by name → set it AND add its
      // 2 priciest products (the Collective / partner items) to the Product List, keeping the 2 About Wall Art.)
      // Input: { articleGid, galleryId }. Output: { success, products, added }.
      if (req.body.action === 'set-blog-gallery') {
        const gid = String(req.body.articleGid || '').trim();
        const galId = String(req.body.galleryId || '').trim();
        if (!gid || !galId) return res.status(400).json({ error: 'articleGid and galleryId required' });
        try {
          const gf = await getGitHubFile('data/galleries.json');
          const gsRaw = JSON.parse(gf.content || '[]');
          const arr = Array.isArray(gsRaw) ? gsRaw : (gsRaw.galleries || []);
          const g = arr.find(x => x && String(x.id) === galId);
          if (!g) return res.status(200).json({ success: false, error: 'That gallery was not found.' });
          const galProds = ((g.images) || [])
            .map(im => ({ gid: im.productId ? ('gid://shopify/Product/' + im.productId) : '', price: parseFloat(im.productPrice) || 0 }))
            .filter(x => x.gid).sort((a, b) => b.price - a.price);
          const seen = new Set(), gg = [];
          for (const x of galProds) { if (!seen.has(x.gid)) { seen.add(x.gid); gg.push(x.gid); } }
          const galleryGids = gg.slice(0, 2);
          // keep the article's current Product List (the 2 About Wall Art), add the gallery's 2
          let current = [];
          try { const q = await shopifyGraphQL(`query($id:ID!){ node(id:$id){ ... on Article { metafield(namespace:"custom", key:"blog_products_list"){ value } } } }`, { id: gid }); current = JSON.parse((q && q.node && q.node.metafield && q.node.metafield.value) || '[]'); } catch (e) { current = []; }
          if (!Array.isArray(current)) current = [];
          const merged = [], mseen = new Set();
          [...current, ...galleryGids].forEach(x => { if (x && !mseen.has(x)) { mseen.add(x); merged.push(x); } });
          const finalList = merged.slice(0, 4);
          const sd = await shopifyGraphQL(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`, { m: [
            { ownerId: gid, namespace: 'custom', key: 'shoppable_gallery_new', type: 'number_integer', value: String(parseInt(galId, 10)) },
            { ownerId: gid, namespace: 'custom', key: 'blog_products_list', type: 'list.product_reference', value: JSON.stringify(finalList) }
          ] });
          const errs = sd && sd.metafieldsSet && sd.metafieldsSet.userErrors;
          if (errs && errs.length) return res.status(200).json({ success: false, error: errs[0].message });
          return res.status(200).json({ success: true, products: finalList.length, added: galleryGids.length });
        } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
      }

      // ── ACTION: write-blog-sources ── (Stage 2 STEP 1: find real authority link + video + trend links)
      // Split from the body write so neither step runs long enough to time out, and the screen can show real progress.
      // Input: { keyword, title }. Output: { success, featuredBase, authority, youtube, trendsHtml }
      if (req.body.action === 'write-blog-sources') {
        const wbKeyword = String(req.body.keyword || '').trim();
        const wbTitle   = String(req.body.title || '').trim();
        if (!wbKeyword || !wbTitle) return res.status(400).json({ error: 'keyword and title required' });
        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const featuredBase = slugify(wbTitle).slice(0, 60) || slugify(wbKeyword);
        let sources = { authorityTitle: '', authorityUrl: '', youtubeTitle: '', youtubeLink: '' };
        try { sources = await generateContentSources(wbKeyword, wbTitle); } catch (e) { /* leave blank; body still writes */ }
        let trendsHtml = '';
        try { const vi = await generateVisualInspiration(wbKeyword, wbTitle, ''); trendsHtml = (vi && vi.html) || ''; } catch (e) { /* optional */ }
        return res.status(200).json({
          success: true,
          featuredBase,
          authority: { title: sources.authorityTitle, url: sources.authorityUrl },
          youtube: { title: sources.youtubeTitle, link: sources.youtubeLink },
          trendsHtml
        });
      }

      // ── ACTION: write-blog-body ── (Stage 2 STEP 2: write the full body using the sources from step 1)
      // Input: { keyword, title, brief?, authority?, youtube?, trendsHtml? }
      // Output: { success, bodyHtml (with [[IMG|...]] + [[PRODUCT|...]] markers), featuredBase, authority, youtube }
      if (req.body.action === 'write-blog-body' || req.body.action === 'write-blog') {
        const wbKeyword = String(req.body.keyword || '').trim();
        const wbTitle   = String(req.body.title || '').trim();
        const brief     = req.body.brief && typeof req.body.brief === 'object' ? req.body.brief : {};
        if (!wbKeyword || !wbTitle) return res.status(400).json({ error: 'keyword and title required' });

        const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const featuredBase = slugify(wbTitle).slice(0, 60) || slugify(wbKeyword);

        // Sources come from step 1 if provided; otherwise fetch them here (keeps the old one-shot path working).
        let sources = {
          authorityTitle: (req.body.authority && req.body.authority.title) || '',
          authorityUrl:   (req.body.authority && req.body.authority.url) || '',
          youtubeTitle:   (req.body.youtube && req.body.youtube.title) || '',
          youtubeLink:    (req.body.youtube && req.body.youtube.link) || ''
        };
        let trendsHtml = String(req.body.trendsHtml || '');
        if (!sources.authorityUrl && !sources.youtubeLink && req.body.authority === undefined) {
          try { sources = await generateContentSources(wbKeyword, wbTitle); } catch (e) { /* leave blank */ }
        }
        if (!trendsHtml) {
          try { const vi = await generateVisualInspiration(wbKeyword, wbTitle, ''); trendsHtml = (vi && vi.html) || ''; } catch (e) { /* optional */ }
        }

        // The competitor number is the whole-page target; the theme adds ~500 words below the body
        // (FAQ + summary + related), so the BODY targets that minus 500 — but never under 1,000.
        const competitorTarget = Math.min(2500, parseInt(brief.wordTarget, 10) || 2200); // hard cap 2500 words
        const wordTarget = Math.max(1000, competitorTarget - 500);
        const mustCover = Array.isArray(brief.mustCover) ? brief.mustCover.filter(Boolean) : [];
        const gaps = Array.isArray(brief.gaps) ? brief.gaps.filter(Boolean) : [];
        const angle = String(brief.angle || '').trim();

        const BANNED = 'Delve, Spearheading, Embarking, Embark, Compelling, Empowering, Encompassing, Comprehensively, Effectively, Beacon, Dive, Showcasing, Remarked, Aligns, Surpassing, Tragically, Impacting, Prioritize, Prioritizing, Sparking, Standout, Hindering, Advancements, Aiding, Fostering, Multifaceted, Revolutionary, Testament, Elevate, journey. Banned phrases: "in the ever-evolving world of", "at the forefront of", "in summary", "in conclusion", "in essence", "it\'s important to note", "emerges as a beacon", "dive into", "study aims to explore", "plays a significant role in shaping", "explores themes", "gain valuable insights".';

        const authorityLine = sources.authorityUrl
          ? `A real authority article was found — use it once, as a natural in-body link next to the fact it supports, inside the More-About section: <a href="${sources.authorityUrl}" target="_blank" rel="noopener">${(sources.authorityTitle || 'this guide').replace(/"/g, '')}</a>. Do NOT invent any other external link.`
          : `No authority article was found — write the More-About section WITHOUT an external link (do not invent one).`;
        const watchLine = sources.youtubeLink
          ? `A real YouTube video was found. Write the WATCH section as: <p><strong>WATCH:</strong> <a href="${sources.youtubeLink}" target="_blank" rel="noopener">${(sources.youtubeTitle || 'watch the video').replace(/"/g, '')}</a></p> then on the next line put the marker [[VIDEO|${sources.youtubeLink}]] where the video embed should go.`
          : `No video was found — SKIP the WATCH section entirely (do not invent a video).`;

        const bodyPrompt = `You are Mae Osz, a friendly UK home-decor advisor writing a blog for aboutwallart.com (wall art + home decor). Write the FULL blog body as clean HTML.

BLOG TITLE (use as the reader's main question): "${wbTitle}"
MAIN KEYWORD: "${wbKeyword}"
${angle ? `WINNING ANGLE: ${angle}` : ''}
TARGET LENGTH: at least ${wordTarget} words IN THE BODY (this already leaves ~500 words for the FAQ/summary/related sections that render below the body). Match or beat this — never write less.
${mustCover.length ? `MUST COVER these topics as H2 sections: ${mustCover.join('; ')}.` : ''}
${gaps.length ? `WIN ON these gaps the top pages miss (add as extra H2 sections): ${gaps.join('; ')}.` : ''}

VOICE (this is what makes it sound human, not AI):
- First person (I / we), a warm, friendly personal decorator advisor talking directly to the reader — like a friend who styles homes for a living.
- Write with real PERSONALITY. In several sections, include a short personal anecdote or a real problem-and-fix — "I once helped a client whose...", "the mistake I always see is...", "here's what happened when I tried...". You MAY invent these anecdotes naturally (a client, a room, a mistake) — keep them realistic and grounded. NEVER invent hard facts, brands, prices, stats or URLs.
- Talk TO the reader — ask the odd genuine question, acknowledge how they feel.
- Keep paragraphs SHORT: 2 to 4 sentences maximum. Break long explanations into several short paragraphs so it never becomes a wall of text.
- UK spelling always. "decor" with NO accent, everywhere.
- Grounded and practical, NEVER poetic or brochure-like. Write the way you'd actually talk.
- The main keyword MUST appear in the first sentence, and naturally in 1-2 headings — do NOT stuff it.
- BANNED words/phrases (never use any of these): ${BANNED}

EXACT ORDER (follow precisely):
1. Bold first paragraph that directly answers the main question. Wrap it in <p><strong>...</strong></p>.
2. Author bio, italic, on its own line: <p><em>By Mae Osz | Interior Design Consultant &amp; Home Decor Expert with 12+ years of experience.</em></p>
3. Hook — a relatable question ("Have you ever..."), its own paragraph. In it link the words wall art to the Google Business Profile: <a href="https://share.google/RKuQBBwmgZBHOL1VQ" target="_blank" rel="noopener">wall art</a>.
4. Quick Answer box — EXACTLY this grey box, no border, no rounded corners: <div style="background:#ededed;padding:16px 20px;margin:24px 0;"><strong>Quick answer:</strong> 2-3 sentence direct answer.</div>
5. Intro paragraph — context + a plain definition. In it, link unique wall art to <a href="https://aboutwallart.com/pages/unique-wall-art">/pages/unique-wall-art</a> and unique home decor to <a href="https://aboutwallart.com/pages/home-decor-items">/pages/home-decor-items</a> (use those exact URLs; invent no others).
6. Contents — a bold line (NOT a heading) exactly: <p><strong>List of Contents</strong></p> then a <ul> listing every H2 below.
7. The MAIN body sections — one <h2> per topic from MUST COVER, plus the GAPS as their own sections. EVERY H2 section (main and gap sections alike), in this order:
   a. <h2> heading (SEO-friendly, keyword/topic based).
   b. A direct 2-3 sentence answer paragraph.
   c. An image marker on its own line — EVERY section gets one, EXACT shape: [[IMG|filename-slug|3:2|photo|FULL PROMPT]] where FULL PROMPT is the complete image instruction YOU write for this section (see IMAGE RULES). Set kind to "photo" or "infographic" per the IMAGE RULES.
   d. Either an <h3> + a <ul> of practical bullets, OR a comparison <table>.
   e. In several sections (not all), a short personal anecdote paragraph (invented but realistic — a client, a room, a fix).
   f. A callout in EXACTLY this grey box (no border, no rounded corners): <div style="background:#ededed;padding:16px 20px;margin:24px 0;"><strong>Pro Tip:</strong> ...</div> or the same box with <strong>Real Example:</strong>.
8. Product markers — place AT LEAST 7 markers total across the whole blog, in the most product-relevant sections (NOT one in every section). Each on its own line: [[PRODUCT|the specific thing this section is about]]. AT LEAST 4 of these MUST be WALL ART markers — word each of those with "wall art", "prints", "wall pictures" or "artwork" so it is clearly wall art (e.g. [[PRODUCT|coastal wall art prints for the living room]]). The other markers are for non-art decor items (a lamp, a rug, a plant, etc.).
9. Visual-Inspiration section — an <h2> with an SEO-usable heading (about styles/looks, NOT just "Visual Inspiration"), a short intro line, then the marker [[TRENDS]] on its own line.
10. More-About section — an <h2> with an SEO-usable heading (NOT just "More About"), a bold lead sentence, then the supporting paragraph. ${authorityLine}
11. WATCH section. ${watchLine}
12. A closing section — an <h2> heading, a short warm wrap-up that speaks directly to the reader, and END with a genuine question to the reader to keep them engaged (a friendly question, NOT a salesy call to action). Do NOT use the words "in conclusion" or "in summary".

HARD RULES:
- Do NOT write any FAQ / "People Also Ask" / "Frequently Asked Questions" section — questions live elsewhere.
- Do NOT write a "Key Takeaways" section.
- The WATCH / video section is the LAST visual piece of the blog: do NOT place any image markers [[IMG|...]] or product markers [[PRODUCT|...]] in it or anywhere after it. Only the short closing text comes after the video.
- EVERY H2 body section gets its own [[IMG|...]] marker (see IMAGE RULES). Include at least ONE <table>.
- Place AT LEAST 7 [[PRODUCT|...]] markers total: AT LEAST 4 must be WALL ART (worded with "wall art"/"prints"/"artwork" so they are recognised as wall art), plus at least 3 for other decor items (Collective) — the actual products are chosen later.
- Keep every paragraph to 2-4 sentences.
- Use ONLY the exact links given above. Never invent a URL, product, price or fact (anecdotes are the only thing you may invent).
- Output ONLY the blog body HTML (start at the first <p>). No <html>, <head>, <body>, no markdown fences, no commentary.

IMAGE RULES — YOU write the full prompt for every image; the generator only draws exactly what you write:
- Marker shape: [[IMG|filename-slug|3:2|photo|FULL PROMPT]] (filename = short SEO slug; ratio 3:2 for body images; kind "photo" or "infographic").
- PHOTO (the default) — the FULL PROMPT begins: "Photoreal editorial interior photography, full bleed, calm muted palette, Scandi-minimal / Japandi styling unless this section is about another interior style. Natural soft light, no text, logos or watermarks. Do NOT add framed wall art, prints or pictures on the walls (the store's real wall art is shown separately through product images). Other wall decor is welcome and encouraged — shelves, macramé hangings, wall lighting/sconces, mirrors, hanging plants — style the walls naturally and lived-in." THEN describe the EXACT scene for THIS section (the specific room, decor, objects, colours, action named in the text — plants, materials, lighting, furniture, etc.). THEN the people: include a person in EVERY photo, in a natural candid pose, appropriate to the context — a couple (a man and a woman) for bedroom/romantic, a child or baby with a parent for nursery/kids, friends for entertaining, a family including older relatives for festive, a person actively holding/comparing swatches for a colour or material section; otherwise one person. Vary ethnicity genuinely across the blog (a real mix, not always white). Do NOT depict gay, lesbian or transgender couples. The ONLY exception where people are optional is a pure materials/textures close-up (a still-life with no people is fine there).
- INFOGRAPHIC — use kind "infographic" ONLY when the section is genuinely a COMPARISON, before/after, proportion, measurement, steps, or a stats/checklist. NEVER for a plain tip list or a room scene. When it is, the FULL PROMPT must be: "Clean minimal educational infographic, plain WHITE background, photoreal, all text solid BLACK. A short centred title near the top, then a clear VISUAL comparison (two labelled photos side by side, or simple labelled icons/steps), minimal words, generous white space, nothing near the edges. No people, no watermarks." THEN name the exact comparison/steps to show.
- Aim for about 3 infographics WHERE THEY GENUINELY FIT; if fewer sections truly suit one, that is fine — never mislabel a room scene as an infographic.

HERO IMAGE — at the VERY END, after the closing paragraph, output ONE line exactly: [[HERO|FULL PROMPT]] — one strong square featured scene for this blog (the reader's main situation/room, editorial look as above, NO framed wall art but other wall decor welcome, the keyword idea reflected in the setting). DESCRIBE THE ROOM/SCENE ONLY — do NOT put a specific person in it, and do NOT say how many people; leave the person completely open (the 5 featured options each add a different person). This is the ONLY place you describe the hero; it becomes 5 variations later.`;

        // Bigger ceiling so a long body (every section imaged, a table, 6 products) always finishes.
        let bodyHtml = await callClaudeText(bodyPrompt, 16000);
        bodyHtml = bodyHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        // Pull the hero (featured) image prompt out of the body — it's not part of the body.
        let heroPrompt = '';
        bodyHtml = bodyHtml.replace(/\[\[HERO\|([\s\S]*?)\]\]/, (m, p) => { heroPrompt = (p || '').trim(); return ''; }).trim();
        // Inject the real trend links into the Visual-Inspiration marker.
        if (trendsHtml) bodyHtml = bodyHtml.replace(/\[\[TRENDS\]\]/g, trendsHtml);
        else bodyHtml = bodyHtml.replace(/\[\[TRENDS\]\]/g, '');
        // Turn a [[VIDEO|url]] marker into a full-bleed responsive embed.
        bodyHtml = bodyHtml.replace(/\[\[VIDEO\|(https?:\/\/[^\]]+)\]\]/g, (m, u) => {
          const idm = String(u).match(/[?&]v=([^&]+)/) || String(u).match(/youtu\.be\/([^?&]+)/);
          const id = idm ? idm[1] : '';
          return id ? `<div style="position:relative;width:100%;padding-bottom:56.25%;margin:16px 0;"><iframe src="https://www.youtube.com/embed/${id}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe></div>` : '';
        });

        return res.status(200).json({
          success: true,
          bodyHtml,
          featuredBase,
          heroPrompt,
          authority: { title: sources.authorityTitle, url: sources.authorityUrl },
          youtube: { title: sources.youtubeTitle, link: sources.youtubeLink }
        });
      }

      const { keyword, url, title, perspective, galleryCode, collectionUrl, writeToSheet } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const newRow = `${csvField(keyword)},${csvField(url || 'N/A')},LOCKED,DONE,TO_OPTIMIZE,N/A,N/A,N/A,N/A,To_Write_Blog,${detectIntent(url || 'N/A')},`;
      const updatedRegistry = registry.content.trimEnd() + '\n' + newRow + '\n';
      await updateGitHubFile('data/keyword-locker-registry.csv', updatedRegistry, registry.sha, `Add to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'TO_WRITE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as TO_WRITE: ${keyword}`);

      let sheetsResult = null;
      if (writeToSheet) {
        try {
          sheetsResult = await appendToGoogleSheet(keyword, perspective, title, galleryCode, collectionUrl);
        } catch (sheetsError) {
          console.error('Google Sheets append failed (non-fatal):', sheetsError.message);
          sheetsResult = { error: sheetsError.message };
        }
      }

      return res.status(200).json({ success: true, keyword, url, sheetsResult });
    }

    // ============================================
    // PATCH
    // ============================================
    if (req.method === 'PATCH') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = 'KEYWORD_CHANGE';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Mark as KEYWORD_CHANGE: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    // ============================================
    // DELETE
    // ============================================
    if (req.method === 'DELETE') {
      const { keyword } = req.body;
      if (!keyword) return res.status(400).json({ error: 'Keyword is required' });
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured in environment variables' });

      const registry = await getGitHubFile('data/keyword-locker-registry.csv');
      const registryLines = registry.content.split('\n');
      const filteredRegistry = registryLines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        const cols = parseCSVLine(trimmed);
        return !(cols[0] === keyword && cols[9] === 'To_Write_Blog');
      }).join('\n');
      await updateGitHubFile('data/keyword-locker-registry.csv', filteredRegistry, registry.sha, `Undo to write blog: ${keyword}`);

      const ideasFile = await getGitHubFile('data/blog_ideas.csv');
      const ideasLines = ideasFile.content.split('\n');
      const updatedIdeas = ideasLines.map(line => {
        const trimmed = line.trim().replace(/\r/g, '');
        if (!trimmed) return line;
        const cols = parseCSVLine(trimmed);
        if (cols[0] === keyword) {
          while (cols.length < 7) cols.push('');
          cols[6] = '';
          return cols.map(c => c.includes(',') ? `"${c}"` : c).join(',');
        }
        return line;
      }).join('\n');
      await updateGitHubFile('data/blog_ideas.csv', updatedIdeas, ideasFile.sha, `Clear status: ${keyword}`);

      return res.status(200).json({ success: true, keyword });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
