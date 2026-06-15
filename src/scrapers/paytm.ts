import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import * as crypto from 'crypto';
import * as fs from 'fs';

const WORKER_KEY = process.env.WORKER_KEY;
const WORKER_UA = process.env.WORKER_UA || 'Mozilla/5.0';
const DATA_DIR = path.resolve(__dirname, '../../data');

function cleanMovieTitle(title: string): string {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

function getISTDateStr(daysOffset: number = 0): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    ist.setDate(ist.getDate() + daysOffset);
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function scrapeDistrictVenue(venue: any, dateStr: string, trackingKeywords: string[]): Promise<any[]> {
    if (!WORKER_KEY) return [];

    const url = `https://districtvenues.text2026mail.workers.dev/?cinema_id=${venue.id}&date=${dateStr}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': WORKER_UA, 'x-api-key': WORKER_KEY },
            timeout: 10000,
        } as any);

        if (!res.ok) return [];

        const json = await res.json();
        const out: any[] = [];
        const moviesMap: Record<string, any> = {};
        
        (json.meta?.movies || []).forEach((m: any) => (moviesMap[m.id] = m));

        for (const session of json.pageData?.sessions || []) {
            const movie = moviesMap[session.mid];
            if (!movie) continue;

            const name = movie.name;
            
            // Track EVERY live movie!

            const lang = session.lang || movie.lang || "";
            const format = session.format || movie.format || "";
            const suffix = [format, lang].filter(Boolean).join(" | ");
            const movieTitle = suffix ? `${name} [${suffix}]` : name;

            const total = session.total || 0;
            const avail = session.avail || 0;
            const sold = Math.max(0, total - avail);

            let gross = 0;
            (session.areas || []).forEach((a: any) => {
                const soldInArea = Math.max(0, a.sTotal - a.sAvail);
                const priceInRupees = (a.price || 0) / 100; // Paytm price is usually in Paisa
                gross += soldInArea * priceInRupees;
            });

            // Reconstruct full DateTime
            const timeStr = session.showTime ? new Date(session.showTime).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
            }) : 'Unknown';
            const isoDate = `${dateStr} ${timeStr}`;

            const hashInput = `${venue.label}-${venue.city}-${timeStr}-${session.audi}-${dateStr}`;
            const sessionId = crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 16);

            out.push({
                movie: movieTitle,
                rawTitle: name,
                venue: venue.label || venue.district_name || 'Unknown Venue',
                chain: venue.chainKey || 'Paytm',
                city: venue.city || 'Unknown City',
                state: venue.state || 'Unknown State',
                time: isoDate,
                audi: session.audi || "",
                sessionId: sessionId,
                totalSeats: total,
                availableSeats: avail,
                soldSeats: sold,
                grossRevenue: Number(gross.toFixed(2)),
                source: 'PAYTM',
                availStatus: avail > 0 ? 1 : 3
            });
        }
        return out;
    } catch (err) {
        return [];
    }
}

async function runScraper() {
    console.log("🚀 Starting Dynamic Paytm/District Scraper...");

    if (!WORKER_KEY) {
        console.error("❌ ERROR: WORKER_KEY is not set in .env! Cannot scrape Paytm/District.");
        process.exit(1);
    }

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

    console.log("📥 Fetching district venue list...");
    let testVenues: any[] = [];
    try {
        const url = `https://raw.githubusercontent.com/unknownman2024/assetz/refs/heads/main/districtvenues.json`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            testVenues = data;
        }
    } catch (err) {
        console.error("Failed to load venues:", err);
        process.exit(1);
    }

    if (!process.env.GITHUB_ACTIONS) {
        testVenues = testVenues.slice(0, 100);
    }

    const sessionsToInsert: any[] = [];
    const daysToScrape = [0, 1, 2, 3, 4]; // Scrape today + next 4 days

    const concurrency = 10;

    for (const offset of daysToScrape) {
        const dateStr = getISTDateStr(offset);
        console.log(`\n🌐 Scraping ${testVenues.length} Paytm venues for Date: ${dateStr} (Concurrency: ${concurrency})...`);
        
        for (let i = 0; i < testVenues.length; i += concurrency) {
            const chunk = testVenues.slice(i, i + concurrency);
            const promises = chunk.map(v => scrapeDistrictVenue(v, dateStr, trackingKeywords));
            
            const resultsArray = await Promise.all(promises);
            for (const results of resultsArray) {
                if (results.length > 0) sessionsToInsert.push(...results);
            }
            
            await new Promise(r => setTimeout(r, 100)); // Light sleep between chunks
        }
    }

    console.log(`\n✅ Found ${sessionsToInsert.length} total sessions across 5 days.`);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const filepath = path.join(DATA_DIR, 'latest_paytm_data.json');
    fs.writeFileSync(filepath, JSON.stringify(sessionsToInsert, null, 2));
    
    console.log(`💾 Successfully saved data to ${filepath}`);
    console.log("🏁 Paytm Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
