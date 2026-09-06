import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = "https://www.sacnilk.com";
const MAIN_URL = `${BASE_URL}/metasection/box_office`;
const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTPUT_FILE = path.join(DATA_DIR, "sacnilk_data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeTitle(title: string) {
  const cleaned = title.replace(/\b(19|20)\d{2}\b/, "");
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim();
}

function cleanMovieTitle(title: string) {
  return title.replace(/\s+Box Office.*$/i, "").trim();
}

async function fetchHTML(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.text();
}

async function extractMovieLinks() {
  console.log("🌐 Fetching SACNilk Main Page...");
  const html = await fetchHTML(MAIN_URL);

  const movieMap: any = {};
  const regex = /<a\s+href="(?:https:\/\/www\.sacnilk\.com)?(\/news\/[^"]+Box_Office_Collection[^"]*)"/gi;

  let match;
  while ((match = regex.exec(html))) {
    let href = match[1];
    
    // Extract movie name from URL: e.g. /news/Immortal_2026_Box_Office_Collection_Day_Wise_Worldwide
    const urlParts = href.split('/news/')[1].split('_Box_Office_Collection');
    if (urlParts.length > 0) {
      let rawTitle = urlParts[0].replace(/_/g, ' ').replace(/\b(19|20)\d{2}\b/, '').trim();
      
      const normalized = normalizeTitle(rawTitle);

      if (!movieMap[normalized]) movieMap[normalized] = [];
      movieMap[normalized].push({
        name: rawTitle,
        link: BASE_URL + href,
        day: 1 // Default to 1, we will scrape the actual day from the page
      });
    }
  }

  const finalMovies: any[] = [];
  Object.values(movieMap).forEach((entries: any) => {
    entries.sort((a: any, b: any) => b.day - a.day); // Get latest day
    if (entries[0].day <= 30) {
      finalMovies.push(entries[0]);
    }
  });

  return finalMovies;
}

async function extractAmountCr(url: string) {
  try {
    const html = await fetchHTML(url);
    
    // Look for: Overall Total Collection (Net)... ₹<amount>Cr
    const match = html.match(/Overall Total Collection\s*\(Net\)[\s\S]*?₹([\d.]+)\s*Cr/i);
    
    if (match) {
      return parseFloat(match[1]);
    }
    
    // Fallback if not found
    console.log("Could not find 'Overall Total Collection (Net)' for", url);
  } catch (e: any) {
    console.error("❌ Error fetching amount from:", url, e.message);
  }
  return null;
}

async function runScraper() {
  console.log("🚀 Starting SACNilk Industry Scraper...");
  
  try {
    const movies = await extractMovieLinks();
    console.log(`🎬 Found ${movies.length} active movies on SACNilk.`);
    
    const results = [];
    
    for (const m of movies) {
      console.log(`fetching day ${m.day} for ${m.name}...`);
      const amount = await extractAmountCr(m.link);
      
      results.push({
        movie: m.name,
        day: m.day,
        estimateCr: amount || 0,
        sourceUrl: m.link,
        lastUpdated: new Date().toISOString()
      });
      
      // Gentle delay
      await new Promise(r => setTimeout(r, 1000));
    }
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`✅ Saved SACNilk industry estimates to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("Failed to scrape SACNilk:", err);
  }
}

runScraper();
