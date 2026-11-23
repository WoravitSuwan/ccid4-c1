/**
 * Real-time Simulation Engine
 *  • injectLiveAlert — appends a live transaction / ATM withdrawal / telemetry ping to a case
 *    (scripted steps first, then balance-aware generated activity).
 *  • synthesizeCase  — Dynamic Case Synthesis for any unknown account / wallet / TxID / case ID.
 */
import type {
  Chain,
  Currency,
  FlowEdge,
  FlowEntity,
  GeoEvent,
  InputDetection,
  InvestigationCase,
  LiveAlert,
  LiveScriptStep,
  ThaiBank,
  TimelineEvent,
} from '../types/investigation';
import { computeCaseTaint } from './taintEngine';
import { fmtDistance, fmtMoney, shortId } from './format';
import { haversineM, offsetLatLng, sortGeo } from './geo';
import { formatThaiAccount } from './inputDetect';

// ───────────────────────── deterministic PRNG ─────────────────────────

function hashSeed(s: string): number {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

export function seededRng(seed: string) {
  let a = hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof seededRng>;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX = '0123456789abcdef';
const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const str = (r: Rng, alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(r.next() * alphabet.length)]).join('');
const tronAddr = (r: Rng) => `T${str(r, B58, 33)}`;
const evmAddr = (r: Rng) => `0x${str(r, HEX, 40)}`;
const btcAddr = (r: Rng) => `bc1q${str(r, BECH, 38)}`;
const hex64 = (r: Rng) => str(r, HEX, 64);
const digits = (r: Rng, n: number) => str(r, '0123456789', n);
const thaiAcct = (r: Rng) => formatThaiAccount(`${r.int(1, 9)}${digits(r, 9)}`);

const BANKS: ThaiBank[] = ['KBANK', 'SCB', 'KTB', 'BBL', 'TTB', 'BAY', 'GSB'];
const INITIALS = ['ก', 'ค', 'จ', 'ช', 'ณ', 'ด', 'ต', 'ท', 'ธ', 'น', 'บ', 'ป', 'พ', 'ภ', 'ม', 'ร', 'ว', 'ศ', 'ส', 'อ'];
const maskedName = (r: Rng) => `${r.pick(['นาย', 'นาง', 'นางสาว'])} ${r.pick(INITIALS)}****** ${r.pick(INITIALS)}*******`;

const CITIES = [
  { name: 'กรุงเทพฯ – บางนา', lat: 13.668, lng: 100.634 },
  { name: 'กรุงเทพฯ – บางแค', lat: 13.7127, lng: 100.4069 },
  { name: 'ชลบุรี – พัทยา', lat: 12.9276, lng: 100.8771 },
  { name: 'ขอนแก่น – ในเมือง', lat: 16.4322, lng: 102.8236 },
  { name: 'สงขลา – หาดใหญ่', lat: 7.0086, lng: 100.4747 },
  { name: 'นครราชสีมา – ในเมือง', lat: 14.9799, lng: 102.0977 },
  { name: 'อุดรธานี – ในเมือง', lat: 17.4138, lng: 102.7872 },
  { name: 'ภูเก็ต – เมืองภูเก็ต', lat: 7.8804, lng: 98.3923 },
  { name: 'เชียงราย – แม่สาย', lat: 20.429, lng: 99.883 },
] as const;

// ───────────────────────── Live alert injection ─────────────────────────

const lastGeoOf = (c: InvestigationCase): GeoEvent | undefined => sortGeo(c.geoEvents).at(-1);

/** Balance-aware generated step once the scripted steps run out. */
function generateStep(c: InvestigationCase, n: number): LiveScriptStep {
  const r = seededRng(`${c.id}:live:${n}`);
  const taint = computeCaseTaint(c, 'fifo');
  const bal = (e: FlowEntity) => taint.nodes[e.id]?.remainingTotal ?? 0;
  const anchor = lastGeoOf(c) ?? { lat: 13.7563, lng: 100.5018, locationName: 'กรุงเทพมหานคร' };
  const [lat, lng] = offsetLatLng(anchor.lat, anchor.lng, r.int(-1800, 1800), r.int(-1800, 1800));
  const dist = haversineM(anchor.lat, anchor.lng, lat, lng);
  const where = `ห่างจุดล่าสุด ${fmtDistance(dist)} (${anchor.locationName.split('(')[0].trim()})`;

  const mule = c.entities.filter((e) => e.type === 'mule_bank' && bal(e) >= 1000).sort((a, b) => bal(b) - bal(a))[0];
  if (mule) {
    const amount = Math.min(Math.floor(bal(mule) / 100) * 100, r.pick([5000, 10_000, 15_000, 20_000]));
    const bank = r.pick(BANKS);
    const terminal = `ATM-${bank}-${r.int(1000, 9899)}`;
    return {
      kind: 'atm_withdrawal', fromEntityId: mule.id, amount, channel: 'Cardless ATM ×1 รายการ', txCount: 1,
      newEntity: { type: 'cash_out', role: 'ATM CASH-OUT (LIVE)', label: 'จุดถอนเงินสด (LIVE)', identifier: terminal, institution: bank, currency: 'THB', terminalId: terminal, locationName: where, chokepoint: 'ATM_CASHOUT', status: 'cashed_out' },
      geo: { type: 'atm_withdrawal', lat, lng, locationName: `${where} · ตู้ ${terminal}`, terminalId: terminal, amount, currency: 'THB', accuracyM: 15, searchRadiusM: 1500, entityKey: 'target' },
      title: `LIVE: ถอนเงินสด ${terminal}`,
      detail: `${mule.institution} ${mule.identifier} ถอนไม่ใช้บัตร ${fmtMoney(amount, 'THB')} · ${where}`,
      severity: 'critical',
    };
  }
  const wallet = c.entities.filter((e) => (e.type === 'crypto_wallet' || e.type === 'exchange') && bal(e) >= 50).sort((a, b) => bal(b) - bal(a))[0];
  if (wallet) {
    const amount = Math.round(bal(wallet) * (0.35 + r.next() * 0.25) * 100) / 100;
    const chain: Chain = wallet.chain === 'ERC-20' ? 'ERC-20' : 'TRC-20';
    const addr = chain === 'ERC-20' ? evmAddr(r) : tronAddr(r);
    return {
      kind: 'crypto_transfer', fromEntityId: wallet.id, amount, channel: `Peel-chain ${chain}`,
      newEntity: { type: 'crypto_wallet', role: 'PEEL WALLET (LIVE)', label: 'กระเป๋าแตกยอด (Peel-chain)', identifier: addr, institution: chain === 'ERC-20' ? 'Ethereum Network' : 'TRON Network', chain, currency: wallet.currency },
      geo: { type: 'device_telemetry', lat, lng, locationName: `${where} · Wallet session`, ip: `171.${r.int(96, 103)}.${r.int(0, 255)}.${r.int(1, 254)}`, asn: 'AS7470 · TRUE INTERNET', accuracyM: 300, entityKey: 'source' },
      title: `LIVE: แตกยอด ${fmtMoney(amount, wallet.currency)}`,
      detail: `${shortId(wallet.identifier)} → ${shortId(addr)} · ${where}`,
      severity: 'warning',
    };
  }
  const subject = c.entities.find((e) => e.id === (lastGeoOf(c)?.entityId ?? c.primaryEntityId)) ?? c.entities[0];
  return {
    kind: 'cell_ping', fromEntityId: subject.id,
    geo: { type: 'cell_ping', lat, lng, locationName: `${where} · Cell ping`, cellId: `eNB 520-0${r.pick([3, 4, 5])}-${r.int(10000, 99999)}`, accuracyM: r.int(300, 800), searchRadiusM: 1600, entityKey: 'source' },
    title: 'LIVE: สัญญาณโทรศัพท์ผู้ต้องสงสัยเคลื่อนที่',
    detail: `บัญชีถูกถอนหมดแล้ว — ติดตามตัวบุคคล · ${where}`,
    severity: 'warning',
  };
}

export function injectLiveAlert(c: InvestigationCase, now: number = Date.now()): { next: InvestigationCase; alert: LiveAlert } {
  const n = c.liveAlertCount;
  let step = c.liveScript[n] ?? generateStep(c, n);
  const r = seededRng(`${c.id}:tx:${n}:${now}`);
  const ts = new Date(now).toISOString();
  const uid = `${c.id}-L${n + 1}`;

  // Never move more money than the source actually holds (method-independent balance).
  if (step.amount && step.kind !== 'cell_ping' && step.kind !== 'ip_login') {
    const balance = computeCaseTaint(c, 'fifo').nodes[step.fromEntityId]?.remainingTotal ?? 0;
    if (balance < 1) step = generateStep({ ...c, liveScript: [] }, n);
    else if (step.amount > balance) step = { ...step, amount: Math.floor(balance * 100) / 100 };
  }

  const source = c.entities.find((e) => e.id === step.fromEntityId);
  const entities = [...c.entities];
  let targetId = step.targetEntityId;
  if (step.newEntity) {
    targetId = `${uid}-ent`;
    entities.push({ ...step.newEntity, id: targetId, status: step.newEntity.status ?? 'active', isLive: true });
  }

  const edges = [...c.edges];
  let edgeId: string | undefined;
  if (step.amount && targetId && source && (step.kind === 'atm_withdrawal' || step.kind === 'crypto_transfer')) {
    edgeId = `${uid}-edge`;
    const target = entities.find((e) => e.id === targetId);
    const evm = target?.chain === 'ERC-20' || source.chain === 'ERC-20';
    const edge: FlowEdge = {
      id: edgeId, source: source.id, target: targetId, amount: step.amount, currency: source.currency, timestamp: ts,
      txRef: step.kind === 'atm_withdrawal' ? `${target?.terminalId ?? 'ATM'}-CL-${digits(r, 6)}` : evm ? `0x${hex64(r)}` : hex64(r),
      channel: step.channel ?? (step.kind === 'atm_withdrawal' ? 'Cardless ATM' : 'On-chain transfer'),
      rail: step.kind === 'atm_withdrawal' ? 'cash' : 'crypto', txCount: step.txCount, isLive: true,
    };
    edges.push(edge);
  }

  const geoEvents = [...c.geoEvents];
  let geoId: string | undefined;
  if (step.geo) {
    geoId = `${uid}-geo`;
    const { entityKey, ...g } = step.geo;
    geoEvents.push({ ...g, id: geoId, entityId: entityKey === 'target' && targetId ? targetId : step.fromEntityId, timestamp: ts, isLive: true });
  }

  const kindMap = { atm_withdrawal: 'withdrawal', crypto_transfer: 'transfer', cell_ping: 'ping', ip_login: 'login' } as const;
  const eventId = `${uid}-evt`;
  const entityId = targetId ?? step.fromEntityId;
  const evt: TimelineEvent = {
    id: eventId, timestamp: ts, kind: kindMap[step.kind], severity: step.severity, title: step.title, detail: step.detail,
    entityId, edgeId, geoEventId: geoId, amount: step.amount, currency: step.amount ? source?.currency : undefined, isLive: true,
  };

  const next: InvestigationCase = {
    ...c, entities, edges, geoEvents, timeline: [...c.timeline, evt], liveAlertCount: n + 1,
  };
  return {
    next,
    alert: { id: uid, caseId: c.id, title: step.title, detail: step.detail, severity: step.severity, timestamp: ts, entityId, geoId, eventId },
  };
}

// ───────────────────────── Dynamic Case Synthesis ─────────────────────────

export function synthesizeCase(query: string, det: InputDetection, existingIds: string[], now: number = Date.now()): InvestigationCase {
  const q = query.trim();
  const r = seededRng(q.toLowerCase());
  const at = (min: number, sec = 0) => new Date(now - (min * 60 + sec) * 1000).toISOString();
  const city = r.pick(CITIES);
  const near = (n: number, e: number) => offsetLatLng(city.lat, city.lng, n, e);

  let id = det.type === 'case_id' ? q.toUpperCase() : `CCIB-2026-${r.int(1200, 1980)}`;
  while (existingIds.includes(id)) id = `CCIB-2026-${r.int(1200, 1980)}`;
  const P = `${id}-x`;

  const loss = r.pick([85_000, 120_000, 186_000, 245_000, 360_000, 480_000, 650_000, 920_000]);
  const vBank = r.pick(BANKS);
  const mBank = r.pick(BANKS.filter((b) => b !== vBank));
  const m2Bank = r.pick(BANKS.filter((b) => b !== mBank));
  const T0 = r.int(140, 190);
  const usdt = 35;
  const btc = 3_150_000;

  const entities: FlowEntity[] = [];
  const edges: FlowEdge[] = [];
  const geoEvents: GeoEvent[] = [];
  const timeline: TimelineEvent[] = [];
  const ev = (e: Omit<TimelineEvent, 'id'>) => timeline.push({ ...e, id: `${P}-t${timeline.length + 1}` });

  const victim: FlowEntity = {
    id: `${P}-victim`, type: 'victim', role: 'VICTIM · ORIGIN', label: 'บัญชีผู้เสียหาย (ต้นทาง)', identifier: thaiAcct(r),
    institution: vBank, holderName: maskedName(r), currency: 'THB', status: 'origin',
  };
  const muleIdent = det.type === 'bank_account' ? formatThaiAccount(det.normalized) : thaiAcct(r);
  const mule: FlowEntity = {
    id: `${P}-mule1`, type: 'mule_bank', role: 'MULE TIER-1', label: 'บัญชีม้าชั้นที่ 1', identifier: muleIdent, institution: mBank,
    holderName: maskedName(r), currency: 'THB', status: 'flagged', ip: `171.${r.int(96, 103)}.${r.int(0, 255)}.${r.int(1, 254)}`,
    asn: 'AS7470', isp: 'TRUE INTERNET Co.,Ltd.', device: `Android · DEV-${str(r, HEX.toUpperCase(), 4)}-${str(r, B58, 3)}`,
    fingerprints: [`DEV-${str(r, HEX.toUpperCase(), 4)}-S${r.int(10, 99)}`], tags: ['Synthesized'],
    pool: { fifoVictimFirst: false, externalOther: { amount: r.pick([2500, 8000, 15_000, 40_000]), source: 'ยอดคงเหลือเดิมก่อนเกิดเหตุ' } },
  };
  entities.push(victim, mule);
  edges.push({ id: `${P}-e1`, source: victim.id, target: mule.id, amount: loss, currency: 'THB', timestamp: at(T0, 12), txRef: `${vBank}-ORFT-${digits(r, 6)}-${digits(r, 6)}`, channel: `${vBank} → ${mBank} (ORFT)`, rail: 'fiat' });
  ev({ timestamp: at(T0, 12), kind: 'transfer', severity: 'warning', title: 'ผู้เสียหายโอนเข้าบัญชีม้า', detail: `${vBank} ${victim.identifier} → ${mBank} ${mule.identifier}`, entityId: mule.id, edgeId: `${P}-e1`, amount: loss, currency: 'THB' });
  const [g1lat, g1lng] = near(r.int(-900, 900), r.int(-900, 900));
  geoEvents.push({ id: `${P}-g1`, entityId: mule.id, type: 'ip_login', timestamp: at(T0 - 14), lat: g1lat, lng: g1lng, locationName: `${city.name} (IP login)`, ip: mule.ip, asn: 'AS7470 · TRUE INTERNET', device: mule.device, accuracyM: 400 });
  ev({ timestamp: at(T0 - 14), kind: 'login', severity: 'info', title: 'บัญชีม้าเข้าสู่ระบบ Mobile Banking', detail: `IP ${mule.ip} · AS7470 TRUE`, entityId: mule.id, geoEventId: `${P}-g1` });

  const muleTotal = loss + (mule.pool?.externalOther?.amount ?? 0);
  const typology: InvestigationCase['typology'] = det.type === 'bank_account' ? 'mule_cashout' : det.type === 'txid' ? 'call_center' : 'investment_scam';

  if (det.type === 'bank_account') {
    const cash1 = Math.round((loss * (0.35 + r.next() * 0.15)) / 1000) * 1000;
    const toMule2 = Math.round(((muleTotal - cash1) * 0.9) / 1000) * 1000;
    const t1 = `ATM-${mBank}-${r.int(1000, 9899)}`;
    const [alat, alng] = near(r.int(-1500, 1500), r.int(-1500, 1500));
    entities.push({ id: `${P}-atm1`, type: 'cash_out', role: 'ATM CASH-OUT #1', label: 'จุดถอนเงินสด #1', identifier: t1, institution: mBank, currency: 'THB', status: 'cashed_out', terminalId: t1, locationName: city.name, chokepoint: 'ATM_CASHOUT' });
    edges.push({ id: `${P}-e2`, source: mule.id, target: `${P}-atm1`, amount: cash1, currency: 'THB', timestamp: at(T0 - 34), txRef: `${t1}-CL-${digits(r, 6)}`, channel: `Cardless ATM ×${Math.ceil(cash1 / 20_000)} รายการ`, rail: 'cash', txCount: Math.ceil(cash1 / 20_000) });
    geoEvents.push({ id: `${P}-g2`, entityId: `${P}-atm1`, type: 'atm_withdrawal', timestamp: at(T0 - 34), lat: alat, lng: alng, locationName: `${city.name} (ตู้ ${t1})`, terminalId: t1, amount: cash1, currency: 'THB', accuracyM: 15 });
    ev({ timestamp: at(T0 - 34), kind: 'withdrawal', severity: 'critical', title: `ถอนเงินสด ${t1}`, detail: `Cardless · ${city.name}`, entityId: `${P}-atm1`, edgeId: `${P}-e2`, geoEventId: `${P}-g2`, amount: cash1, currency: 'THB' });

    const m2: FlowEntity = { id: `${P}-mule2`, type: 'mule_bank', role: 'MULE TIER-2', label: 'บัญชีม้าชั้นที่ 2', identifier: thaiAcct(r), institution: m2Bank, holderName: maskedName(r), currency: 'THB', status: 'flagged', pool: { fifoVictimFirst: true, externalOther: { amount: r.pick([20_000, 35_000, 60_000]), at: at(T0 - 70), source: 'เงินจากบัญชีไม่ทราบที่มา' } } };
    entities.push(m2);
    edges.push({ id: `${P}-e3`, source: mule.id, target: m2.id, amount: toMule2, currency: 'THB', timestamp: at(T0 - 52), txRef: `${mBank}-ORFT-${digits(r, 6)}-${digits(r, 6)}`, channel: `${mBank} → ${m2Bank} (ORFT)`, rail: 'fiat' });
    ev({ timestamp: at(T0 - 52), kind: 'transfer', severity: 'warning', title: 'โอนต่อบัญชีม้าชั้นที่ 2', detail: `${mBank} → ${m2Bank} ${m2.identifier}`, entityId: m2.id, edgeId: `${P}-e3`, amount: toMule2, currency: 'THB' });
    ev({ timestamp: at(T0 - 70), kind: 'deposit', severity: 'info', title: 'เงินแหล่งอื่นเข้าบัญชีม้าชั้นที่ 2', detail: 'เงินปะปน (Mixed Funds)', entityId: m2.id, amount: m2.pool?.externalOther?.amount, currency: 'THB' });
    const cash2 = Math.round((toMule2 * 0.55) / 1000) * 1000;
    const t2 = `ATM-${m2Bank}-${r.int(1000, 9899)}`;
    const [blat, blng] = near(r.int(-2600, 2600), r.int(-2600, 2600));
    entities.push({ id: `${P}-atm2`, type: 'cash_out', role: 'ATM CASH-OUT #2', label: 'จุดถอนเงินสด #2', identifier: t2, institution: m2Bank, currency: 'THB', status: 'cashed_out', terminalId: t2, locationName: city.name, chokepoint: 'ATM_CASHOUT' });
    edges.push({ id: `${P}-e4`, source: m2.id, target: `${P}-atm2`, amount: cash2, currency: 'THB', timestamp: at(r.int(8, 25)), txRef: `${t2}-CL-${digits(r, 6)}`, channel: `Cardless ATM ×${Math.ceil(cash2 / 20_000)} รายการ`, rail: 'cash', txCount: Math.ceil(cash2 / 20_000) });
    const lastT = edges.at(-1)!.timestamp;
    geoEvents.push({ id: `${P}-g3`, entityId: `${P}-atm2`, type: 'atm_withdrawal', timestamp: lastT, lat: blat, lng: blng, locationName: `${city.name} (ตู้ ${t2})`, terminalId: t2, amount: cash2, currency: 'THB', accuracyM: 15, searchRadiusM: 1500 });
    ev({ timestamp: lastT, kind: 'withdrawal', severity: 'critical', title: `ถอนเงินสด ${t2}`, detail: `Cardless · ${city.name} · รัศมีค้นหา 1,500 m`, entityId: `${P}-atm2`, edgeId: `${P}-e4`, geoEventId: `${P}-g3`, amount: cash2, currency: 'THB' });
  } else {
    // crypto_wallet / txid / case_id / unknown → fiat → OTC → wallet → exchange
    const chain: Chain = det.type === 'crypto_wallet' && det.chain ? det.chain : det.chain === 'ERC-20' ? 'ERC-20' : 'TRC-20';
    const cur: Currency = chain === 'BTC' ? 'BTC' : 'USDT';
    const rate = cur === 'BTC' ? btc : usdt;
    const walletId = det.type === 'crypto_wallet' ? q : chain === 'ERC-20' ? evmAddr(r) : chain === 'BTC' ? btcAddr(r) : tronAddr(r);
    const thbOut = Math.round((loss * (0.7 + r.next() * 0.15)) / 1000) * 1000;
    const received = cur === 'BTC' ? Math.round((thbOut / rate) * 1e8) / 1e8 : Math.round((thbOut / rate) * 100) / 100;
    const extOther = cur === 'BTC' ? r.pick([0.012, 0.025, 0.04]) : r.pick([1200, 2600, 4800]);
    const victimFirst = r.chance(0.5);
    // "minutes ago": the swap lands at T0−45; victim-first → other funds arrive later (T0−52), else earlier (T0−38)
    const extAt = victimFirst ? T0 - 52 : T0 - 38;
    const wallet: FlowEntity = {
      id: `${P}-wallet`, type: 'crypto_wallet', role: det.type === 'crypto_wallet' ? 'TARGET WALLET' : 'CRYPTO POOL', label: det.type === 'crypto_wallet' ? 'กระเป๋าต้องสงสัย (จากการค้นหา)' : 'กระเป๋าคริปโตพักเงิน',
      identifier: walletId, institution: chain === 'BTC' ? 'Bitcoin Network' : chain === 'ERC-20' ? 'Ethereum Network' : 'TRON Network', chain, currency: cur, status: 'monitoring',
      chokepoint: 'HIGH_TAINT_POOL', pool: { fifoVictimFirst: victimFirst, externalOther: { amount: extOther, at: at(extAt), source: 'รับจากกระเป๋าภายนอก' } }, tags: ['Synthesized', chain],
    };
    entities.push(wallet);
    const otcRef = det.type === 'txid' ? q : chain === 'ERC-20' ? `0x${hex64(r)}` : hex64(r);
    edges.push({ id: `${P}-e2`, source: mule.id, target: wallet.id, amount: thbOut, currency: 'THB', receivedAmount: received, receivedCurrency: cur, fxRate: rate, timestamp: at(T0 - 45), txRef: otcRef, channel: `P2P OTC · THB→${cur} @ ฿${rate.toLocaleString('en-US')}`, rail: 'cross_rail' });
    ev({ timestamp: at(extAt), kind: 'deposit', severity: 'info', title: `${cur} จากกระเป๋าอื่นเข้า Pool`, detail: 'เงินปะปน (Mixed Funds)', entityId: wallet.id, amount: extOther, currency: cur });
    ev({ timestamp: at(T0 - 45), kind: 'swap', severity: 'warning', title: `แลก THB → ${cur} ผ่าน P2P OTC`, detail: `${fmtMoney(thbOut, 'THB')} → ${fmtMoney(received, cur)} เข้า ${shortId(walletId)}`, entityId: wallet.id, edgeId: `${P}-e2`, amount: received, currency: cur });
    const toEx = cur === 'BTC' ? Math.round((received + extOther) * 0.6 * 1e8) / 1e8 : Math.round((received + extOther) * 0.6);
    const exId = chain === 'BTC' ? btcAddr(r) : `0x${str(r, HEX, 16)}`;
    entities.push({ id: `${P}-exch`, type: 'exchange', role: 'EXCHANGE · KYC CHOKEPOINT', label: 'บัญชีฝาก Exchange (จุดสกัด KYC)', identifier: exId, institution: r.pick(['TH-DAX Exchange A', 'TH-DAX Exchange B', 'Offshore CEX C']), chain: chain === 'BTC' ? 'BTC' : 'ERC-20', currency: cur, status: 'monitoring', chokepoint: 'EXCHANGE_KYC', fingerprints: [`EXUID:${digits(r, 7)}`], tags: ['Freeze Target'] });
    const exAt = r.int(20, 50);
    edges.push({ id: `${P}-e3`, source: wallet.id, target: `${P}-exch`, amount: toEx, currency: cur, timestamp: at(exAt), txRef: chain === 'ERC-20' ? `0x${hex64(r)}` : hex64(r), channel: `${chain} · Exchange Deposit`, rail: 'crypto' });
    ev({ timestamp: at(exAt), kind: 'transfer', severity: 'critical', title: 'ฝากเข้า Exchange (จุดสกัด KYC)', detail: `${fmtMoney(toEx, cur)} → ${exId}`, entityId: `${P}-exch`, edgeId: `${P}-e3`, amount: toEx, currency: cur });
    const [tlat, tlng] = near(r.int(-1500, 1500), r.int(-1500, 1500));
    geoEvents.push({ id: `${P}-g2`, entityId: wallet.id, type: 'device_telemetry', timestamp: at(T0 - 40), lat: tlat, lng: tlng, locationName: `${city.name} (Wallet session)`, ip: `49.228.${r.int(0, 255)}.${r.int(1, 254)}`, asn: 'AS131445 · AIS (AWN)', accuracyM: 300 });
    ev({ timestamp: at(T0 - 40), kind: 'login', severity: 'info', title: 'Wallet session / Telemetry', detail: `${city.name}`, entityId: wallet.id, geoEventId: `${P}-g2` });
    const [plat, plng] = near(r.int(-2600, 2600), r.int(-2600, 2600));
    const pingAt = r.int(6, 18);
    geoEvents.push({ id: `${P}-g3`, entityId: wallet.id, type: 'cell_ping', timestamp: at(pingAt), lat: plat, lng: plng, locationName: `${city.name} (Cell ping)`, cellId: `eNB 520-03-${r.int(10000, 99999)} · AIS`, accuracyM: 650, searchRadiusM: 1800 });
    ev({ timestamp: at(pingAt), kind: 'ping', severity: 'critical', title: 'สัญญาณมือถือผู้ควบคุมกระเป๋า', detail: `${city.name} · รัศมีค้นหา 1,800 m`, entityId: wallet.id, geoEventId: `${P}-g3` });
  }

  const searchedEntity =
    det.type === 'bank_account' ? mule.id : det.type === 'crypto_wallet' ? `${P}-wallet` : det.type === 'txid' ? `${P}-wallet` : mule.id;
  timeline.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return {
    id,
    primaryKey: det.type === 'case_id' || det.type === 'unknown' ? id : q,
    primaryEntityId: searchedEntity,
    title:
      typology === 'mule_cashout'
        ? 'บัญชีม้าถอนเงินสดต่อเนื่อง (สังเคราะห์จากรูปแบบ)'
        : typology === 'call_center'
          ? 'ติดตาม TxID ต้องสงสัย — ฟอกเงินผ่าน OTC (สังเคราะห์)'
          : 'กระเป๋าคริปโตต้องสงสัย — หลอกลงทุน (สังเคราะห์)',
    titleEn: 'Dynamically Synthesized Case (Pattern-Based)',
    typology,
    lossAmount: loss,
    reportNo: `TPO-6911-00${digits(r, 6)}`,
    openedAt: at(T0 - 20),
    victimProfile: { name: victim.holderName ?? '-', age: r.int(24, 72), province: city.name, channel: 'รอสอบปากคำ' },
    modusOperandi: 'สร้างโดย Dynamic Case Synthesis จากรูปแบบการฟอกเงินที่พบบ่อย — ใช้เพื่อวางแผน/ฝึกซ้อม ต้องยืนยันกับธนาคารและผู้ให้บริการก่อนดำเนินการ',
    summary: `คดีสังเคราะห์จาก "${shortId(q, 10, 6)}" (${det.label}) · พื้นที่ ${city.name} · ความเสียหายจำลอง ${fmtMoney(loss, 'THB')}`,
    usdtThbRate: usdt,
    btcThbRate: btc,
    searchRadiusM: 1800,
    analystAdjustment: { points: 0, reason: '' },
    officer: { rank: 'ร.ต.อ.', name: '(ระบุชื่อพนักงานสอบสวน)', position: 'พนักงานสอบสวน (สบ 2)', unit: 'ศูนย์ปฏิบัติการ บช.สอท. (AOC 1441)', unitShort: 'AOC บช.สอท.', phone: '1441' },
    entities,
    edges,
    geoEvents,
    timeline,
    liveScript: [],
    liveAlertCount: 0,
    synthesized: true,
  };
}
