// blogs.js — v3.8
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
      throw new Error(`Claude API error: ${response.status} ${errText.slice(0, 200)}`);
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
      throw new Error(`Claude API error: ${response.status} ${errText.slice(0, 200)}`);
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
2. Select exactly ONE Intent_Tag — from INTENT clusters (mandatory).
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
- Select 3 to 5 relevant Trend Pages from the ALLOWED list below.
- If a Style cluster is provided, choose the trend(s) most related to that style first.
- If the Style cluster is empty or too general, choose the trends closest to the blog topic.
- If nothing clearly fits, default to "Cosy Minimalism Home Decor Trend".
- Use ONLY names written EXACTLY as in the allowed list. Do NOT invent or modify names.
- Each trend needs a short descriptive phrase of 4-6 words.

ALLOWED TREND PAGES:
${allowedNames.join('\n')}

Return ONLY valid JSON in this exact shape, no other text:
{"trends":[{"name":"","description":""}]}
Include 3 to 5 items.`;
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
    if (trends.length > 5) trends.length = 5;

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
    const BLOG_GID = 'gid://shopify/Blog/93572858142'; // About Wall Art blog (news-articles-home-decor-inspiration)
    const found = [];
    const seen = new Set();
    const addArticle = (a) => {
      if (found.length >= 3 || !a || seen.has(a.id)) return;
      seen.add(a.id);
      found.push({
        articleGid: a.id,
        blogGid: BLOG_GID,
        title: a.title || '',
        handle: a.handle || '',
        url: `https://aboutwallart.com/blogs/news-articles-home-decor-inspiration/${a.handle || ''}`,
        image: (a.image && a.image.url) || ''
      });
    };

    // 1 + 2: cluster concepts (primary, then supporting) matched in the title
    for (const tag of orderedClusterTags) {
      if (found.length >= 3) break;
      const term = deriveSearchTerm(tag);
      if (!term) continue;
      const firstWord = term.split(' ')[0];
      try {
        const data = await shopifyGraphQL(
          `query($q:String!){ blog(id:"${BLOG_GID}"){ articles(first:25, query:$q, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} } } } } }`,
          { q: term }
        );
        const arts = data.blog ? data.blog.articles.edges.map(e => e.node) : [];
        for (const a of arts) {
          if (found.length >= 3) break;
          const t = (a.title || '').toLowerCase();
          if (t.includes(term) || t.includes(firstWord)) addArticle(a);
        }
      } catch (e) { /* best-effort */ }
    }

    // 3: general fallback — most recent published posts
    if (found.length < 3) {
      try {
        const data = await shopifyGraphQL(
          `query{ blog(id:"${BLOG_GID}"){ articles(first:12, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{ id title handle image{url} } } } } }`,
          {}
        );
        const arts = data.blog ? data.blog.articles.edges.map(e => e.node) : [];
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
