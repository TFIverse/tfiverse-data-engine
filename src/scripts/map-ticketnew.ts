import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTPUT_PATH = path.join(DATA_DIR, 'paytm_venues_master.json');

const headers = {
    'client': 'ticketnew',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
    'Origin': 'https://ticketnew.com',
    'Referer': 'https://ticketnew.com/'
};

async function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

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
    } catch (e) {}
    return null;
}

async function discoverVenues() {
    console.log("🚀 Starting Ultimate Paytm/TicketNew Discovery Engine...");
    
    // 1. Fetch All Cities
    console.log("📥 Fetching master list of all Indian cities...");
    const citiesRes = await fetch('https://apiproxy.paytm.com/v3/movies/search/cities', { headers });
    const citiesData = await citiesRes.json();
    const cities = citiesData.data?.cities || [];
    
    console.log(`🗺️ Found ${cities.length} total cities on TicketNew/Paytm.`);
    
    let discoveredVenues: any[] = [];
    if (fs.existsSync(OUTPUT_PATH)) {
        try {
            discoveredVenues = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
            console.log(`Resuming with ${discoveredVenues.length} already mapped venues.`);
        } catch {
            discoveredVenues = [];
        }
    }
    const seenIds = new Set(discoveredVenues.map(v => v.id));

    // 2. Fetch Cinemas per City
    let cityCount = 0;
    for (const city of cities) {
        cityCount++;
        const citySlug = city.value;
        const url = `https://apiproxy.paytm.com/v3/movies/search/cinemas?city=${citySlug}`;
        
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) {
                await delay(100);
                continue;
            }
            const json = await res.json();
            const cinemas = json.data?.cinemas || [];
            
            if (cinemas.length > 0) {
                console.log(`📍 [${cityCount}/${cities.length}] ${city.name}: Found ${cinemas.length} cinemas`);
            }

            for (const c of cinemas) {
                if (seenIds.has(c.id)) continue;

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
                    city: geo ? geo.city : (c.city || city.name),
                    address: c.address || "",
                    pincode: pincode,
                    latitude: c.lat || c.latitude || 0,
                    longitude: c.lng || c.longitude || 0,
                    chainKey: c.chain || c.providerName || "Independent",
                    clientId: "ticketnew",
                    cityKey: citySlug
                };

                discoveredVenues.push(theater);
                seenIds.add(c.id);
            }
            
            // Periodically save
            if (cityCount % 10 === 0) {
                fs.writeFileSync(OUTPUT_PATH, JSON.stringify(discoveredVenues, null, 2));
            }
            
        } catch (e) {
            console.log(`⚠️ Error fetching cinemas for ${city.name}`);
        }
        
        await delay(50); // Light delay to prevent IP bans
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(discoveredVenues, null, 2));
    console.log(`\n🎉 Discovery Complete!`);
    console.log(`💾 Saved ${discoveredVenues.length} total theaters across India to data/paytm_venues_master.json`);
}

discoverVenues().catch(console.error);

