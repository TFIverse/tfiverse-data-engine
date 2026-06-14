import { getBMSHeaders } from '../utils/headers';
import * as fs from 'fs';
import * as path from 'path';

const TRACKING_KEYWORDS = ['Peddi', 'Salaar'];
const DATA_DIR = path.resolve(__dirname, '../../data');

function cleanMovieTitle(title: string): string {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

function getISTDateStr(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getISTDateCode(): string {
    return getISTDateStr().replace(/-/g, '');
}

async function scrapeBMSVenue(venueCode: string, dateCode: string): Promise<any[]> {
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
            
            if (!TRACKING_KEYWORDS.some(k => title.toLowerCase().includes(k.toLowerCase()))) {
                continue;
            }

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

                    out.push({
                        movie,
                        rawTitle: title,
                        venue: venueName,
                        chain,
                        city,
                        state,
                        time: sh.ShowTime || "",
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
    console.log("🚀 Starting BMS Scraper (JSON Output Mode)...");
    const dateStr = getISTDateStr();
    const dateCode = getISTDateCode();

    console.log("📥 Fetching venue list...");
    let venuesList: any[] = [];
    try {
        const urls = [1].map(i => `https://raw.githubusercontent.com/unknownman2024/assetz/refs/heads/main/venues${i}.json`);
        for (const url of urls) {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                for (const [code, val] of Object.entries(data as any)) {
                    venuesList.push({ code, name: (val as any).VenueName, city: (val as any).City, state: (val as any).State });
                }
            }
        }
        console.log(`✅ Loaded ${venuesList.length} venues.`);
    } catch (err) {
        console.error("Failed to load venues:", err);
        return;
    }

    const testVenues = venuesList.slice(0, 100);
    const sessionsToInsert: any[] = [];

    console.log(`🌐 Scraping ${testVenues.length} BMS venues for ${dateStr}...`);
    for (const v of testVenues) {
        const results = await scrapeBMSVenue(v.code, dateCode);
        if (results.length > 0) {
            sessionsToInsert.push(...results);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`✅ Found ${sessionsToInsert.length} sessions for our tracked movies.`);

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const filepath = path.join(DATA_DIR, 'latest_bms_data.json');
    fs.writeFileSync(filepath, JSON.stringify(sessionsToInsert, null, 2));
    console.log(`💾 Successfully saved data to ${filepath}`);

    console.log("🏁 BMS Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
