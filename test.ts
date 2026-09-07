import { getBMSHeaders } from './src/utils/headers';

async function test() {
    const url = `https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode=VHYD&dateCode=20260615`;
    const headers = getBMSHeaders();
    delete headers['X-Forwarded-For'];
    delete headers['X-Real-IP'];
    
    const response = await fetch(url, { headers });
    const text = await response.text();
    console.log("Response text:", text.substring(0, 500));
}

test();
