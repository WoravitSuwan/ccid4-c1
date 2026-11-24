import type { GeoEvent } from '../types/investigation';

const R = 6_371_000; // Earth radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 = north). */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x =
    Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS_TH = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => {
  const i = Math.round(deg / 45) % 8;
  return { th: COMPASS_TH[i], en: COMPASS_EN[i] };
};

/** Offset a coordinate by metres north/east (good enough for city scale). */
export function offsetLatLng(lat: number, lng: number, northM: number, eastM: number): [number, number] {
  const dLat = northM / 111_320;
  const dLng = eastM / (111_320 * Math.cos(rad(lat)));
  return [lat + dLat, lng + dLng];
}

export interface MovementSegment {
  from: GeoEvent;
  to: GeoEvent;
  fromSeq: number;
  toSeq: number;
  distanceM: number;
  dtMs: number;
  speedKmh: number;
  bearing: number;
}

export function sortGeo(events: GeoEvent[]): GeoEvent[] {
  return [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function movementSegments(sorted: GeoEvent[]): MovementSegment[] {
  const out: MovementSegment[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const distanceM = haversineM(a.lat, a.lng, b.lat, b.lng);
    const dtMs = Math.max(0, Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const speedKmh = dtMs > 0 ? distanceM / 1000 / (dtMs / 3_600_000) : 0;
    out.push({ from: a, to: b, fromSeq: i, toSeq: i + 1, distanceM, dtMs, speedKmh, bearing: bearingDeg(a.lat, a.lng, b.lat, b.lng) });
  }
  return out;
}

export const circleAreaKm2 = (radiusM: number) => (Math.PI * radiusM * radiusM) / 1_000_000;

export const GEO_TYPE_LABEL: Record<GeoEvent['type'], { th: string; en: string }> = {
  ip_login: { th: 'เข้าสู่ระบบ (IP)', en: 'IP LOGIN' },
  atm_withdrawal: { th: 'ถอนเงินสด ATM', en: 'ATM CASH-OUT' },
  cell_ping: { th: 'สัญญาณโทรศัพท์', en: 'CELL PING' },
  device_telemetry: { th: 'Telemetry อุปกรณ์', en: 'DEVICE TELEMETRY' },
};
