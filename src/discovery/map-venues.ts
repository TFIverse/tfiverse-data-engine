import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getBMSHeaders } from '../utils/headers';

const DATA_DIR = path.resolve(__dirname, '../../data');

async function mapAllVenues() {
    console.log("🌍 Starting Full Venue Discovery Engine (Small Towns & Villages)...");
    
    console.log("📥 Fetching master region list from BookMyShow...");
    const regionUrl = 'https://in.bookmyshow.com/api/v2/mobile/regions';
    const regions = [];

    try {
        const res = await fetch(regionUrl, { headers: getBMSHeaders() } as any);
        if (res.ok) {
            const data = await res.json();
            for (const r of data.BookMyShow?.TopCities || []) regions.push(r);
            for (const r of data.BookMyShow?.OtherCities || []) regions.push(r);
            console.log(`✅ Found ${regions.length} total regions/cities.`);
        } else {
            console.error("❌ Failed to fetch regions. Status:", res.status);
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ Network error fetching regions:", e);
        process.exit(1);
    }

    const venuesList: any[] = [];
    
    // In production we loop all 1200+, for now we loop top 50 to avoid timeout locally.
    // GitHub actions runs the full list since it has 6 hour limits.
    const runFull = process.env.GITHUB_ACTIONS === 'true';
    const testRegions = runFull ? regions : regions.slice(0, 50);

    console.log(`🕵️‍♂️ Discovering theaters across ${testRegions.length} regions...`);
    
    for (const region of testRegions) {
        const code = region.RegionCode;
        const url = `https://in.bookmyshow.com/api/v2/mobile/cinemas?regionCode=${code}`;
        
        try {
            const res = await fetch(url, { headers: getBMSHeaders() } as any);
            if (res.ok) {
                const data = await res.json();
                const venues = data.BookMyShow?.Venues || [];
                
                for (const v of venues) {
                    venuesList.push({
                        code: v.VenueCode,
                        name: v.VenueName,
                        city: region.RegionName,
                        state: 'Unknown' // We can map state later from a master dict
                    });
                }
                console.log(`   📍 ${region.RegionName} (${code}): Found ${venues.length} theaters.`);
            }
        } catch (e) {
            console.warn(`   ⚠️ Failed to scan ${region.RegionName}`);
        }
        await new Promise(r => setTimeout(r, 500)); // Rate limit protection
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    
    const venuesPath = path.join(DATA_DIR, 'bms_venues.json');
    fs.writeFileSync(venuesPath, JSON.stringify(venuesList, null, 2));

    console.log(`\n🎉 Discovery Complete! Found ${venuesList.length} theaters. Saved to data/bms_venues.json`);
    process.exit(0);
}

mapAllVenues().catch(console.error);
