import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { db } from '../utils/db';
import { movies } from '../lib/schema/content';
import { getBMSHeaders } from '../utils/headers';
import { eq } from 'drizzle-orm';

const TOP_CITIES = ['HYD', 'MUMB', 'NCR', 'BANG', 'CHEN'];
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

function generateSlug(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanMovieTitle(title: string): string {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchTMDBData(title: string) {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            if (json.results && json.results.length > 0) return json.results[0];
        }
    } catch (e) {}
    return null;
}

async function discoverMovies() {
    console.log("🔍 Starting Movie Discovery Engine...");
    let newMoviesCount = 0;

    for (const city of TOP_CITIES) {
        console.log(`📡 Scanning "Now Showing" in ${city}...`);
        const url = `https://in.bookmyshow.com/api/v2/mobile/movies/nowshowing?regionCode=${city}`;
        try {
            const res = await fetch(url, { headers: getBMSHeaders() } as any);
            if (!res.ok) continue;

            const json = await res.json();
            const events = json.BookMyShow?.MoviesData?.Events || [];

            for (const ev of events) {
                const title = cleanMovieTitle(ev.EventTitle || '');
                if (!title) continue;

                const slug = generateSlug(title);
                const existing = await db.select({ id: movies.id }).from(movies).where(eq(movies.slug, slug));

                if (existing.length === 0) {
                    console.log(`🎬 NEW MOVIE DETECTED: "${title}"`);
                    
                    const tmdbData = await fetchTMDBData(title);
                    const tmdbId = tmdbData ? tmdbData.id : Math.floor(900000 + Math.random() * 100000);

                    await db.insert(movies).values({
                        tmdbId,
                        title,
                        slug,
                        overview: tmdbData?.overview || `Live tracked data for ${title}`,
                        releaseDate: tmdbData?.release_date ? new Date(tmdbData.release_date) : new Date(),
                        year: tmdbData?.release_date ? new Date(tmdbData.release_date).getFullYear() : new Date().getFullYear(),
                        posterUrl: tmdbData?.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
                        backdropUrl: tmdbData?.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
                        metadata: {
                            source: 'bms-discovery',
                            bms_movie_id: ev.EventCode,
                            language: ev.EventLanguage,
                            genre: ev.EventGenre
                        }
                    });
                    newMoviesCount++;
                    console.log(`✅ Successfully added to tracking database!`);
                }
            }
        } catch (e) {
            console.error(`Error scanning ${city}:`, e);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`🏁 Discovery Engine Complete. Found ${newMoviesCount} new movies.`);
    process.exit(0);
}

discoverMovies().catch(console.error);
