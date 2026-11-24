import type { Currency } from '../types/investigation';

export const TZ = 'Asia/Bangkok';

const nf = (min: number, max: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF0 = nf(0, 0);
const NF2 = nf(2, 2);
const NF8 = nf(8, 8);

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return digits === 0 ? NF0.format(n) : nf(digits, digits).format(n);
}

/** ฿500,000.00 · 8,800.00 USDT · 0.12345678 BTC */
export function fmtMoney(n: number, currency: Currency, opts: { decimals?: number; sign?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '−' : '';
  const v = Math.abs(n);
  if (currency === 'THB') {
    const d = opts.decimals ?? (Number.isInteger(round2(v)) ? 0 : 2);
    return `${sign}฿${d === 0 ? NF0.format(v) : nf(d, d).format(v)}`;
  }
  if (currency === 'BTC') return `${sign}${NF8.format(v)} BTC`;
  const d = opts.decimals ?? 2;
  return `${sign}${d === 0 ? NF0.format(v) : d === 2 ? NF2.format(v) : nf(d, d).format(v)} USDT`;
}

/** Compact money for badges: ฿500K · 8.8K USDT */
export function fmtMoneyShort(n: number, currency: Currency): string {
  const v = Math.abs(n);
  const unit = currency === 'THB' ? '' : ` ${currency}`;
  const pre = currency === 'THB' ? '฿' : '';
  if (currency === 'BTC') return `${v.toFixed(4)} BTC`;
  if (v >= 1_000_000) return `${pre}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M${unit}`;
  if (v >= 10_000) return `${pre}${(v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K${unit}`;
  if (v >= 1000) return `${pre}${(v / 1000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}K${unit}`;
  return `${pre}${NF0.format(v)}${unit}`;
}

export function fmtPct(ratio: number, digits = 2): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const dateIsoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const thaiDateLong = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'long' });
const thaiDateShort = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** 14:32:10 (Asia/Bangkok) */
export const fmtTime = (v: string | number | Date) => timeFmt.format(toDate(v));
/** 14:32 */
export const fmtHM = (v: string | number | Date) => fmtTime(v).slice(0, 5);
/** 2026-11-23 14:32:10 */
export const fmtDateTime = (v: string | number | Date) => `${dateIsoFmt.format(toDate(v))} ${fmtTime(v)}`;
/** 23 พฤศจิกายน 2569 */
export const fmtThaiDate = (v: string | number | Date) => thaiDateLong.format(toDate(v));
/** 23 พ.ย. 69 */
export const fmtThaiDateShort = (v: string | number | Date) => thaiDateShort.format(toDate(v));
/** 23 พฤศจิกายน 2569 เวลา 14:32 น. */
export const fmtThaiDateTime = (v: string | number | Date) => `${fmtThaiDate(v)} เวลา ${fmtHM(v)} น.`;

/** 1h 48m · 12m 30s · 2d 3h */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtAgo(iso: string | number, now: number = Date.now()): string {
  const diff = now - (typeof iso === 'number' ? iso : Date.parse(iso));
  if (diff < 45_000) return 'เมื่อสักครู่';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ${m % 60} นาทีที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export const fmtCoord = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

/** TQn9Y2…cbLSE */
export function shortId(s: string, head = 6, tail = 5): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
export const toThaiDigits = (s: string) => s.replace(/[0-9]/g, (d) => THAI_DIGITS[Number(d)]);

export const BANK_FULL_NAME: Record<string, string> = {
  KBANK: 'ธนาคารกสิกรไทย จำกัด (มหาชน)',
  SCB: 'ธนาคารไทยพาณิชย์ จำกัด (มหาชน)',
  KTB: 'ธนาคารกรุงไทย จำกัด (มหาชน)',
  BBL: 'ธนาคารกรุงเทพ จำกัด (มหาชน)',
  TTB: 'ธนาคารทหารไทยธนชาต จำกัด (มหาชน)',
  BAY: 'ธนาคารกรุงศรีอยุธยา จำกัด (มหาชน)',
  GSB: 'ธนาคารออมสิน',
};

export const METHOD_LABEL = {
  proportional: 'Proportional (Haircut %)',
  fifo: 'FIFO (First-In, First-Out)',
} as const;

export const METHOD_LABEL_TH = {
  proportional: 'วิธีสัดส่วน (Proportional / Haircut)',
  fifo: 'วิธีเข้าก่อน-ออกก่อน (FIFO)',
} as const;
