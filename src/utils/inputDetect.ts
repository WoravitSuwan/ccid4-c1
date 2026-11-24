import type { InputDetection } from '../types/investigation';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';
const RE = {
  caseId: /^CCIB-\d{4}-\d{3,5}$/i,
  evmTx: /^0x[0-9a-fA-F]{64}$/,
  hexTx: /^[0-9a-fA-F]{64}$/,
  evmAddr: /^0x[0-9a-fA-F]{8,40}$/,
  tron: new RegExp(`^T${BASE58}{33}$`),
  btcBech32: /^(bc1|tb1)[02-9ac-hj-np-z]{11,71}$/i,
  btcLegacy: new RegExp(`^[13]${BASE58}{25,34}$`),
};

export const isBtcTxid = (q: string) => RE.hexTx.test(q.trim());
export const isBtcAddress = (q: string) => RE.btcBech32.test(q.trim()) || RE.btcLegacy.test(q.trim());

/** Normalise identifiers for cross-case matching (account no. → digits only, hex → lower-case). */
export function normalizeIdentifier(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/[\s-]/g, '');
  if (/^\d{10,12}$/.test(digits)) return digits;
  if (/^0x/i.test(s) || RE.hexTx.test(s)) return s.toLowerCase();
  if (RE.caseId.test(s)) return s.toUpperCase();
  return s;
}

/** Smart search auto-detection → drives the input-type pill. */
export function detectInput(raw: string): InputDetection {
  const q = raw.trim();
  const normalized = normalizeIdentifier(q);
  if (!q) return { type: 'unknown', label: 'รอข้อมูล', hint: 'พิมพ์เลขบัญชี / Wallet / TxID / รหัสคดี', normalized };

  if (RE.caseId.test(q)) return { type: 'case_id', label: 'รหัสคดี', hint: 'Case ID · CCIB-YYYY-NNNN', normalized };
  if (RE.evmTx.test(q)) return { type: 'txid', label: 'TxID / Hash', hint: 'EVM TxID (ERC-20/BEP-20)', chain: 'ERC-20', normalized };
  if (RE.hexTx.test(q))
    return { type: 'txid', label: 'TxID / Hash', hint: 'BTC / TRON TxID (64 hex) · ตรวจสอบสดได้', chain: 'BTC', normalized };
  if (RE.evmAddr.test(q))
    return { type: 'crypto_wallet', label: 'Crypto Wallet', hint: q.length === 42 ? 'EVM Address (ERC-20)' : 'EVM Deposit Tag (ย่อ)', chain: 'ERC-20', normalized };
  if (RE.tron.test(q)) return { type: 'crypto_wallet', label: 'Crypto Wallet', hint: 'TRON Address (TRC-20)', chain: 'TRC-20', normalized };
  if (isBtcAddress(q)) return { type: 'crypto_wallet', label: 'Crypto Wallet', hint: 'Bitcoin Address · ตรวจสอบสดได้', chain: 'BTC', normalized };

  const digits = q.replace(/[\s-]/g, '');
  if (/^\d{10,12}$/.test(digits))
    return { type: 'bank_account', label: 'เลขบัญชีธนาคาร', hint: `บัญชีธนาคาร ${digits.length} หลัก`, normalized: digits };
  if (/^\d{3,9}$/.test(digits)) return { type: 'unknown', label: 'เลขไม่ครบ', hint: 'เลขบัญชีไทยมี 10–12 หลัก', normalized };

  return { type: 'unknown', label: 'ไม่ทราบรูปแบบ', hint: 'จะสังเคราะห์คดีจากรูปแบบทั่วไป', normalized };
}

/** 1042886191 → 104-2-88619-1 (Thai 10-digit display convention) */
export function formatThaiAccount(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 10) return digits;
  return `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d.slice(9)}`;
}
