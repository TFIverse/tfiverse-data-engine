import requests
url = "https://in.bookmyshow.com/api/v2/mobile/showtimes/byvenue?venueCode=STHV&dateCode=20260906"
headers = {
    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 14; SM-S918B Build/UP1A.231005.007) BookMyShow/14.0.1",
    "x-bms-id": "bms-android-app",
    "x-platform": "ANDROID",
    "x-app-version": "14.0.1"
}
r = requests.get(url, headers=headers)
print(r.status_code)
print(r.text[:500])
