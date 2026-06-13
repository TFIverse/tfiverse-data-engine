import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { db } from '../utils/db';
import { movies } from '../lib/schema/content';
import { realtimeSessions } from '../lib/schema/tracking';
import { eq, or, sql } from 'drizzle-orm';
import * as crypto from 'crypto';

const WORKER_KEY = process.env.WORKER_KEY;
const WORKER_UA = process.env.WORKER_UA || 'Mozilla/5.0';

// The two movies we are tracking
const TRACKING_KEYWORDS = ['Peddi', 'Salaar'];

function getISTDateStr(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function scrapeDistrictVenue(venueId: string, dateStr: string): Promise<any[]> {
    if (!WORKER_KEY) return [];

    const url = `https://districtvenues.text2026mail.workers.dev/?cinema_id=${venueId}&date=${dateStr}`;
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': WORKER_UA,
                'x-api-key': WORKER_KEY,
            },
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
            if (!TRACKING_KEYWORDS.some(k => name.toLowerCase().includes(k.toLowerCase()))) {
                continue;
            }

            const lang = session.lang || movie.lang || "";
            const format = session.format || movie.format || "";
            const suffix = [format, lang].filter(Boolean).join(" | ");
            const movieTitle = suffix ? `${name} [${suffix}]` : name;

            const total = session.total || 0;
            const avail = session.avail || 0;
            const sold = total - avail;

            let gross = 0;
            (session.areas || []).forEach((a: any) => {
                gross += (a.sTotal - a.sAvail) * (a.price || 0);
            });

            const timeStr = session.showTime ? new Date(session.showTime).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
            }) : 'Unknown';

            // Generate deterministic sessionId
            const hashInput = `${json.meta?.cinema_name}-${json.meta?.city_name}-${timeStr}-${session.audi}-${dateStr}`;
            const sessionId = crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 16);

            out.push({
                movie: movieTitle,
                rawTitle: name,
                venue: json.meta?.cinema_name || 'Unknown Venue',
                chain: 'Paytm',
                city: json.meta?.city_name || 'Unknown City',
                state: json.meta?.state_name || 'Unknown State',
                time: timeStr,
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
    console.log("🚀 Starting Paytm/District Scraper...");

    if (!WORKER_KEY) {
        console.error("❌ ERROR: WORKER_KEY is not set in .env! Cannot scrape Paytm/District.");
        process.exit(1);
    }

    const dateStr = getISTDateStr();

    console.log("📥 Fetching district venue list...");
    let venuesList: any[] = [];
    try {
        const url = `https://raw.githubusercontent.com/unknownman2024/assetz/refs/heads/main/districtvenues.json`;
        const res = await fetch(url);
        if (res.ok) {
            venuesList = await res.json();
            console.log(`✅ Loaded ${venuesList.length} Paytm venues.`);
        }
    } catch (err) {
        console.error("Failed to load venues:", err);
        return;
    }

    const testVenues = venuesList.slice(0, 100);
    const sessionsToInsert: any[] = [];

    console.log(`🌐 Scraping ${testVenues.length} Paytm venues for ${dateStr}...`);
    for (const v of testVenues) {
        const results = await scrapeDistrictVenue(v.id, dateStr);
        if (results.length > 0) {
            sessionsToInsert.push(...results);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`✅ Found ${sessionsToInsert.length} sessions for our tracked movies.`);

    if (sessionsToInsert.length > 0) {
        console.log("💾 Upserting to Database...");
        
        const dbMovies = await db.select().from(movies).where(
            or(
                sql`${movies.title} ILIKE '%Peddi%'`,
                sql`${movies.title} ILIKE '%Salaar%'`
            )
        );

        let successCount = 0;
        for (const session of sessionsToInsert) {
            const dbMovie = dbMovies.find(m => m.title.toLowerCase().includes(session.rawTitle.toLowerCase()) || session.rawTitle.toLowerCase().includes(m.title.toLowerCase()));
            if (!dbMovie) continue;

            try {
                await db.insert(realtimeSessions).values({
                    movieId: dbMovie.id,
                    sessionId: session.sessionId,
                    venueName: session.venue,
                    chainName: session.chain,
                    city: session.city,
                    state: session.state,
                    showDate: new Date(dateStr),
                    showTime: session.time,
                    audi: session.audi,
                    totalSeats: session.totalSeats,
                    availableSeats: session.availableSeats,
                    soldSeats: session.soldSeats,
                    grossRevenue: session.grossRevenue,
                    source: session.source,
                    lastUpdated: new Date()
                }).onConflictDoUpdate({
                    target: [realtimeSessions.movieId, realtimeSessions.sessionId],
                    set: {
                        availableSeats: session.availableSeats,
                        soldSeats: session.soldSeats,
                        grossRevenue: session.grossRevenue,
                        lastUpdated: new Date(),
                    }
                });
                successCount++;
            } catch (err) {
                console.error("DB Insert Error:", err);
            }
        }
        console.log(`🎉 Successfully upserted ${successCount} sessions!`);
    }

    console.log("🏁 Paytm Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
