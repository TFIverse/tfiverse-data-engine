import { getBMSHeaders } from './src/utils/headers';

async function test() {
  const headers = getBMSHeaders();
  console.log("Headers:", headers);
  // Let's try searching for Peddi
  const res = await fetch('https://in.bookmyshow.com/api/v2/mobile/search?q=Peddi', { headers });
  console.log(res.status);
  const data = await res.json();
  console.log(JSON.stringify(data).substring(0, 500));
}

test().catch(console.error);
