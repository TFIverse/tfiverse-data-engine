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

function formatState(stateStr: string): string {
    if (!stateStr || typeof stateStr !== 'string') return 'Unknown';
    return stateStr.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
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
            
            // The 200-minute strict cutoff logic for Live Box Office vs Advance
            const isAdvanceMode = process.env.SCRAPE_MODE === 'ADVANCE';
            if (session.showTime) {
                // Reconstruct the showtime string in IST clock time
                const timeStr = new Date(session.showTime).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
                });
                const isoDateStr = `${dateStr} ${timeStr}`;
                
                const showTimeLocal = new Date(isoDateStr);
                const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
                const nowLocal = new Date(nowStr);
                
                const diffMins = (showTimeLocal.getTime() - nowLocal.getTime()) / (1000 * 60);
                
                if (isAdvanceMode) {
                    if (diffMins < 200) continue; // Skip live shows in advance mode
                } else {
                    if (diffMins >= 200) continue; // Skip advance shows in live mode
                }
            }

            // Track EVERY live movie!

            const lang = session.lang || movie.lang || "";
            const format = session.scrnFmt || session.format || movie.format || "";
            const formattedFormat = format ? format.replace(/-/g, ' | ') : '';
            // Language-aware key like BFilmy: "Peddi | Telugu" or "Peddi [2D | Telugu]"
            const movieTitle = formattedFormat 
                ? `${name} [${formattedFormat} | ${lang}]` 
                : lang ? `${name} | ${lang}` : name;

            const total = session.total || 0;
            const avail = session.avail || 0;
            const sold = Math.max(0, total - avail);

            let gross = 0;
            (session.areas || []).forEach((a: any) => {
                const soldInArea = Math.max(0, a.sTotal - a.sAvail);
                gross += soldInArea * (a.price || 0); // Raw price like BFilmy — no /100
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
                lang: lang,
                format: formattedFormat || format,
                venue: venue.label || venue.district_name || 'Unknown Venue',
                chain: venue.chainKey || 'Independent',
                city: venue.city || 'Unknown City',
                state: formatState(venue.state || 'Unknown'),
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

    console.log("🗄️ Loading master venue list...");
    let testVenues: any[] = require('../../data/paytm_venues_master.json');

    // We scrape all venues to ensure 100% full data coverage

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

    const mode = (process.env.SCRAPE_MODE || 'LIVE').toLowerCase();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const filepath = path.join(DATA_DIR, `latest_paytm_${mode}_data.json`);
    fs.writeFileSync(filepath, JSON.stringify(sessionsToInsert, null, 2));
    
    console.log(`💾 Successfully saved data to ${filepath}`);
    console.log("🏁 Paytm Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
