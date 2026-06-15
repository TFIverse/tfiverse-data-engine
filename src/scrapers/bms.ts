import { getBMSHeaders } from '../utils/headers';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');

function cleanMovieTitle(title: string): string {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
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
        const chain = venue.VenueCompName || "Unknown";
        const state = venue.VenueState || "Unknown State";

        const out = [];

        for (const ev of (sd[0].Event || [])) {
            const title = ev.EventTitle || "Unknown";
            
            // Track EVERY live movie!

            for (const ch of (ev.ChildEvents || [])) {
                const dim = (ch.EventDimension || "").trim();
                const lang = (ch.EventLanguage || "").trim();
                const suffix = [dim, lang].filter(Boolean).join(" | ");
                const movie = suffix ? `${title} [${suffix}]` : title;

                for (const sh of (ch.ShowTimes || [])) {
                    if (sh.ShowDateCode !== dateCode) continue;

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

                    // Reconstruct the actual Date string from dateCode
                    const isoDate = `${dateCode.substring(0,4)}-${dateCode.substring(4,6)}-${dateCode.substring(6,8)} ${sh.ShowTime}`;

                    out.push({
                        movie,
                        rawTitle: title,
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

    if (!process.env.GITHUB_ACTIONS) {
        testVenues = testVenues.slice(0, 100); // Limit local dev
    }

    const sessionsToInsert: any[] = [];

    const concurrency = 5; // Gentler concurrency for BMS directly
    const daysToScrape = [0, 1, 2, 3, 4]; // Scrape today + next 4 days

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

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const filepath = path.join(DATA_DIR, 'latest_bms_data.json');
    fs.writeFileSync(filepath, JSON.stringify(sessionsToInsert, null, 2));
    
    console.log(`💾 Successfully saved data to ${filepath}`);
    console.log("🏁 BMS Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
