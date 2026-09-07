import * as fs from 'fs';
import * as path from 'path';

function checkData(filename) {
    const p = path.join(__dirname, 'data', filename);
    if (!fs.existsSync(p)) {
        console.log(`\n❌ ${filename} not found.`);
        return;
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    
    const venues = new Set();
    const cities = new Set();
    const states = new Set();
    
    let totalRevenue = 0;
    
    for (const d of data) {
        if (d.venue) venues.add(d.venue);
        if (d.city) cities.add(d.city);
        if (d.state) states.add(d.state);
        totalRevenue += (d.grossRevenue || 0);
    }
    
    console.log(`\n📊 Stats for ${filename}:`);
    console.log(`  - Total Sessions: ${data.length}`);
    console.log(`  - Unique Venues: ${venues.size}`);
    console.log(`  - Unique Cities: ${cities.size}`);
    console.log(`  - Unique States: ${states.size}`);
    console.log(`  - Total Gross: ₹${totalRevenue.toLocaleString()}`);
}

checkData('latest_bms_live_data.json');
checkData('latest_paytm_live_data.json');
