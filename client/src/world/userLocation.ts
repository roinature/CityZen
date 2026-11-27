export interface UserLocation {
  latitude: number;
  longitude: number;
  /** 'precise' came from the browser's geolocation; 'timezone' is an estimate from the clock settings. */
  source: 'precise' | 'timezone';
}

const STORAGE_KEY = 'cityzen.userLocation';

// Representative coordinates for common time zones; anything else falls back to the UTC offset.
const ZONES: Record<string, [number, number]> = {
  'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12], 'America/Denver': [39.74, -104.99],
  'America/Phoenix': [33.45, -112.07], 'America/Chicago': [41.88, -87.63], 'America/Mexico_City': [19.43, -99.13],
  'America/New_York': [40.71, -74.01], 'America/Toronto': [43.65, -79.38], 'America/Halifax': [44.65, -63.57],
  'America/Anchorage': [61.22, -149.9], 'Pacific/Honolulu': [21.31, -157.86], 'America/Bogota': [4.71, -74.07],
  'America/Lima': [-12.05, -77.04], 'America/Santiago': [-33.45, -70.67], 'America/Sao_Paulo': [-23.55, -46.63],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'America/Caracas': [10.48, -66.9],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Lisbon': [38.72, -9.14],
  'Europe/Madrid': [40.42, -3.7], 'Europe/Paris': [48.86, 2.35], 'Europe/Brussels': [50.85, 4.35],
  'Europe/Amsterdam': [52.37, 4.9], 'Europe/Berlin': [52.52, 13.4], 'Europe/Zurich': [47.38, 8.54],
  'Europe/Rome': [41.9, 12.5], 'Europe/Vienna': [48.21, 16.37], 'Europe/Prague': [50.08, 14.44],
  'Europe/Warsaw': [52.23, 21.01], 'Europe/Stockholm': [59.33, 18.07], 'Europe/Oslo': [59.91, 10.75],
  'Europe/Copenhagen': [55.68, 12.57], 'Europe/Helsinki': [60.17, 24.94], 'Europe/Athens': [37.98, 23.73],
  'Europe/Istanbul': [41.01, 28.98], 'Europe/Kiev': [50.45, 30.52], 'Europe/Kyiv': [50.45, 30.52],
  'Europe/Moscow': [55.76, 37.62], 'Asia/Jerusalem': [32.08, 34.78], 'Asia/Tel_Aviv': [32.08, 34.78],
  'Asia/Beirut': [33.89, 35.5], 'Asia/Amman': [31.95, 35.93], 'Asia/Riyadh': [24.71, 46.68],
  'Asia/Dubai': [25.2, 55.27], 'Asia/Tehran': [35.69, 51.39], 'Asia/Karachi': [24.86, 67.01],
  'Asia/Kolkata': [19.08, 72.88], 'Asia/Calcutta': [19.08, 72.88], 'Asia/Kathmandu': [27.72, 85.32],
  'Asia/Dhaka': [23.81, 90.41], 'Asia/Bangkok': [13.76, 100.5], 'Asia/Ho_Chi_Minh': [10.82, 106.63],
  'Asia/Jakarta': [-6.21, 106.85], 'Asia/Singapore': [1.35, 103.82], 'Asia/Kuala_Lumpur': [3.14, 101.69],
  'Asia/Manila': [14.6, 120.98], 'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Shanghai': [31.23, 121.47],
  'Asia/Taipei': [25.03, 121.57], 'Asia/Seoul': [37.57, 126.98], 'Asia/Tokyo': [35.68, 139.69],
  'Africa/Cairo': [30.04, 31.24], 'Africa/Casablanca': [33.57, -7.59], 'Africa/Lagos': [6.52, 3.38],
  'Africa/Dakar': [14.72, -17.47], 'Africa/Nairobi': [-1.29, 36.82], 'Africa/Addis_Ababa': [9.03, 38.74],
  'Africa/Johannesburg': [-26.2, 28.05], 'Australia/Perth': [-31.95, 115.86], 'Australia/Adelaide': [-34.93, 138.6],
  'Australia/Brisbane': [-27.47, 153.03], 'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96],
  'Pacific/Auckland': [-36.85, 174.76],
};

const REGION_LATITUDE: Record<string, number> = {
  America: 30, Europe: 48, Asia: 30, Africa: 5, Australia: -28, Pacific: -15, Atlantic: 35, Indian: -10, Antarctica: -75,
};

function readStored(): UserLocation | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude)) {
      return { latitude: value.latitude, longitude: value.longitude, source: 'precise' };
    }
  } catch { /* storage may be blocked */ }
  return undefined;
}

/** An instant, permission-free estimate: the last precise fix if we have one, else the device time zone. */
export function estimateUserLocation(): UserLocation {
  const stored = readStored();
  if (stored) return stored;
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { /* ignore */ }
  const known = ZONES[zone];
  if (known) return { latitude: known[0], longitude: known[1], source: 'timezone' };
  const longitude = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
  return { latitude: REGION_LATITUDE[zone.split('/')[0]] ?? 30, longitude, source: 'timezone' };
}

/** True when the browser will hand out a position without prompting. */
export async function hasGeolocationPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

/** Ask the browser for the device position; rounds to ~1 km and remembers it on this device. */
export function requestPreciseLocation(): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser'));
    navigator.geolocation.getCurrentPosition(position => {
      const location: UserLocation = {
        latitude: Math.round(position.coords.latitude * 100) / 100,
        longitude: Math.round(position.coords.longitude * 100) / 100,
        source: 'precise',
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(location)); } catch { /* ignore */ }
      resolve(location);
    }, error => reject(new Error(error.message || 'Location unavailable')), { maximumAge: 3_600_000, timeout: 10_000 });
  });
}
