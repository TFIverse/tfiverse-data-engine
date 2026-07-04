import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTPUT_PATH = path.join(DATA_DIR, 'paytm_venues_master.json');

// We will replace this with the 3 URLs the user provides
const PROXY_URLS = [
    process.env.PROXY_URL_1 || "https://districtvenues.peppersalt-env.workers.dev",
    process.env.PROXY_URL_2,
    process.env.PROXY_URL_3
].filter(Boolean);

const WORKER_KEY = process.env.WORKER_KEY || "TfiverseGodMode2026";

async function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

// Simple in-memory cache for pincodes to avoid hitting postal API too many times
const pincodeCache: Record<string, any> = {};

async function fetchGeoHierarchy(pincode: string) {
    if (pincodeCache[pincode]) return pincodeCache[pincode];
    if (!pincode || pincode.length !== 6) return null;

    try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
        if (!res.ok) return null;
        const data = await res.json();
        
        if (data && data[0] && data[0].Status === 'Success' && data[0].PostOffice) {
            const po = data[0].PostOffice[0];
            const geo = {
                state: po.State,
                district: po.District,
                division: po.Region || po.Division,
                mandal: po.Block,
                city: po.Name
            };
            pincodeCache[pincode] = geo;
            return geo;
        }
    } catch (e) {
        console.log(`Failed to fetch pincode ${pincode}`);
    }
    return null;
}

async function discoverVenues() {
    console.log("🚀 Starting Paytm/TicketNew Brute-Force Discovery Engine...");
    console.log(`Using ${PROXY_URLS.length} Proxy Workers...`);

    let discoveredVenues: any[] = [];
    if (fs.existsSync(OUTPUT_PATH)) {
        discoveredVenues = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
        console.log(`Resuming with ${discoveredVenues.length} already mapped.`);
    }

    const seenIds = new Set(discoveredVenues.map(v => v.id));
    
    let proxyIndex = 0;
    
    // TicketNew cinema IDs typically range from 1 to 50000, and some newer ones are higher.
    // We'll scan a targeted range for testing first (e.g. 1 to 10000)
    // Singarayakonda Santhi is probably in the lower thousands.
    const START_ID = 1;
    const END_ID = 50000;
    
    // We will scan in batches
    const BATCH_SIZE = 50;
    const currentDate = new Date().toISOString().split('T')[0];

    for (let currentId = START_ID; currentId <= END_ID; currentId++) {
        if (seenIds.has(currentId)) continue;

        const proxyUrl = PROXY_URLS[proxyIndex % PROXY_URLS.length];
        proxyIndex++;

        // We use the proxy to get sessions for this cinema_id to see if it exists
        // Even if there are no sessions, Paytm API often returns the cinema metadata if it exists
        const url = `${proxyUrl}?cinema_id=${currentId}&date=${currentDate}`;
        
        try {
            const res = await fetch(url, {
                headers: { "x-api-key": WORKER_KEY, "User-Agent": "Mozilla/5.0" }
            } as any);

            if (res.status === 401) {
                console.log(`❌ Proxy Unauthorized. Check WORKER_KEY.`);
                break;
            }

            if (!res.ok) {
                await delay(50);
                continue;
            }

            const json = await res.json();
            
            // Check if cinema metadata is present
            if (json && json.meta && json.meta.cinemas && json.meta.cinemas.length > 0) {
                const c = json.meta.cinemas[0];
                
                // Get hierarchy
                const pincode = c.zip || c.pincode || "";
                let geo = await fetchGeoHierarchy(pincode);
                
                const theater = {
                    id: c.id,
                    providerId: c.providerId || c.id,
                    label: c.name || c.label,
                    state: geo ? geo.state : (c.state || "Unknown"),
                    district: geo ? geo.district : "Unknown",
                    division: geo ? geo.division : "Unknown",
                    mandal: geo ? geo.mandal : "Unknown",
                    city: geo ? geo.city : (c.city || "Unknown"),
                    address: c.address || "",
                    pincode: pincode,
                    latitude: c.lat || c.latitude || 0,
                    longitude: c.lng || c.longitude || 0,
                    chainKey: c.chain || c.providerName || "Independent",
                    clientId: "ticketnew"
                };

                discoveredVenues.push(theater);
                seenIds.add(c.id);
                console.log(`✅ Discovered: ${theater.label} in ${theater.mandal}, ${theater.district}`);
                
                // Save every time we find one
                fs.writeFileSync(OUTPUT_PATH, JSON.stringify(discoveredVenues, null, 2));
            }

        } catch (e: any) {
            // Ignore fetch errors to keep brute-forcing
        }

        // Wait a tiny bit between requests to avoid overloading our own proxy
        await delay(20);
        
        if (currentId % 1000 === 0) {
            console.log(`Scanned up to ID ${currentId}... found ${discoveredVenues.length} theaters so far.`);
        }
    }

    console.log(`🎉 Brute-Force Discovery Complete!`);
    console.log(`💾 Saved to data/paytm_venues_master.json`);
}

discoverVenues().catch(console.error);
