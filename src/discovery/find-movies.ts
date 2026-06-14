import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getBMSHeaders } from '../utils/headers';

// Expand to 15 cities to catch regional movies
const TARGET_CITIES = ['HYD', 'MUMB', 'NCR', 'BANG', 'CHEN', 'KOCH', 'VIJA', 'VIZA', 'PUNE', 'KOLK', 'AHD', 'CHAND', 'COIM', 'MADU', 'TRIV'];
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;
const DATA_DIR = path.resolve(__dirname, '../../data');

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
    console.log("🔍 Starting Dynamic Movie Discovery Engine...");
    
    // Load existing movies if any, to prevent redundant TMDB calls
    let existingMovies: any[] = [];
    const moviesPath = path.join(DATA_DIR, 'movies.json');
    if (fs.existsSync(moviesPath)) {
        try {
            existingMovies = JSON.parse(fs.readFileSync(moviesPath, 'utf8'));
        } catch(e) {}
    }

    const existingSlugs = new Set(existingMovies.map(m => m.slug));
    const newMovies: any[] = [];

    for (const city of TARGET_CITIES) {
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
                
                if (!existingSlugs.has(slug)) {
                    console.log(`🎬 NEW MOVIE DETECTED: "${title}"`);
                    
                    const tmdbData = await fetchTMDBData(title);
                    const tmdbId = tmdbData ? tmdbData.id : Math.floor(900000 + Math.random() * 100000);

                    const movieObj = {
                        tmdbId,
                        title,
                        slug,
                        overview: tmdbData?.overview || `Live tracked data for ${title}`,
                        releaseDate: tmdbData?.release_date || new Date().toISOString().split('T')[0],
                        year: tmdbData?.release_date ? parseInt(tmdbData.release_date.split('-')[0]) : new Date().getFullYear(),
                        posterUrl: tmdbData?.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
                        backdropUrl: tmdbData?.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
                        metadata: {
                            source: 'bms-discovery',
                            bms_movie_id: ev.EventCode,
                            language: ev.EventLanguage,
                            genre: ev.EventGenre
                        }
                    };

                    newMovies.push(movieObj);
                    existingSlugs.add(slug); // prevent adding same movie multiple times in this loop
                }
            }
        } catch (e) {
            console.error(`Error scanning ${city}:`, e);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    if (newMovies.length > 0) {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const allMovies = [...existingMovies, ...newMovies];
        fs.writeFileSync(moviesPath, JSON.stringify(allMovies, null, 2));
        console.log(`💾 Successfully saved ${newMovies.length} new movies to data/movies.json! Total tracking: ${allMovies.length}`);
    } else {
        console.log(`🏁 Discovery Complete. No new movies found. Total tracking remains: ${existingMovies.length}`);
    }
    
    process.exit(0);
}

discoverMovies().catch(console.error);
