import { getBMSHeaders } from '../utils/headers';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');

function cleanMovieTitle(title: string): string {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

function formatState(stateStr: string): string {
    if (!stateStr || typeof stateStr !== 'string') return 'Unknown';
    return stateStr.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getISTDateCode(daysOffset: number = 0): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    ist.setDate(ist.getDate() + daysOffset);
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

async function scrapeBMSVenue(venueCode: string, dateCode: string, trackingKeywords: string[]): Promise<any[]> {
    const url = `https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode=${venueCode}&dateCode=${dateCode}`;
    const headers = getBMSHeaders();

    try {
        const response = await fetch(url, { headers, timeout: 10000 } as any);
        if (!response.ok) return [];

        const data = await response.json();
        const sd = data.ShowDetails || [];
        if (sd.length === 0) return [];

        const venue = sd[0].Venues || {};
        const venueName = venue.VenueName || "Unknown";
        const city = venue.VenueCity || "Unknown";
        const chain = venue.VenueCompName || "Independent";
        const state = formatState(venue.VenueState || 'Unknown');

        const out = [];

        for (const ev of (sd[0].Event || [])) {
            const title = ev.EventTitle || "Unknown";
            
            // Track EVERY live movie!

            for (const ch of (ev.ChildEvents || [])) {
                const dim = (ch.EventDimension || "").trim();
                const lang = (ch.EventLanguage || "").trim();
                // Language-aware key like BFilmy: "Peddi | Telugu" or "Peddi [2D | Telugu]"
                const movie = dim 
                    ? `${title} [${dim} | ${lang}]` 
                    : lang ? `${title} | ${lang}` : title;

                for (const sh of (ch.ShowTimes || [])) {
                    if (sh.ShowDateCode !== dateCode) continue;

                    const isoDate = `${dateCode.substring(0,4)}-${dateCode.substring(4,6)}-${dateCode.substring(6,8)} ${sh.ShowTime}`;
                    
                    // The 200-minute strict cutoff logic for Live Box Office vs Advance
                    const isAdvanceMode = process.env.SCRAPE_MODE === 'ADVANCE';
                    const showTimeLocal = new Date(isoDate);
                    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
                    const nowLocal = new Date(nowStr);
                    
                    const diffMins = (showTimeLocal.getTime() - nowLocal.getTime()) / (1000 * 60);
                    
                    if (isAdvanceMode) {
                        if (diffMins < 200) continue; // Skip live shows in advance mode
                    } else {
                        if (diffMins >= 200) continue; // Skip advance shows in live mode
                    }

                    let total = 0, avail = 0, sold = 0, gross = 0;
                    
                    for (const cat of (sh.Categories || [])) {
                        const seats = parseInt(cat.MaxSeats || 0);
                        const free = parseInt(cat.SeatsAvail || 0);
                        const price = parseFloat(cat.CurPrice || 0);
                        
                        total += seats;
                        avail += free;
                        sold += (seats - free);
                        gross += (seats - free) * price;
                    }

                    // isoDate is already declared and constructed above

                    out.push({
                        movie,
                        rawTitle: title,
                        lang: lang,
                        format: dim,
                        venue: venueName,
                        chain,
                        city,
                        state,
                        time: isoDate,
                        audi: sh.Attributes || "",
                        sessionId: String(sh.SessionId || ""),
                        totalSeats: total,
                        availableSeats: avail,
                        soldSeats: sold,
                        grossRevenue: Number(gross.toFixed(2)),
                        source: 'BMS',
                        availStatus: parseInt(sh.AvailStatus || '1')
                    });
                }
            }
        }
        return out;
    } catch (error) {
        return [];
    }
}

async function runScraper() {
    console.log("🚀 Starting Dynamic BMS Scraper...");
    
    // 1. Load Dynamic Tracking Keywords
    const moviesPath = path.join(DATA_DIR, 'movies.json');
    let trackingKeywords: string[] = [];
    if (fs.existsSync(moviesPath)) {
        const mv = JSON.parse(fs.readFileSync(moviesPath, 'utf8'));
        trackingKeywords = mv.map((m: any) => cleanMovieTitle(m.title));
    } else {
        console.error("❌ movies.json not found! Run the Discovery Engine first.");
        process.exit(1);
    }
    console.log(`🎬 Tracking ${trackingKeywords.length} live movies...`);

    // 2. Load Master Venue List
    console.log("📥 Loading master venue list...");
    let testVenues: any[] = [];
    const venuesPath = path.join(DATA_DIR, 'bms_venues.json');
    if (fs.existsSync(venuesPath)) {
        testVenues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
    } else {
        // Fallback for development if mapping script hasn't run
        try {
            const res = await fetch(`https://raw.githubusercontent.com/unknownman2024/assetz/refs/heads/main/venues1.json`);
            if (res.ok) {
                const data = await res.json();
                for (const [code, val] of Object.entries(data as any)) {
                    testVenues.push({ code, name: (val as any).VenueName, city: (val as any).City });
                }
            }
        } catch (e) {}
    }

    // We scrape all venues to ensure 100% full data coverage

    const sessionsToInsert: any[] = [];

    const concurrency = 5; // Gentler concurrency for BMS directly
    
    // Live mode only needs today and tomorrow (to catch 1 AM shows). Advance needs 5 days.
    const isAdvance = process.env.SCRAPE_MODE === 'ADVANCE';
    const daysToScrape = isAdvance ? [0, 1, 2, 3, 4] : [0, 1];

    for (const offset of daysToScrape) {
        const dateCode = getISTDateCode(offset);
        console.log(`\n🌐 Scraping ${testVenues.length} BMS venues for Date: ${dateCode} (Concurrency: ${concurrency})...`);
        
        for (let i = 0; i < testVenues.length; i += concurrency) {
            const chunk = testVenues.slice(i, i + concurrency);
            const promises = chunk.map(v => scrapeBMSVenue(v.code, dateCode, trackingKeywords));
            
            const resultsArray = await Promise.all(promises);
            for (const results of resultsArray) {
                if (results.length > 0) {
                    sessionsToInsert.push(...results);
                }
            }
            // Rate limiting
            await new Promise(r => setTimeout(r, 200));
        }
    }

    console.log(`\n✅ Found ${sessionsToInsert.length} total sessions across 5 days.`);

    const mode = (process.env.SCRAPE_MODE || 'LIVE').toLowerCase();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const filepath = path.join(DATA_DIR, `latest_bms_${mode}_data.json`);
    fs.writeFileSync(filepath, JSON.stringify(sessionsToInsert, null, 2));
    
    console.log(`💾 Successfully saved data to ${filepath}`);
    console.log("🏁 BMS Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
