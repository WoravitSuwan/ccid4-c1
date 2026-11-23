/**
 * Realistic mock investigation dataset (3 cases) + cross-case shared-entity lookup helpers.
 * All names are masked/fictional; identifiers are synthetic but format-valid.
 * Timestamps are anchored relative to app start so the command center always feels "live".
 */
import type {
  CaseOfficer,
  CrossCaseLink,
  IdentifierHit,
  InvestigationCase,
  MatchEvidence,
} from '../types/investigation';
import { haversineM } from '../utils/geo';
import { normalizeIdentifier } from '../utils/inputDetect';

/** Simulation epoch: the moment the app was opened. */
export const DATA_EPOCH = Math.floor(Date.now() / 1000) * 1000;
/** ISO timestamp `min` minutes (+ `sec` seconds) before app start. */
export const ago = (min: number, sec = 0) => new Date(DATA_EPOCH - (min * 60 + sec) * 1000).toISOString();

const OFFICER_BKK: CaseOfficer = {
  rank: 'พ.ต.ท.',
  name: 'ณัฐพล วงศ์ไพศาล',
  position: 'สารวัตร (สอบสวน) กองกำกับการ 1',
  unit: 'กองกำกับการ 1 กองบังคับการตำรวจสืบสวนสอบสวนอาชญากรรมทางเทคโนโลยี 1',
  unitShort: 'กก.1 บก.สอท.1',
  phone: '1441',
};
const OFFICER_BKK2: CaseOfficer = {
  rank: 'พ.ต.ต.',
  name: 'ปริญญา ศรีสวัสดิ์',
  position: 'สารวัตร (สอบสวน) กองกำกับการ 3',
  unit: 'กองกำกับการ 3 กองบังคับการตำรวจสืบสวนสอบสวนอาชญากรรมทางเทคโนโลยี 2',
  unitShort: 'กก.3 บก.สอท.2',
  phone: '1441',
};
const OFFICER_CNX: CaseOfficer = {
  rank: 'พ.ต.ท.',
  name: 'กิตติศักดิ์ อินทรวงศ์',
  position: 'สารวัตร (สอบสวน) กองกำกับการ 2',
  unit: 'กองกำกับการ 2 กองบังคับการตำรวจสืบสวนสอบสวนอาชญากรรมทางเทคโนโลยี 5',
  unitShort: 'กก.2 บก.สอท.5',
  phone: '1441',
};

// ═════════════════════════ CASE #1 — CCIB-2026-0892 ═════════════════════════
const CASE_0892: InvestigationCase = {
  id: 'CCIB-2026-0892',
  primaryKey: '892-4-10928-3',
  primaryEntityId: 'c1-mule1',
  title: 'หลอกลงทุนสินทรัพย์ดิจิทัลข้ามแพลตฟอร์ม',
  titleEn: 'Cross-Platform Digital Asset Investment Scam',
  typology: 'investment_scam',
  lossAmount: 500_000,
  reportNo: 'TPO-6911-00441873',
  openedAt: ago(160),
  victimProfile: {
    name: 'นาง ส****** ป*******',
    age: 54,
    province: 'กรุงเทพมหานคร (เขตบางกะปิ)',
    channel: 'LINE OpenChat "กองทุนคริปโต VIP 30%/เดือน"',
  },
  modusOperandi:
    'คนร้ายตั้งกลุ่ม LINE OpenChat ชักชวนลงทุนเหรียญ USDT ผ่านแพลตฟอร์มปลอม แสดงกำไรหลอกในแอป แล้วให้โอนเงิน "ค่าปลดล็อกถอนกำไร" เข้าบัญชีม้า',
  summary:
    'เงินผู้เสียหาย ฿500,000 ถูกแยกเป็นเงินสด ฿180,000 (ATM-KTB-4419) และโอนต่อชั้นที่ 2 ก่อนแลกเป็น USDT ผ่าน P2P OTC เข้ากระเป๋า Pool แล้ว Bridge เข้า Exchange — สัญญาณมือถือผู้ควบคุมกระเป๋าล่าสุดอยู่ใกล้ ATM-SCB-8821',
  usdtThbRate: 35,
  btcThbRate: 3_150_000,
  searchRadiusM: 1800,
  analystAdjustment: { points: 0, reason: '' },
  officer: OFFICER_BKK,
  liveAlertCount: 0,
  entities: [
    {
      id: 'c1-victim', type: 'victim', role: 'VICTIM · ORIGIN', label: 'บัญชีผู้เสียหาย (ต้นทาง)',
      identifier: '104-2-88319-1', institution: 'KBANK', holderName: 'นาง ส****** ป*******', currency: 'THB', status: 'origin',
      notes: 'โอนผ่าน K PLUS ตามคำแนะนำ "ที่ปรึกษาการลงทุน" ในกลุ่ม LINE',
    },
    {
      id: 'c1-mule1', type: 'mule_bank', role: 'MULE TIER-1', label: 'บัญชีม้าชั้นที่ 1 (รับเงินผู้เสียหาย)',
      identifier: '892-4-10928-3', institution: 'SCB', holderName: 'นาย ธ****** ก*******', currency: 'THB', status: 'flagged',
      ip: '171.97.84.212', asn: 'AS7470', isp: 'TRUE INTERNET Co.,Ltd.', device: 'Android 14 · Samsung SM-A546E',
      fingerprints: ['DEV-7F3C-A51'], accountOpened: '2026-09-02',
      notes: 'เปิดบัญชีใหม่ < 90 วัน · ผูก PromptPay เบอร์ 08x-xxx-4471 · ไม่มีรายการเดินบัญชีปกติ',
      tags: ['New Account < 90d', 'Rapid Pass-Through'],
    },
    {
      id: 'c1-atm1', type: 'cash_out', role: 'ATM CASH-OUT #1', label: 'จุดถอนเงินสด #1 (Cardless ×9)',
      identifier: 'ATM-KTB-4419', institution: 'KTB', currency: 'THB', status: 'cashed_out', terminalId: 'ATM-KTB-4419',
      locationName: 'ถ.พระราม 9 – รัชดาภิเษก (ใกล้ MRT พระราม 9)', chokepoint: 'ATM_CASHOUT',
    },
    {
      id: 'c1-mule2', type: 'mule_bank', role: 'MULE TIER-2', label: 'บัญชีม้าชั้นที่ 2 (บัญชีพักเงินปะปน)',
      identifier: '401-9-77210-5', institution: 'KTB', holderName: 'นางสาว พ****** จ*******', currency: 'THB', status: 'flagged',
      device: 'iOS 18 · iPhone 13', fingerprints: ['DEV-22B9-X10'], accountOpened: '2025-12-14',
      pool: {
        fifoVictimFirst: true,
        externalOther: { amount: 100_000, at: ago(118), source: 'โอนเข้าจากบัญชีไม่ทราบที่มา BAY 020-3-xxxx8-1' },
        note: 'เงินผู้เสียหายเข้าก่อน (−146 นาที) เงินอื่นเข้าภายหลัง (−118 นาที)',
      },
      tags: ['Mixed Pool', 'Reused Mule'],
    },
    {
      id: 'c1-pool', type: 'crypto_wallet', role: 'CRYPTO POOL · MIXED', label: 'กระเป๋าคริปโตพักเงินรวม (Pool)',
      identifier: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', institution: 'TRON Network', chain: 'TRC-20', currency: 'USDT', status: 'monitoring',
      chokepoint: 'HIGH_TAINT_POOL',
      pool: {
        fifoVictimFirst: true,
        externalOther: { amount: 3200, at: ago(80), source: 'รับจาก 2 กระเป๋าภายนอก (TXr8…f2Qa, TLm4…9KdE)' },
        note: 'USDT ของผู้เสียหายเข้าก่อน (−97 นาที) USDT อื่นเข้าภายหลัง (−80 นาที)',
      },
      notes: 'ผู้ควบคุมใช้ TronLink บนอุปกรณ์ที่พบสัญญาณใกล้ ATM-SCB-8821',
      tags: ['USDT TRC-20', 'Mixed Pool'],
    },
    {
      id: 'c1-exch', type: 'exchange', role: 'EXCHANGE · KYC CHOKEPOINT', label: 'บัญชีฝาก Exchange (จุดสกัด KYC)',
      identifier: '0x7b4e92c188d1f04a', institution: 'TH-DAX Exchange A', chain: 'ERC-20', currency: 'USDT', status: 'monitoring',
      chokepoint: 'EXCHANGE_KYC', fingerprints: ['EXUID:7731904'],
      notes: 'Deposit tag ผูกกับบัญชีผู้ใช้ UID-7731904 · ผู้ให้บริการได้รับอนุญาตจาก ก.ล.ต.',
      tags: ['Licensed DA Exchange', 'Freeze Target'],
    },
  ],
  edges: [
    { id: 'c1-e1', source: 'c1-victim', target: 'c1-mule1', amount: 500_000, currency: 'THB', timestamp: ago(172, 55), txRef: 'KB-ORFT-692311-884102', channel: 'K PLUS → SCB (ORFT)', rail: 'fiat' },
    { id: 'c1-e2', source: 'c1-mule1', target: 'c1-mule2', amount: 320_000, currency: 'THB', timestamp: ago(146, 20), txRef: 'SCB-ORFT-692311-201733', channel: 'SCB EASY → KTB (ORFT)', rail: 'fiat' },
    { id: 'c1-e3', source: 'c1-mule1', target: 'c1-atm1', amount: 180_000, currency: 'THB', timestamp: ago(124, 48), txRef: 'KTB-ATM4419-CL-093318', channel: 'Cardless ATM ×9 รายการ', rail: 'cash', txCount: 9 },
    {
      id: 'c1-e4', source: 'c1-mule2', target: 'c1-pool', amount: 308_000, currency: 'THB', receivedAmount: 8800, receivedCurrency: 'USDT', fxRate: 35,
      timestamp: ago(97, 12), txRef: '9c2e5f0b7a1d4e63b8f0a2c94d7e1b56a3f8c0d2e9b47a61c5d3f0e8b2a7c914', channel: 'P2P OTC · THB→USDT @ ฿35.00', rail: 'cross_rail',
    },
    { id: 'c1-e5', source: 'c1-pool', target: 'c1-exch', amount: 7200, currency: 'USDT', timestamp: ago(54, 30), txRef: '0x4f1a9c3e7b2d80e5a6c4f9b1d3e7a2c8f0b5d9e1a3c7f2b4d8e0a6c9f1b3d5e7', channel: 'Bridge TRC-20 → ERC-20 · Deposit', rail: 'crypto' },
  ],
  geoEvents: [
    {
      id: 'c1-g1', entityId: 'c1-mule1', type: 'ip_login', timestamp: ago(150, 5), lat: 13.7794, lng: 100.5746,
      locationName: 'รัชดาภิเษก – ลาดพร้าว (ใกล้ MRT ลาดพร้าว)', ip: '171.97.84.212', asn: 'AS7470 · TRUE INTERNET',
      device: 'Samsung SM-A546E · DEV-7F3C-A51', accuracyM: 350,
    },
    {
      id: 'c1-g2', entityId: 'c1-atm1', type: 'atm_withdrawal', timestamp: ago(124, 48), lat: 13.7582, lng: 100.5657,
      locationName: 'ถ.พระราม 9 – รัชดาภิเษก', terminalId: 'ATM-KTB-4419', amount: 180_000, currency: 'THB', accuracyM: 15,
    },
    {
      id: 'c1-g3', entityId: 'c1-pool', type: 'cell_ping', timestamp: ago(9, 14), lat: 13.7519, lng: 100.6154,
      locationName: 'ถ.พระราม 9 – รามคำแหง (ใกล้ ATM-SCB-8821)', terminalId: 'ATM-SCB-8821', cellId: 'eNB 520-03-41187 · AIS',
      accuracyM: 600, searchRadiusM: 1800,
    },
  ],
  timeline: [
    { id: 'c1-t1', timestamp: ago(172, 55), kind: 'transfer', severity: 'warning', title: 'ผู้เสียหายโอนเข้าบัญชีม้าชั้นที่ 1', detail: 'KBANK 104-2-88319-1 → SCB 892-4-10928-3', entityId: 'c1-mule1', edgeId: 'c1-e1', amount: 500_000, currency: 'THB' },
    { id: 'c1-t2', timestamp: ago(150, 5), kind: 'login', severity: 'info', title: 'ม้าชั้นที่ 1 เข้าสู่ระบบ SCB EASY', detail: 'IP 171.97.84.212 · AS7470 TRUE · DEV-7F3C-A51', entityId: 'c1-mule1', geoEventId: 'c1-g1' },
    { id: 'c1-t3', timestamp: ago(146, 20), kind: 'transfer', severity: 'warning', title: 'โอนต่อบัญชีม้าชั้นที่ 2 (KTB)', detail: 'SCB 892-4-10928-3 → KTB 401-9-77210-5', entityId: 'c1-mule2', edgeId: 'c1-e2', amount: 320_000, currency: 'THB' },
    { id: 'c1-t4', timestamp: ago(124, 48), kind: 'withdrawal', severity: 'critical', title: 'ถอนเงินสด ATM-KTB-4419 ×9', detail: 'Cardless ATM · ถ.พระราม 9 – รัชดาภิเษก', entityId: 'c1-atm1', edgeId: 'c1-e3', geoEventId: 'c1-g2', amount: 180_000, currency: 'THB' },
    { id: 'c1-t5', timestamp: ago(118), kind: 'deposit', severity: 'info', title: 'เงินแหล่งอื่นเข้าบัญชีม้าชั้นที่ 2', detail: 'เงินปะปน (Mixed Funds) จาก BAY 020-3-xxxx8-1', entityId: 'c1-mule2', amount: 100_000, currency: 'THB' },
    { id: 'c1-t6', timestamp: ago(97, 12), kind: 'swap', severity: 'warning', title: 'แลก THB → USDT ผ่าน P2P OTC', detail: '฿308,000 → 8,800 USDT (TRC-20) เข้า TQn9…cbLSE', entityId: 'c1-pool', edgeId: 'c1-e4', amount: 8800, currency: 'USDT' },
    { id: 'c1-t7', timestamp: ago(80), kind: 'deposit', severity: 'info', title: 'USDT จากกระเป๋าอื่นเข้า Pool', detail: '3,200 USDT จาก 2 กระเป๋าภายนอก (เงินปะปน)', entityId: 'c1-pool', amount: 3200, currency: 'USDT' },
    { id: 'c1-t8', timestamp: ago(54, 30), kind: 'transfer', severity: 'critical', title: 'Bridge เข้า Exchange (จุดสกัด KYC)', detail: '7,200 USDT · TRC-20 → ERC-20 → 0x7b4e92c188d1f04a', entityId: 'c1-exch', edgeId: 'c1-e5', amount: 7200, currency: 'USDT' },
    { id: 'c1-t9', timestamp: ago(9, 14), kind: 'ping', severity: 'critical', title: 'สัญญาณมือถือใกล้ ATM-SCB-8821', detail: 'eNB 520-03-41187 (AIS) · ±600 m · รัศมีค้นหา 1,800 m', entityId: 'c1-pool', geoEventId: 'c1-g3' },
  ],
  liveScript: [
    {
      kind: 'atm_withdrawal', fromEntityId: 'c1-mule2', amount: 20_000, channel: 'Cardless ATM ×1 รายการ', txCount: 1,
      newEntity: { type: 'cash_out', role: 'ATM CASH-OUT #2', label: 'จุดถอนเงินสด #2 (LIVE)', identifier: 'ATM-SCB-8821', institution: 'SCB', currency: 'THB', terminalId: 'ATM-SCB-8821', locationName: 'ถ.พระราม 9 – รามคำแหง', chokepoint: 'ATM_CASHOUT', status: 'cashed_out' },
      geo: { type: 'atm_withdrawal', lat: 13.7524, lng: 100.6161, locationName: 'ถ.พระราม 9 – รามคำแหง (ตู้ ATM-SCB-8821)', terminalId: 'ATM-SCB-8821', amount: 20_000, currency: 'THB', accuracyM: 15, searchRadiusM: 1500, entityKey: 'target' },
      title: 'LIVE: ถอนเงินสด ATM-SCB-8821', detail: 'บัญชีม้าชั้นที่ 2 (KTB 401-9-77210-5) ถอนไม่ใช้บัตร ฿20,000 — ตรงจุดสัญญาณมือถือล่าสุด', severity: 'critical',
    },
    {
      kind: 'crypto_transfer', fromEntityId: 'c1-pool', amount: 1500, channel: 'Peel-chain TRC-20',
      newEntity: { type: 'crypto_wallet', role: 'PEEL WALLET (LIVE)', label: 'กระเป๋าแตกยอด (Peel-chain)', identifier: 'TPjK7rW2mX9cQe4LsVb8NhD3fYu6Ga1ZoR', institution: 'TRON Network', chain: 'TRC-20', currency: 'USDT' },
      geo: { type: 'device_telemetry', lat: 13.7568, lng: 100.6275, locationName: 'รามคำแหง 24 (TronLink session)', ip: '171.97.90.17', asn: 'AS7470 · TRUE INTERNET', device: 'TronLink · DEV-7F3C-A51', accuracyM: 250, entityKey: 'source' },
      title: 'LIVE: Pool แตกยอด 1,500 USDT', detail: 'TQn9…cbLSE → TPjK…1ZoR · IP 171.97.90.17 รามคำแหง 24', severity: 'warning',
    },
    {
      kind: 'atm_withdrawal', fromEntityId: 'c1-mule2', amount: 20_000, channel: 'Cardless ATM ×1 รายการ', txCount: 1,
      newEntity: { type: 'cash_out', role: 'ATM CASH-OUT #3', label: 'จุดถอนเงินสด #3 (LIVE)', identifier: 'ATM-BBL-6203', institution: 'BBL', currency: 'THB', terminalId: 'ATM-BBL-6203', locationName: 'หัวหมาก – รามคำแหง 2', chokepoint: 'ATM_CASHOUT', status: 'cashed_out' },
      geo: { type: 'atm_withdrawal', lat: 13.7412, lng: 100.6398, locationName: 'หัวหมาก – รามคำแหง 2 (ตู้ ATM-BBL-6203)', terminalId: 'ATM-BBL-6203', amount: 20_000, currency: 'THB', accuracyM: 15, searchRadiusM: 1500, entityKey: 'target' },
      title: 'LIVE: ถอนเงินสด ATM-BBL-6203', detail: 'เคลื่อนที่ไปทางตะวันออกเฉียงใต้ · ถอนอีก ฿20,000', severity: 'critical',
    },
  ],
};

// ═════════════════════════ CASE #2 — CCIB-2026-1044 ═════════════════════════
const CASE_1044: InvestigationCase = {
  id: 'CCIB-2026-1044',
  primaryKey: '0x9f8c44b2e10a773c5d918204f6b2e190a8c771a4',
  primaryEntityId: 'c2-agg',
  title: 'แก๊งคอลเซ็นเตอร์แอบอ้างเจ้าหน้าที่ & ฟอกเงินข้ามชั้น',
  titleEn: 'Call-Center Official Impersonation & Multi-Layer Laundering',
  typology: 'call_center',
  lossAmount: 850_000,
  reportNo: 'TPO-6911-00439207',
  openedAt: ago(1350),
  victimProfile: {
    name: 'นาย ว****** ท*******',
    age: 67,
    province: 'นนทบุรี (อ.ปากเกร็ด)',
    channel: 'โทรศัพท์แอบอ้างเจ้าหน้าที่ ป.ป.ส. / วิดีโอคอล "สถานีตำรวจ" ปลอม',
  },
  modusOperandi:
    'คนร้ายโทรแอบอ้างเป็นเจ้าหน้าที่ อ้างว่าบัญชีผู้เสียหายพัวพันคดียาเสพติด ให้โอนเงินเข้า "บัญชีตรวจสอบของทางราชการ" แล้วฟอกต่อเป็น USDT ผ่านกระเป๋า Aggregator',
  summary:
    'เงินผู้เสียหาย ฿850,000 ปะปนกับเงิน ฿400,000 จากบัญชีม้าป้อนเงิน (พบในคดีอื่น) ใน BBL ก่อนแลกเป็น 22,500 USDT เข้ากระเป๋า Aggregator และฝากเข้า Exchange 18,000 USDT — Exchange UID เดียวกับคดี 0892',
  usdtThbRate: 35,
  btcThbRate: 3_150_000,
  searchRadiusM: 2000,
  analystAdjustment: { points: 7, reason: 'ข่าวกรอง ศูนย์ AOC 1441: บัญชีปลายทางเชื่อมเครือข่ายคอลเซ็นเตอร์ข้ามชาติ มีผู้เสียหายรายอื่นในระบบ 14 ราย' },
  officer: OFFICER_BKK2,
  liveAlertCount: 0,
  entities: [
    {
      id: 'c2-victim', type: 'victim', role: 'VICTIM · ORIGIN', label: 'บัญชีผู้เสียหาย (ต้นทาง)',
      identifier: '221-0-64912-8', institution: 'KBANK', holderName: 'นาย ว****** ท*******', currency: 'THB', status: 'origin',
      notes: 'ผู้เสียหายสูงอายุ 67 ปี ถูกข่มขู่ผ่านวิดีโอคอลนาน 3 ชั่วโมง',
    },
    {
      id: 'c2-feeder', type: 'mule_bank', role: 'FEEDER MULE', label: 'บัญชีม้าป้อนเงิน (เงินแหล่งอื่น)',
      identifier: '401-9-77210-5', institution: 'KTB', holderName: 'นางสาว พ****** จ*******', currency: 'THB', status: 'flagged',
      device: 'iOS 18 · iPhone 13', fingerprints: ['DEV-22B9-X10'],
      notes: 'เงิน ฿400,000 ที่ป้อนเข้า BBL ไม่ใช่เงินของผู้เสียหายรายนี้ (อาจเป็นเงินของผู้เสียหายรายอื่น)',
      tags: ['Reused Mule'],
    },
    {
      id: 'c2-bbl', type: 'mule_bank', role: 'MULE · MIXED POOL', label: 'บัญชีม้ารวมเงิน (ปะปน)',
      identifier: '112-8-55419-0', institution: 'BBL', holderName: 'นาย อ****** ร*******', currency: 'THB', status: 'flagged',
      ip: '49.228.119.84', asn: 'AS131445', isp: 'Advanced Wireless Network (AIS)', device: 'Android 13 · OPPO A78',
      fingerprints: ['DEV-91AC-OP7'], accountOpened: '2026-07-19',
      pool: { fifoVictimFirst: true, note: 'เงินผู้เสียหายเข้าก่อน (−1,510 นาที) เงินบัญชีป้อนเข้าภายหลัง (−1,478 นาที)' },
      tags: ['Mixed Pool', 'High Velocity'],
    },
    {
      id: 'c2-agg', type: 'crypto_wallet', role: 'AGGREGATOR WALLET', label: 'กระเป๋ารวบรวมเงิน (Aggregator)',
      identifier: '0x9f8c44b2e10a773c5d918204f6b2e190a8c771a4', institution: 'Ethereum Network', chain: 'ERC-20', currency: 'USDT', status: 'monitoring',
      chokepoint: 'HIGH_TAINT_POOL',
      pool: {
        fifoVictimFirst: false,
        externalOther: { amount: 12_500, at: ago(1460), source: 'รับจาก 4 กระเป๋าต้นทางอื่น (สงสัยเป็นเงินผู้เสียหายรายอื่น)' },
        note: 'USDT อื่นเข้าก่อน (−1,460 นาที) USDT ของผู้เสียหายเข้าภายหลัง (−1,440 นาที)',
      },
      tags: ['USDT ERC-20', 'Aggregator'],
    },
    {
      id: 'c2-exch', type: 'exchange', role: 'EXCHANGE DEPOSIT', label: 'บัญชีฝาก Exchange (จุดสกัด KYC)',
      identifier: '0x882d41e901a77c3b', institution: 'TH-DAX Exchange A', chain: 'ERC-20', currency: 'USDT', status: 'monitoring',
      chokepoint: 'EXCHANGE_KYC', fingerprints: ['EXUID:7731904'],
      notes: 'Deposit tag ผูกกับบัญชีผู้ใช้ UID-7731904',
      tags: ['Licensed DA Exchange', 'Freeze Target'],
    },
  ],
  edges: [
    { id: 'c2-e1', source: 'c2-victim', target: 'c2-bbl', amount: 850_000, currency: 'THB', timestamp: ago(1510, 40), txRef: 'KB-ORFT-692210-551936', channel: 'K PLUS → BBL (ORFT)', rail: 'fiat' },
    { id: 'c2-e2', source: 'c2-feeder', target: 'c2-bbl', amount: 400_000, currency: 'THB', timestamp: ago(1478, 15), txRef: 'KTB-ORFT-692210-730412', channel: 'KTB NEXT → BBL (ORFT)', rail: 'fiat' },
    {
      id: 'c2-e3', source: 'c2-bbl', target: 'c2-agg', amount: 787_500, currency: 'THB', receivedAmount: 22_500, receivedCurrency: 'USDT', fxRate: 35,
      timestamp: ago(1440, 2), txRef: '0xa83f17c2d9e04b6f51c8a2e7d93b0f4c6e1a85d2b7f3c09e4a6d1b8f2c5e7a930', channel: 'P2P OTC · THB→USDT @ ฿35.00', rail: 'cross_rail',
    },
    { id: 'c2-e4', source: 'c2-agg', target: 'c2-exch', amount: 18_000, currency: 'USDT', timestamp: ago(1385, 33), txRef: '0x5d0e2b9a7c41f3e86b2d0a9c5e7f1b3d8a6c4e2f0b9d7a5c3e1f8b6d4a2c0e91', channel: 'ERC-20 · Exchange Deposit', rail: 'crypto' },
  ],
  geoEvents: [
    {
      id: 'c2-g1', entityId: 'c2-bbl', type: 'ip_login', timestamp: ago(1492, 10), lat: 13.8591, lng: 100.5217,
      locationName: 'นนทบุรี – แคราย (ถ.รัตนาธิเบศร์)', ip: '49.228.119.84', asn: 'AS131445 · AIS (AWN)', device: 'OPPO A78 · DEV-91AC-OP7', accuracyM: 400,
    },
    {
      id: 'c2-g2', entityId: 'c2-agg', type: 'device_telemetry', timestamp: ago(1391, 48), lat: 13.9116, lng: 100.547,
      locationName: 'เมืองทองธานี – แจ้งวัฒนะ (WalletConnect session)', ip: '49.228.140.51', asn: 'AS131445 · AIS (AWN)', device: 'MetaMask Mobile · DEV-91AC-OP7', accuracyM: 300,
    },
    {
      id: 'c2-g3', entityId: 'c2-agg', type: 'cell_ping', timestamp: ago(42, 6), lat: 13.9896, lng: 100.6177,
      locationName: 'รังสิต – ปทุมธานี (ย่าน Future Park)', cellId: 'eNB 520-03-77420 · AIS', accuracyM: 750, searchRadiusM: 2000,
    },
  ],
  timeline: [
    { id: 'c2-t1', timestamp: ago(1510, 40), kind: 'transfer', severity: 'critical', title: 'ผู้เสียหายถูกหลอกโอนเข้า "บัญชีตรวจสอบ"', detail: 'KBANK 221-0-64912-8 → BBL 112-8-55419-0', entityId: 'c2-bbl', edgeId: 'c2-e1', amount: 850_000, currency: 'THB' },
    { id: 'c2-t2', timestamp: ago(1492, 10), kind: 'login', severity: 'info', title: 'บัญชีม้า BBL เข้าสู่ระบบ mBanking', detail: 'IP 49.228.119.84 · AS131445 AIS · นนทบุรี', entityId: 'c2-bbl', geoEventId: 'c2-g1' },
    { id: 'c2-t3', timestamp: ago(1478, 15), kind: 'transfer', severity: 'warning', title: 'บัญชีป้อนเงิน KTB โอนเข้า BBL (ปะปน)', detail: 'KTB 401-9-77210-5 → BBL · เงินแหล่งอื่น ฿400,000', entityId: 'c2-bbl', edgeId: 'c2-e2', amount: 400_000, currency: 'THB' },
    { id: 'c2-t4', timestamp: ago(1460), kind: 'deposit', severity: 'info', title: 'USDT จากกระเป๋าอื่นเข้า Aggregator', detail: '12,500 USDT จาก 4 กระเป๋าต้นทาง (เข้าก่อน)', entityId: 'c2-agg', amount: 12_500, currency: 'USDT' },
    { id: 'c2-t5', timestamp: ago(1440, 2), kind: 'swap', severity: 'warning', title: 'แลก THB → USDT ผ่าน P2P OTC', detail: '฿787,500 → 22,500 USDT (ERC-20) เข้า 0x9f8c…71a4', entityId: 'c2-agg', edgeId: 'c2-e3', amount: 22_500, currency: 'USDT' },
    { id: 'c2-t6', timestamp: ago(1391, 48), kind: 'login', severity: 'info', title: 'Aggregator เชื่อม WalletConnect', detail: 'IP 49.228.140.51 · เมืองทองธานี', entityId: 'c2-agg', geoEventId: 'c2-g2' },
    { id: 'c2-t7', timestamp: ago(1385, 33), kind: 'transfer', severity: 'critical', title: 'ฝาก USDT เข้า Exchange (จุดสกัด KYC)', detail: '18,000 USDT → 0x882d41e901a77c3b (UID-7731904)', entityId: 'c2-exch', edgeId: 'c2-e4', amount: 18_000, currency: 'USDT' },
    { id: 'c2-t8', timestamp: ago(42, 6), kind: 'ping', severity: 'critical', title: 'สัญญาณอุปกรณ์ผู้ควบคุม — รังสิต', detail: 'eNB 520-03-77420 (AIS) · ±750 m · รัศมีค้นหา 2,000 m', entityId: 'c2-agg', geoEventId: 'c2-g3' },
  ],
  liveScript: [
    {
      kind: 'crypto_transfer', fromEntityId: 'c2-exch', amount: 5000, channel: 'Exchange Withdrawal → TRC-20',
      newEntity: { type: 'crypto_wallet', role: 'OFF-RAMP WALLET (LIVE)', label: 'กระเป๋าปลายทางถอนออก', identifier: 'TEh5Fq3wJ8rPz2Xk9VmN4cB7dLs6Ya1QoU', institution: 'TRON Network', chain: 'TRC-20', currency: 'USDT' },
      geo: { type: 'ip_login', lat: 13.985, lng: 100.612, locationName: 'รังสิต (IP เข้าสู่ระบบ Exchange)', ip: '49.228.163.20', asn: 'AS131445 · AIS (AWN)', device: 'Exchange App · DEV-91AC-OP7', accuracyM: 500, entityKey: 'source' },
      title: 'LIVE: ถอน 5,000 USDT ออกจาก Exchange', detail: 'UID-7731904 ถอนไป TEh5…1QoU — เร่งออกคำร้องอายัดด่วนที่สุด', severity: 'critical',
    },
    {
      kind: 'atm_withdrawal', fromEntityId: 'c2-bbl', amount: 20_000, channel: 'Cardless ATM ×1 รายการ', txCount: 1,
      newEntity: { type: 'cash_out', role: 'ATM CASH-OUT (LIVE)', label: 'จุดถอนเงินสด (LIVE)', identifier: 'ATM-BBL-2207', institution: 'BBL', currency: 'THB', terminalId: 'ATM-BBL-2207', locationName: 'รังสิต – ถ.พหลโยธิน', chokepoint: 'ATM_CASHOUT', status: 'cashed_out' },
      geo: { type: 'atm_withdrawal', lat: 13.9921, lng: 100.6204, locationName: 'รังสิต – ถ.พหลโยธิน (ตู้ ATM-BBL-2207)', terminalId: 'ATM-BBL-2207', amount: 20_000, currency: 'THB', accuracyM: 15, searchRadiusM: 1500, entityKey: 'target' },
      title: 'LIVE: ถอนเงินสด ATM-BBL-2207', detail: 'บัญชี BBL 112-8-55419-0 ถอน ฿20,000 ในรัศมีค้นหารังสิต', severity: 'critical',
    },
  ],
};

// ═════════════════════════ CASE #3 — CCIB-2026-1109 ═════════════════════════
const CASE_1109: InvestigationCase = {
  id: 'CCIB-2026-1109',
  primaryKey: '554-2-90184-7',
  primaryEntityId: 'c3-mule',
  title: 'บัญชีม้าตระเวนกดเงินสดต่อเนื่อง โซนเชียงใหม่',
  titleEn: 'Roaming Mule ATM Cash-Out Spree — Chiang Mai',
  typology: 'mule_cashout',
  lossAmount: 125_000,
  reportNo: 'TPO-6911-00442516',
  openedAt: ago(100),
  victimProfile: {
    name: 'นางสาว ก****** ม*******',
    age: 29,
    province: 'เชียงใหม่ (อ.เมือง)',
    channel: 'TikTok / Telegram "งานออนไลน์กดไลก์รับค่าคอม"',
  },
  modusOperandi:
    'หลอกให้ทำงานออนไลน์ (กดไลก์/รีวิว) ได้ค่าคอมเล็กน้อยก่อน แล้วให้โอนเงิน "ทำภารกิจ VIP" เข้าบัญชีม้า จากนั้นม้าตระเวนกดเงินสดไม่ใช้บัตรหลายตู้',
  summary:
    'เงินผู้เสียหาย ฿125,000 เข้าบัญชีม้า TTB ที่มียอดเดิม ฿3,500 ถูกถอนเงินสดต่อเนื่องที่ ATM-TTB-3091 (คูเมือง) และ ATM-TTB-3108 (นิมมาน) — อุปกรณ์เดียวกับบัญชีม้าคดี 0892',
  usdtThbRate: 35,
  btcThbRate: 3_150_000,
  searchRadiusM: 1400,
  analystAdjustment: { points: 7, reason: 'สายตรวจ สภ.เมืองเชียงใหม่ อยู่ในรัศมี 2 กม. — โอกาสสกัดจับขณะถอนเงินสูง' },
  officer: OFFICER_CNX,
  liveAlertCount: 0,
  entities: [
    {
      id: 'c3-victim', type: 'victim', role: 'VICTIM · ORIGIN', label: 'บัญชีผู้เสียหาย (ต้นทาง)',
      identifier: '309-1-44210-6', institution: 'SCB', holderName: 'นางสาว ก****** ม*******', currency: 'THB', status: 'origin',
    },
    {
      id: 'c3-mule', type: 'mule_bank', role: 'ROAMING MULE', label: 'บัญชีม้าตระเวนกดเงินสด',
      identifier: '554-2-90184-7', institution: 'TTB', holderName: 'นาย ศ****** ป*******', currency: 'THB', status: 'flagged',
      ip: '1.47.150.23', asn: 'AS132061', isp: 'Real Move (TrueMove H)', device: 'Android 14 · Samsung SM-A546E',
      fingerprints: ['DEV-7F3C-A51'], accountOpened: '2026-10-28',
      pool: {
        fifoVictimFirst: false,
        externalOther: { amount: 3500, source: 'ยอดคงเหลือเดิมก่อนเกิดเหตุ' },
        note: 'ยอดเดิม ฿3,500 อยู่ในบัญชีก่อนเงินผู้เสียหายเข้า',
      },
      tags: ['Cardless Spree', 'Shared Device'],
    },
    {
      id: 'c3-atm1', type: 'cash_out', role: 'ATM CASH-OUT #1', label: 'จุดถอนเงินสด #1 (Cardless ×4)',
      identifier: 'ATM-TTB-3091', institution: 'TTB', currency: 'THB', status: 'cashed_out', terminalId: 'ATM-TTB-3091',
      locationName: 'คูเมืองเชียงใหม่ (ถ.ราชดำเนิน)', chokepoint: 'ATM_CASHOUT',
    },
    {
      id: 'c3-atm2', type: 'cash_out', role: 'ATM CASH-OUT #2', label: 'จุดถอนเงินสด #2 (Cardless ×3)',
      identifier: 'ATM-TTB-3108', institution: 'TTB', currency: 'THB', status: 'cashed_out', terminalId: 'ATM-TTB-3108',
      locationName: 'นิมมานเหมินท์ – สุเทพ', chokepoint: 'ATM_CASHOUT',
    },
  ],
  edges: [
    { id: 'c3-e1', source: 'c3-victim', target: 'c3-mule', amount: 125_000, currency: 'THB', timestamp: ago(118, 25), txRef: 'SCB-ORFT-692311-660218', channel: 'SCB EASY → TTB (ORFT)', rail: 'fiat' },
    { id: 'c3-e2', source: 'c3-mule', target: 'c3-atm1', amount: 70_000, currency: 'THB', timestamp: ago(83, 40), txRef: 'TTB-ATM3091-CL-118842', channel: 'Cardless ATM ×4 รายการ', rail: 'cash', txCount: 4 },
    { id: 'c3-e3', source: 'c3-mule', target: 'c3-atm2', amount: 50_000, currency: 'THB', timestamp: ago(13, 12), txRef: 'TTB-ATM3108-CL-119307', channel: 'Cardless ATM ×3 รายการ', rail: 'cash', txCount: 3 },
  ],
  geoEvents: [
    {
      id: 'c3-g1', entityId: 'c3-mule', type: 'ip_login', timestamp: ago(96, 30), lat: 18.796, lng: 98.979,
      locationName: 'ช้างเผือก – สันติธรรม', ip: '1.47.150.23', asn: 'AS132061 · TrueMove H', device: 'Samsung SM-A546E · DEV-7F3C-A51', accuracyM: 400,
    },
    {
      id: 'c3-g2', entityId: 'c3-atm1', type: 'atm_withdrawal', timestamp: ago(83, 40), lat: 18.7883, lng: 98.9853,
      locationName: 'คูเมืองเชียงใหม่ (ถ.ราชดำเนิน)', terminalId: 'ATM-TTB-3091', amount: 70_000, currency: 'THB', accuracyM: 15,
    },
    {
      id: 'c3-g3', entityId: 'c3-mule', type: 'cell_ping', timestamp: ago(48, 20), lat: 18.7951, lng: 98.9741,
      locationName: 'ถ.ห้วยแก้ว – ศิริมังคลาจารย์', cellId: 'eNB 520-04-20931 · TrueMove H', accuracyM: 550,
    },
    {
      id: 'c3-g4', entityId: 'c3-atm2', type: 'atm_withdrawal', timestamp: ago(13, 12), lat: 18.8002, lng: 98.9675,
      locationName: 'นิมมานเหมินท์ – สุเทพ', terminalId: 'ATM-TTB-3108', amount: 50_000, currency: 'THB', accuracyM: 15, searchRadiusM: 1400,
    },
  ],
  timeline: [
    { id: 'c3-t1', timestamp: ago(118, 25), kind: 'transfer', severity: 'warning', title: 'ผู้เสียหายโอน "ภารกิจ VIP" เข้าบัญชีม้า', detail: 'SCB 309-1-44210-6 → TTB 554-2-90184-7', entityId: 'c3-mule', edgeId: 'c3-e1', amount: 125_000, currency: 'THB' },
    { id: 'c3-t2', timestamp: ago(96, 30), kind: 'login', severity: 'warning', title: 'ม้าเข้าสู่ระบบ ttb touch — อุปกรณ์ซ้ำคดีอื่น', detail: 'IP 1.47.150.23 · AS132061 TrueMove H · DEV-7F3C-A51', entityId: 'c3-mule', geoEventId: 'c3-g1' },
    { id: 'c3-t3', timestamp: ago(83, 40), kind: 'withdrawal', severity: 'critical', title: 'ถอนเงินสด ATM-TTB-3091 ×4', detail: 'Cardless · คูเมืองเชียงใหม่ (ถ.ราชดำเนิน)', entityId: 'c3-atm1', edgeId: 'c3-e2', geoEventId: 'c3-g2', amount: 70_000, currency: 'THB' },
    { id: 'c3-t4', timestamp: ago(48, 20), kind: 'ping', severity: 'warning', title: 'สัญญาณมือถือ ถ.ห้วยแก้ว', detail: 'eNB 520-04-20931 (TrueMove H) · ±550 m · มุ่งหน้าตะวันตก', entityId: 'c3-mule', geoEventId: 'c3-g3' },
    { id: 'c3-t5', timestamp: ago(13, 12), kind: 'withdrawal', severity: 'critical', title: 'ถอนเงินสด ATM-TTB-3108 ×3', detail: 'Cardless · นิมมานเหมินท์ – สุเทพ · รัศมีค้นหา 1,400 m', entityId: 'c3-atm2', edgeId: 'c3-e3', geoEventId: 'c3-g4', amount: 50_000, currency: 'THB' },
  ],
  liveScript: [
    {
      kind: 'atm_withdrawal', fromEntityId: 'c3-mule', amount: 8500, channel: 'Cardless ATM ×1 รายการ', txCount: 1,
      newEntity: { type: 'cash_out', role: 'ATM CASH-OUT #3', label: 'จุดถอนเงินสด #3 (LIVE)', identifier: 'ATM-TTB-3122', institution: 'TTB', currency: 'THB', terminalId: 'ATM-TTB-3122', locationName: 'ถ.ห้วยแก้ว (หน้า มช.)', chokepoint: 'ATM_CASHOUT', status: 'cashed_out' },
      geo: { type: 'atm_withdrawal', lat: 18.803, lng: 98.9555, locationName: 'ถ.ห้วยแก้ว – หน้ามหาวิทยาลัยเชียงใหม่ (ตู้ ATM-TTB-3122)', terminalId: 'ATM-TTB-3122', amount: 8500, currency: 'THB', accuracyM: 15, searchRadiusM: 1200, entityKey: 'target' },
      title: 'LIVE: ถอนก้อนสุดท้าย ATM-TTB-3122', detail: 'ถอน ฿8,500 — บัญชี TTB 554-2-90184-7 เหลือ ฿0 · เคลื่อนที่ไปทางตะวันตก', severity: 'critical',
    },
    {
      kind: 'cell_ping', fromEntityId: 'c3-mule',
      geo: { type: 'cell_ping', lat: 18.774, lng: 98.969, locationName: 'ถ.มหิดล – มุ่งหน้าสนามบินเชียงใหม่', cellId: 'eNB 520-04-20877 · TrueMove H', accuracyM: 500, searchRadiusM: 1600, entityKey: 'source' },
      title: 'LIVE: ผู้ต้องสงสัยมุ่งหน้าสนามบิน', detail: 'สัญญาณมือถือเคลื่อนลงใต้ ถ.มหิดล — แจ้ง ตม./สนามบินเชียงใหม่', severity: 'critical',
    },
  ],
};

export const MOCK_CASES: InvestigationCase[] = [CASE_0892, CASE_1044, CASE_1109];

export const PRESET_META: Record<string, { short: string; tag: string }> = {
  'CCIB-2026-0892': { short: '0892', tag: 'ลงทุนคริปโต' },
  'CCIB-2026-1044': { short: '1044', tag: 'คอลเซ็นเตอร์' },
  'CCIB-2026-1109': { short: '1109', tag: 'กดเงินเชียงใหม่' },
};

// ═════════════════════════ Cross-case helpers ═════════════════════════

const EVIDENCE_LABEL: Record<MatchEvidence['type'], string> = {
  shared_account: 'เลขบัญชีเดียวกัน',
  shared_wallet: 'กระเป๋า/Address เดียวกัน',
  shared_terminal: 'ตู้ ATM เดียวกัน',
  shared_device: 'อุปกรณ์ (Device ID) เดียวกัน',
  shared_exchange_uid: 'Exchange UID เดียวกัน',
  shared_ip: 'IP Address เดียวกัน',
  atm_corridor: 'ย่านถอนเงินสดเดียวกัน (≤ 2.5 กม.)',
  pattern: 'รูปแบบการฟอกเงินคล้ายกัน',
};

function correlationKeys(e: InvestigationCase['entities'][number]): { key: string; type: MatchEvidence['type']; value: string }[] {
  const keys: { key: string; type: MatchEvidence['type']; value: string }[] = [];
  const idType: MatchEvidence['type'] =
    e.type === 'mule_bank' || e.type === 'victim' ? 'shared_account' : e.type === 'cash_out' ? 'shared_terminal' : 'shared_wallet';
  keys.push({ key: `id:${normalizeIdentifier(e.identifier)}`, type: idType, value: e.identifier });
  for (const fp of e.fingerprints ?? []) {
    if (fp.startsWith('EXUID:')) keys.push({ key: `fp:${fp}`, type: 'shared_exchange_uid', value: `UID-${fp.slice(6)}` });
    else keys.push({ key: `fp:${fp}`, type: 'shared_device', value: fp });
  }
  if (e.ip) keys.push({ key: `ip:${e.ip}`, type: 'shared_ip', value: e.ip });
  return keys;
}

/**
 * Detect shared mule accounts, wallets, devices, exchange UIDs, ATM corridors and laundering patterns
 * between the active case and every other case in the workspace.
 */
export function findCrossCaseLinks(active: InvestigationCase, all: InvestigationCase[]): CrossCaseLink[] {
  const links = new Map<string, CrossCaseLink>();
  const others = all.filter((c) => c.id !== active.id);
  const push = (localEntityId: string, rc: InvestigationCase, remoteEntityId: string, ev: MatchEvidence) => {
    const re = rc.entities.find((x) => x.id === remoteEntityId);
    if (!re) return;
    const key = `${localEntityId}→${rc.id}:${remoteEntityId}`;
    const existing = links.get(key);
    if (existing) {
      if (!existing.evidence.some((x) => x.type === ev.type && x.value === ev.value)) existing.evidence.push(ev);
    } else {
      links.set(key, {
        key, localEntityId, remoteCaseId: rc.id, remoteCaseTitle: rc.title, remoteEntityId,
        remoteEntityLabel: re.label, remoteIdentifier: re.identifier, remoteRiskHint: 0, evidence: [ev], strength: 'weak',
      });
    }
  };

  // 1) Identifier / fingerprint / IP correlation
  const index = new Map<string, { c: InvestigationCase; entityId: string }[]>();
  for (const oc of others)
    for (const e of oc.entities)
      for (const k of correlationKeys(e)) index.set(k.key, [...(index.get(k.key) ?? []), { c: oc, entityId: e.id }]);
  for (const e of active.entities) {
    if (e.type === 'victim') continue;
    for (const k of correlationKeys(e))
      for (const hit of index.get(k.key) ?? [])
        push(e.id, hit.c, hit.entityId, { type: k.type, value: k.value, label: EVIDENCE_LABEL[k.type] });
  }

  // 2) ATM corridor (physical cash-out within 2.5 km of another case's cash-out)
  const atmGeo = (c: InvestigationCase) => c.geoEvents.filter((g) => g.type === 'atm_withdrawal');
  for (const g of atmGeo(active))
    for (const oc of others)
      for (const og of atmGeo(oc)) {
        const d = haversineM(g.lat, g.lng, og.lat, og.lng);
        if (d <= 2500 && g.terminalId !== og.terminalId)
          push(g.entityId, oc, og.entityId, { type: 'atm_corridor', value: `${g.terminalId ?? '?'} ↔ ${og.terminalId ?? '?'} (${(d / 1000).toFixed(2)} km)`, label: EVIDENCE_LABEL.atm_corridor });
      }

  // 3) Laundering pattern (same typology, weak signal)
  for (const oc of others)
    if (oc.typology === active.typology && active.typology !== 'synthesized') {
      const local = active.entities.find((x) => x.id === active.primaryEntityId);
      if (local) push(local.id, oc, oc.primaryEntityId, { type: 'pattern', value: active.typology, label: EVIDENCE_LABEL.pattern });
    }

  const STRONG: MatchEvidence['type'][] = ['shared_account', 'shared_wallet', 'shared_device', 'shared_exchange_uid', 'shared_terminal'];
  return [...links.values()]
    .map((l) => ({
      ...l,
      strength: (l.evidence.some((x) => STRONG.includes(x.type)) ? 'strong' : l.evidence.some((x) => x.type === 'shared_ip' || x.type === 'atm_corridor') ? 'medium' : 'weak') as CrossCaseLink['strength'],
    }))
    .sort((a, b) => (a.strength === b.strength ? b.evidence.length - a.evidence.length : a.strength === 'strong' ? -1 : b.strength === 'strong' ? 1 : a.strength === 'medium' ? -1 : 1));
}

/** Case IDs that count toward network risk (strong / medium links only). */
export const linkedCaseIdsForRisk = (links: CrossCaseLink[]) => [...new Set(links.filter((l) => l.strength !== 'weak').map((l) => l.remoteCaseId))];

/** Search every case for a bank account, wallet, TxID, IP or case ID. */
export function findCasesByIdentifier(query: string, all: InvestigationCase[]): IdentifierHit[] {
  const q = normalizeIdentifier(query);
  if (!q) return [];
  const hits: IdentifierHit[] = [];
  for (const c of all) {
    if (c.id.toUpperCase() === q.toUpperCase()) {
      hits.push({ caseId: c.id, entityId: c.primaryEntityId, field: 'case_id' });
      continue;
    }
    if (normalizeIdentifier(c.primaryKey) === q) {
      hits.push({ caseId: c.id, entityId: c.primaryEntityId, field: 'primary_key' });
      continue;
    }
    const ent = c.entities.find((e) => normalizeIdentifier(e.identifier) === q);
    if (ent) {
      hits.push({ caseId: c.id, entityId: ent.id, field: 'identifier' });
      continue;
    }
    const edge = c.edges.find((e) => normalizeIdentifier(e.txRef) === q);
    if (edge) {
      hits.push({ caseId: c.id, entityId: edge.target, edgeId: edge.id, field: 'tx_ref' });
      continue;
    }
    const ipEnt = c.entities.find((e) => e.ip === query.trim()) ?? null;
    const ipGeo = c.geoEvents.find((g) => g.ip === query.trim());
    if (ipEnt || ipGeo) hits.push({ caseId: c.id, entityId: ipEnt?.id ?? ipGeo?.entityId, field: 'ip' });
  }
  return hits;
}

export interface SearchSuggestion {
  value: string;
  kind: 'case_id' | 'bank_account' | 'crypto_wallet' | 'txid' | 'atm' | 'ip';
  caseId: string;
  label: string;
}

/** Flat index used by the smart-search dropdown. */
export function buildSearchIndex(all: InvestigationCase[]): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  const seen = new Set<string>();
  const add = (s: SearchSuggestion) => {
    const k = `${s.caseId}|${s.value}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  };
  for (const c of all) {
    add({ value: c.id, kind: 'case_id', caseId: c.id, label: c.title });
    for (const e of c.entities) {
      const kind: SearchSuggestion['kind'] =
        e.type === 'cash_out' ? 'atm' : e.type === 'mule_bank' || e.type === 'victim' ? 'bank_account' : 'crypto_wallet';
      add({ value: e.identifier, kind, caseId: c.id, label: `${e.institution} · ${e.label}` });
      if (e.ip) add({ value: e.ip, kind: 'ip', caseId: c.id, label: `IP · ${e.label}` });
    }
    for (const ed of c.edges) if (/^(0x)?[0-9a-f]{64}$/i.test(ed.txRef)) add({ value: ed.txRef, kind: 'txid', caseId: c.id, label: `TxID · ${ed.channel}` });
  }
  return out;
}
