/**
 * BMS Android App Header Generator
 * Spoofs random Android devices and generates necessary x-bms-id headers.
 */

const USER_AGENTS = [
    'Dalvik/2.1.0 (Linux; U; Android 13; SM-G991B Build/TP1A.220624.014) BookMyShow/13.7.0',
    'Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Pro Build/SQ3A.220705.003) BookMyShow/13.6.5',
    'Dalvik/2.1.0 (Linux; U; Android 14; SM-S918B Build/UP1A.231005.007) BookMyShow/14.0.1',
    'Dalvik/2.1.0 (Linux; U; Android 11; OnePlus 8T Build/RP1A.201005.001) BookMyShow/13.5.0',
];

const JIO_AIRTEL_IPS = [
    '49.36', '49.37', '49.43', '157.32', '157.33', // Jio
    '106.208', '106.209', '122.161', '122.162' // Airtel
];

function getRandomIP() {
    const prefix = JIO_AIRTEL_IPS[Math.floor(Math.random() * JIO_AIRTEL_IPS.length)];
    return `${prefix}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

export function getBMSHeaders() {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const ip = getRandomIP();

    return {
        'User-Agent': ua,
        'Accept': 'application/json',
        'x-bms-id': `bms-android-app`,
        'x-app-version': '14.0.1',
        'x-platform': 'ANDROID',
        'X-Forwarded-For': ip,
        'X-Real-IP': ip,
        'Connection': 'keep-alive'
    };
}
