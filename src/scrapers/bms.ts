import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { db } from '../utils/db';
import { movies } from '../lib/schema/content';
import { realtimeSessions } from '../lib/schema/tracking';
import { eq, or, sql } from 'drizzle-orm';
import { getBMSHeaders } from '../utils/headers';
import * as crypto from 'crypto';

// The two movies we are tracking
const TRACKING_KEYWORDS = ['Peddi', 'Salaar'];

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
            
            // Only track our specific movies
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
    console.log("🚀 Starting BMS Scraper...");
    const dateStr = getISTDateStr();
    const dateCode = getISTDateCode();

    // 1. Fetch Venue List dynamically (to ensure we have all theaters)
    console.log("📥 Fetching venue list...");
    let venuesList: any[] = [];
    try {
        // We fetch BFilmy's public static venue dictionaries
        const urls = [1].map(i => `https://raw.githubusercontent.com/unknownman2024/assetz/refs/heads/main/venues${i}.json`);
        for (const url of urls) {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                for (const [code, val] of Object.entries(data as any)) {
                    venuesList.push({
                        code,
                        name: (val as any).VenueName,
                        city: (val as any).City,
                        state: (val as any).State,
                    });
                }
            }
        }
        console.log(`✅ Loaded ${venuesList.length} venues.`);
    } catch (err) {
        console.error("Failed to load venues:", err);
        return;
    }

    // Since this is a test run, we'll only do a subset of venues
    // to see if we successfully hit the DB.
    // In production, we loop through all 3000 venues with concurrency limit.
    const testVenues = venuesList.slice(0, 100);
    const sessionsToInsert: any[] = [];

    console.log(`🌐 Scraping ${testVenues.length} BMS venues for ${dateStr}...`);
    for (const v of testVenues) {
        const results = await scrapeBMSVenue(v.code, dateCode);
        if (results.length > 0) {
            sessionsToInsert.push(...results);
        }
        // Small delay to prevent rate limit
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`✅ Found ${sessionsToInsert.length} sessions for our tracked movies.`);

    if (sessionsToInsert.length > 0) {
        console.log("💾 Upserting to Database...");
        
        // Find DB Movie ID
        const dbMovies = await db.select().from(movies).where(
            or(
                sql`${movies.title} ILIKE '%Peddi%'`,
                sql`${movies.title} ILIKE '%Salaar%'`
            )
        );

        let successCount = 0;
        for (const session of sessionsToInsert) {
            const dbMovie = dbMovies.find(m => m.title.toLowerCase().includes(cleanMovieTitle(session.rawTitle).toLowerCase()) || session.rawTitle.toLowerCase().includes(m.title.toLowerCase()));
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

    console.log("🏁 BMS Scraper Complete.");
    process.exit(0);
}

runScraper().catch(console.error);
