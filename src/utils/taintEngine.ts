/**
 * Dynamic Taint & Mixed-Fund Engine
 * ───────────────────────────────────
 * Propagates the victim's money through the cross-rail graph (bank → bank → OTC → wallet → exchange / ATM)
 * and, at every node where it mixes with other funds, attributes each outgoing transfer with either:
 *
 *  • Proportional (Haircut %) — every baht/USDT leaving the pool carries the pool's victim ratio.
 *  • FIFO (First-In, First-Out) — outflows consume the earliest-arriving bucket first
 *    (`pool.fifoVictimFirst` says whether the victim's money or the other funds arrived first).
 *
 * Also contains the Interception Priority / Risk scoring helpers and the live public-blockchain lookup
 * (mempool.space → blockstream.info → deterministic simulated fallback).
 */
import type {
  CaseTaintResult,
  ChainFailReason,
  ChokepointType,
  CrossCaseLink,
  Currency,
  EdgeTaint,
  FlowEdge,
  FlowEntity,
  FundDisposition,
  InterceptionTarget,
  InvestigationCase,
  LiveChainResult,
  NodeTaint,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  TaintMethod,
} from '../types/investigation';
import { fmtDuration, fmtMoney, fmtPct } from './format';
import { isBtcAddress, isBtcTxid } from './inputDetect';

const EPS = 1e-6;
const t = (iso: string) => Date.parse(iso);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function toTHB(amount: number, currency: Currency, c: Pick<InvestigationCase, 'usdtThbRate' | 'btcThbRate'>): number {
  if (currency === 'USDT') return amount * c.usdtThbRate;
  if (currency === 'BTC') return amount * c.btcThbRate;
  return amount;
}

// ───────────────────────── Graph helpers ─────────────────────────

function topoOrder(entities: FlowEntity[], edges: FlowEdge[]): string[] {
  const indeg = new Map<string, number>(entities.map((e) => [e.id, 0]));
  const out = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
  }
  const queue = entities.filter((e) => (indeg.get(e.id) ?? 0) === 0).map((e) => e.id);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of out.get(id) ?? []) {
      const d = (indeg.get(e.target) ?? 1) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  for (const e of entities) if (!seen.has(e.id)) order.push(e.id); // cycles (should not happen) → append
  return order;
}

/** Longest path depth (in hops) for every node — also used by the auto-layout. */
export function nodeDepths(entities: FlowEntity[], edges: FlowEdge[]): Record<string, number> {
  const depth: Record<string, number> = Object.fromEntries(entities.map((e) => [e.id, 0]));
  for (const id of topoOrder(entities, edges)) {
    for (const e of edges) if (e.source === id) depth[e.target] = Math.max(depth[e.target] ?? 0, (depth[id] ?? 0) + 1);
  }
  return depth;
}

// ───────────────────────── Taint propagation ─────────────────────────

function explain(n: Omit<NodeTaint, 'explanation'>, type: FlowEntity['type'], externalSource: boolean): string {
  const m = (v: number) => fmtMoney(v, n.currency);
  if (n.isOrigin) return `ต้นทางผู้เสียหาย: เงิน ${m(n.victimIn)} ถือเป็นเงินปนเปื้อน 100% (Taint Origin)`;
  if (externalSource)
    return `แหล่งเงินอื่น (ไม่ใช่เงินผู้เสียหายคดีนี้): โอนออก ${m(n.outflow)} · ปนเปื้อน 0% — นับเป็น "เงินปะปน" ของบัญชีปลายทาง`;
  if (type === 'cash_out')
    return `ถอนเงินสด ${m(n.totalIn)} → ปนเปื้อน ${m(n.victimIn)} (${fmtPct(n.poolTaintPct)}) · ออกจากระบบธนาคารแล้ว ต้องติดตามทางกายภาพ`;
  if (n.totalIn < EPS) return 'ยังไม่มีเงินเข้า ณ เวลาที่เลือก (Playback)';
  if (n.outflow < EPS)
    return `ยังไม่โอนออก: ยอดปนเปื้อนคงค้าง ${m(n.victimIn)} จากยอดรวม ${m(n.totalIn)} (${fmtPct(n.poolTaintPct)}) — อายัดได้ทันที`;
  if (n.otherIn < EPS)
    return `ไม่มีเงินปะปน → โอนออก ${m(n.outflow)} ปนเปื้อน 100% · คงเหลือปนเปื้อน ${m(n.remainingTainted)}`;
  if (n.method === 'proportional')
    return `Haircut: ${m(n.victimIn)} ÷ ${m(n.totalIn)} = ${fmtPct(n.poolTaintPct)} → โอนออก ${m(n.outflow)} × ${fmtPct(n.poolTaintPct)} = ${m(n.taintedOut)} · คงเหลือปนเปื้อน ${m(n.remainingTainted)}`;
  if (n.fifoVictimFirst)
    return `FIFO (เงินผู้เสียหายเข้าก่อน): min(โอนออก ${m(n.outflow)}, เงินผู้เสียหาย ${m(n.victimIn)}) = ${m(n.taintedOut)} ปนเปื้อน (${fmtPct(n.taintPctOut)}) · คงเหลือปนเปื้อน ${m(n.remainingTainted)}`;
  return `FIFO (เงินอื่นเข้าก่อน): max(0, โอนออก ${m(n.outflow)} − เงินอื่น ${m(n.otherIn)}) = ${m(n.taintedOut)} ปนเปื้อน (${fmtPct(n.taintPctOut)}) · คงเหลือปนเปื้อน ${m(n.remainingTainted)}`;
}

/**
 * Compute victim taint for every node & edge.
 * @param asOf  epoch ms — only transfers / external inflows at or before this instant are counted (playback).
 */
export function computeCaseTaint(c: InvestigationCase, method: TaintMethod, asOf = Number.POSITIVE_INFINITY): CaseTaintResult {
  const edges = c.edges.filter((e) => t(e.timestamp) <= asOf);
  const byId = new Map(c.entities.map((e) => [e.id, e]));
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  const nodes: Record<string, NodeTaint> = {};
  const edgeTaint: Record<string, EdgeTaint> = {};

  for (const id of topoOrder(c.entities, edges)) {
    const ent = byId.get(id);
    if (!ent) continue;
    const ins = incoming.get(id) ?? [];
    const outs = [...(outgoing.get(id) ?? [])].sort((a, b) => t(a.timestamp) - t(b.timestamp));
    const isOrigin = ent.type === 'victim';
    const fifoVictimFirst = ent.pool?.fifoVictimFirst ?? true;

    let victimIn = 0;
    let otherIn = 0;
    if (isOrigin) {
      victimIn = sum(outs.map((e) => e.amount));
    } else {
      for (const e of ins) {
        const et = edgeTaint[e.id];
        if (!et) continue;
        victimIn += et.taintedReceived;
        otherIn += et.received - et.taintedReceived;
      }
      const ext = ent.pool?.externalOther;
      if (ext && (!ext.at || t(ext.at) <= asOf)) otherIn += ext.amount;
    }
    const outflow = sum(outs.map((e) => e.amount));
    // A non-victim node with no traced inflow is itself a source of "other" (non-victim) money.
    const externalSource = !isOrigin && c.edges.every((e) => e.target !== id) && !ent.pool?.externalOther;
    if (externalSource) otherIn += outflow;
    const totalIn = victimIn + otherIn;

    let vLeft = victimIn;
    let oLeft = otherIn;
    let taintedOut = 0;
    let cleanOut = 0;
    let unattributedOut = 0;
    const ratio = totalIn > EPS ? victimIn / totalIn : 0;

    for (const e of outs) {
      let tainted = 0;
      let clean = 0;
      if (isOrigin) {
        tainted = e.amount;
      } else if (method === 'proportional') {
        const covered = Math.min(e.amount, vLeft + oLeft);
        tainted = Math.min(covered * ratio, vLeft);
        clean = Math.min(covered - tainted, oLeft);
        vLeft -= tainted;
        oLeft -= clean;
      } else {
        let need = e.amount;
        const order: ('v' | 'o')[] = fifoVictimFirst ? ['v', 'o'] : ['o', 'v'];
        for (const b of order) {
          const take = Math.min(need, b === 'v' ? vLeft : oLeft);
          if (b === 'v') {
            tainted += take;
            vLeft -= take;
          } else {
            clean += take;
            oLeft -= take;
          }
          need -= take;
        }
      }
      const unexplained = Math.max(0, e.amount - tainted - clean);
      unattributedOut += isOrigin ? 0 : unexplained;
      taintedOut += tainted;
      cleanOut += clean;
      const received = e.receivedAmount ?? e.amount;
      const scale = e.amount > EPS ? received / e.amount : 1;
      edgeTaint[e.id] = {
        edgeId: e.id,
        amount: e.amount,
        currency: e.currency,
        tainted,
        taintPct: e.amount > EPS ? tainted / e.amount : 0,
        received,
        receivedCurrency: e.receivedCurrency ?? e.currency,
        taintedReceived: tainted * scale,
      };
    }

    const base: Omit<NodeTaint, 'explanation'> = {
      entityId: id,
      currency: ent.currency,
      method,
      isOrigin,
      fifoVictimFirst,
      victimIn,
      otherIn,
      totalIn,
      outflow,
      taintedOut,
      cleanOut,
      unattributedOut,
      taintPctOut: outflow > EPS ? taintedOut / outflow : 0,
      poolTaintPct: totalIn > EPS ? victimIn / totalIn : 0,
      remainingTainted: isOrigin ? 0 : Math.max(0, victimIn - taintedOut),
      remainingClean: isOrigin ? 0 : Math.max(0, otherIn - cleanOut),
      remainingTotal: isOrigin ? 0 : Math.max(0, totalIn - outflow),
    };
    nodes[id] = { ...base, explanation: explain(base, ent.type, externalSource) };
  }

  // ── Totals & disposition of the victim's money (THB equivalent) ──
  const victimLossTHB = sum(
    c.entities.filter((e) => e.type === 'victim').map((e) => toTHB(nodes[e.id]?.victimIn ?? 0, e.currency, c)),
  );
  const bucket: Record<FundDisposition['key'], number> = { cash_out: 0, exchange: 0, mule_bank: 0, crypto_wallet: 0, unattributed: 0 };
  for (const e of c.entities) {
    const n = nodes[e.id];
    if (!n || e.type === 'victim') continue;
    const held = e.type === 'cash_out' ? n.victimIn : n.remainingTainted;
    bucket[e.type] += toTHB(held, e.currency, c);
  }
  const attributed = bucket.cash_out + bucket.exchange + bucket.mule_bank + bucket.crypto_wallet;
  bucket.unattributed = Math.max(0, victimLossTHB - attributed);
  const LABEL: Record<FundDisposition['key'], string> = {
    cash_out: 'ถอนเป็นเงินสดแล้ว',
    exchange: 'อยู่ที่ Exchange',
    mule_bank: 'คงค้างบัญชีม้า',
    crypto_wallet: 'คงค้างกระเป๋าคริปโต',
    unattributed: 'ระหว่างทาง / ไม่ทราบ',
  };
  const order: FundDisposition['key'][] = ['cash_out', 'exchange', 'mule_bank', 'crypto_wallet', 'unattributed'];
  const disposition = order
    .map((key) => ({ key, label: LABEL[key], thb: bucket[key], pct: victimLossTHB > EPS ? bucket[key] / victimLossTHB : 0 }))
    .filter((d) => d.thb > 0.5);

  return {
    method,
    asOf,
    nodes,
    edges: edgeTaint,
    totals: {
      victimLossTHB,
      cashedOutTHB: bucket.cash_out,
      atExchangeTHB: bucket.exchange,
      recoverableTHB: bucket.exchange + bucket.mule_bank + bucket.crypto_wallet,
      disposition,
    },
  };
}

// ───────────────────────── Risk / Interception Priority ─────────────────────────

export const riskLevelOf = (score: number): RiskLevel =>
  score >= 90 ? 'CRITICAL' : score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

const TYPOLOGY_POINTS: Record<InvestigationCase['typology'], { pts: number; label: string }> = {
  call_center: { pts: 10, label: 'แก๊งคอลเซ็นเตอร์แอบอ้างเจ้าหน้าที่ · ผู้เสียหายเปราะบาง' },
  investment_scam: { pts: 5, label: 'หลอกลงทุนสินทรัพย์ดิจิทัล' },
  mule_cashout: { pts: 6, label: 'เครือข่ายบัญชีม้าถอนเงินสด' },
  synthesized: { pts: 5, label: 'รูปแบบสังเคราะห์ (ต้องยืนยัน)' },
};

/**
 * Transparent, additive Interception-Priority / Risk score (0–100).
 * Every factor is shown to the officer with its points so the number is explainable in court.
 */
export function computeCaseRisk(
  c: InvestigationCase,
  opts: { linkedCaseIds: string[]; now: number },
): RiskAssessment {
  const factors: RiskFactor[] = [];
  const add = (key: string, label: string, labelEn: string, points: number, max: number, detail: string) =>
    factors.push({ key, label, labelEn, points: Math.max(-max, Math.min(max, points)), max, detail });

  // A. Geo freshness — how actionable is the suspect's last known position?
  const lastGeo = Math.max(...c.geoEvents.map((g) => t(g.timestamp)), Number.NEGATIVE_INFINITY);
  const geoAge = opts.now - lastGeo;
  const geoPts = !Number.isFinite(geoAge) ? 0 : geoAge <= 15 * 60e3 ? 15 : geoAge <= 45 * 60e3 ? 12 : geoAge <= 2 * 3600e3 ? 8 : geoAge <= 6 * 3600e3 ? 4 : 1;
  add('geo', 'ความสดของพิกัดผู้ต้องสงสัย', 'Geo Fix Freshness', geoPts, 15, Number.isFinite(geoAge) ? `จุดล่าสุดเมื่อ ${fmtDuration(geoAge)} ก่อน` : 'ไม่มีพิกัด');

  // B. Physical cash-out exposure (count, recency, roaming across terminals)
  const cash = c.entities.filter((e) => e.type === 'cash_out');
  const cashEdges = c.edges.filter((e) => cash.some((x) => x.id === e.target));
  const lastCash = Math.max(...cashEdges.map((e) => t(e.timestamp)), Number.NEGATIVE_INFINITY);
  const firstCash = Math.min(...cashEdges.map((e) => t(e.timestamp)), Number.POSITIVE_INFINITY);
  const roaming = cash.length >= 2 && lastCash - firstCash <= 3 * 3600e3;
  let cashPts = cash.length === 0 ? 0 : cash.length === 1 ? 8 : cash.length === 2 ? 13 : 16;
  if (cash.length && opts.now - lastCash <= 60 * 60e3) cashPts += 2;
  if (roaming) cashPts += 3;
  add('cash', 'การถอนเงินสดทางกายภาพ', 'ATM Cash-Out Exposure', cashPts, 18,
    cash.length ? `${cash.length} จุดถอน${roaming ? ' · ตระเวนหลายตู้ภายใน 3 ชม.' : ''}` : 'ยังไม่พบการถอนเงินสด');

  // C. Loss magnitude
  const L = c.lossAmount;
  add('loss', 'มูลค่าความเสียหาย', 'Loss Magnitude', L >= 800_000 ? 15 : L >= 400_000 ? 13 : L >= 100_000 ? 10 : L >= 20_000 ? 6 : 3, 15, fmtMoney(L, 'THB'));

  // D. Velocity — money-movement span (transfers, swaps, withdrawals)
  const moneyTimes = c.edges.map((e) => t(e.timestamp));
  const span = moneyTimes.length ? Math.max(...moneyTimes) - Math.min(...moneyTimes) : Number.POSITIVE_INFINITY;
  add('velocity', 'ความเร็วการโยกย้ายเงิน', 'Laundering Velocity',
    span <= 3 * 3600e3 ? 10 : span <= 6 * 3600e3 ? 7 : span <= 24 * 3600e3 ? 4 : 2, 10, `กระจายเงินครบใน ${fmtDuration(span)}`);

  // E. Cross-rail obfuscation (fiat → crypto, bridges)
  const crypto = c.entities.filter((e) => e.type === 'crypto_wallet' || e.type === 'exchange');
  const bridge = c.edges.some((e) => /bridge/i.test(e.channel));
  add('rail', 'ข้ามช่องทาง Fiat → Crypto', 'Cross-Rail Obfuscation', crypto.length ? 9 + (bridge ? 2 : 0) : 0, 11,
    crypto.length ? `แปลงเป็นคริปโต ${bridge ? '+ Bridge ข้ามเชน' : ''}`.trim() : 'อยู่ในระบบธนาคาร/เงินสด');

  // F. Actionable chokepoint
  const hasExchange = c.entities.some((e) => e.type === 'exchange');
  add('choke', 'จุดสกัดที่ดำเนินการได้', 'Actionable Chokepoint', hasExchange ? 10 : cash.length ? 8 : 0, 10,
    hasExchange ? 'Exchange KYC / อายัดได้' : cash.length ? 'CCTV ตู้ ATM / สกัดจุดถอน' : 'ไม่มี');

  // G. Cross-case network
  const linked = [...new Set(opts.linkedCaseIds)];
  add('network', 'เชื่อมโยงข้ามคดี', 'Cross-Case Network', Math.min(10, linked.length * 5), 10,
    linked.length ? linked.join(', ') : 'ไม่พบโหนดร่วม');

  // H. Layering depth & mixing
  const depths = nodeDepths(c.entities, c.edges);
  const depth = Math.max(0, ...Object.values(depths));
  const mixed = c.entities.filter((e) => e.type !== 'victim' && (e.pool?.externalOther || c.edges.filter((x) => x.target === e.id).length > 1)).length;
  add('layering', 'ชั้นการฟอก & เงินปะปน', 'Layering & Mixing', Math.min(6, depth * 2) + Math.min(4, mixed * 2), 10, `${depth} ชั้น · ${mixed} pool ปะปน`);

  // I. Typology
  const typ = TYPOLOGY_POINTS[c.typology];
  add('typology', 'รูปแบบคดี / ความเปราะบาง', 'Typology Severity', typ.pts, 10, typ.label);

  // J. Live activity
  if (c.liveAlertCount > 0) add('live', 'ความเคลื่อนไหวสด', 'Live Activity', c.liveAlertCount * 2, 8, `${c.liveAlertCount} การแจ้งเตือนสด`);

  // K. Analyst intel adjustment (documented override)
  if (c.analystAdjustment.points !== 0)
    add('analyst', 'ข่าวกรองผู้วิเคราะห์', 'Analyst Intel', c.analystAdjustment.points, 15, c.analystAdjustment.reason);

  const score = Math.max(0, Math.min(100, Math.round(sum(factors.map((f) => f.points)))));
  const level = riskLevelOf(score);
  const activeCashOut = cashPts >= 15 && !crypto.length;
  return { score, level, label: `${level}${activeCashOut ? ' - ACTIVE CASH-OUT' : ''}`, factors };
}

/** Per-entity interception priority (which chokepoint to hit first). */
export function computeInterceptionTargets(
  c: InvestigationCase,
  taint: CaseTaintResult,
  links: CrossCaseLink[],
  now: number,
): InterceptionTarget[] {
  const loss = Math.max(1, taint.totals.victimLossTHB || c.lossAmount);
  const out: InterceptionTarget[] = [];
  for (const e of c.entities) {
    const n = taint.nodes[e.id];
    if (!n || e.type === 'victim') continue;
    let choke: ChokepointType | undefined = e.chokepoint;
    if (!choke && e.type === 'exchange') choke = 'EXCHANGE_KYC';
    if (!choke && e.type === 'cash_out') choke = 'ATM_CASHOUT';
    if (!choke && e.type === 'crypto_wallet' && n.poolTaintPct >= 0.5 && n.remainingTainted > EPS) choke = 'HIGH_TAINT_POOL';
    if (!choke && e.type === 'mule_bank' && n.remainingTainted > EPS) choke = 'BANK_FREEZE';
    if (!choke) continue;

    const held = e.type === 'cash_out' ? n.victimIn : n.remainingTainted;
    const thb = toTHB(held, e.currency, c);
    const lastActivity = Math.max(
      ...c.edges.filter((x) => x.source === e.id || x.target === e.id).map((x) => t(x.timestamp)),
      ...c.geoEvents.filter((g) => g.entityId === e.id).map((g) => t(g.timestamp)),
      Number.NEGATIVE_INFINITY,
    );
    const age = now - lastActivity;
    const base = choke === 'EXCHANGE_KYC' ? 45 : choke === 'ATM_CASHOUT' ? 40 : choke === 'HIGH_TAINT_POOL' ? 35 : 32;
    const share = Math.min(25, (25 * thb) / loss);
    const recency = age <= 30 * 60e3 ? 15 : age <= 2 * 3600e3 ? 10 : age <= 24 * 3600e3 ? 5 : 0;
    const x = Math.min(10, links.filter((l) => l.localEntityId === e.id).length * 5);
    const geo = c.geoEvents.some((g) => g.entityId === e.id) ? 5 : 0;
    const priority = Math.round(Math.min(100, base + share + recency + x + geo));
    const action = choke === 'ATM_CASHOUT' ? 'atm_cctv_request' : choke === 'EXCHANGE_KYC' ? 'kyc_ip_request' : 'freeze_request';
    const reason =
      choke === 'EXCHANGE_KYC'
        ? `เงินปนเปื้อนค้างที่ Exchange ${fmtMoney(held, e.currency)} — ขอ KYC/อายัดก่อนถอนออก`
        : choke === 'ATM_CASHOUT'
          ? `ถอนเงินสดปนเปื้อน ${fmtMoney(held, e.currency)} — ขอ CCTV ระบุตัวผู้ถอน`
          : choke === 'HIGH_TAINT_POOL'
            ? `Pool ปนเปื้อน ${fmtPct(n.poolTaintPct)} คงค้าง ${fmtMoney(held, e.currency)}`
            : `บัญชีม้าคงค้างเงินปนเปื้อน ${fmtMoney(held, e.currency)} — อายัดทันที`;
    out.push({ entityId: e.id, chokepoint: choke, priority, remainingTainted: held, currency: e.currency, thbEquivalent: thb, reason, action });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// ───────────────────────── Live public blockchain lookup ─────────────────────────

const PROVIDERS: { name: 'mempool.space' | 'blockstream.info'; base: string }[] = [
  { name: 'mempool.space', base: 'https://mempool.space/api' },
  { name: 'blockstream.info', base: 'https://blockstream.info/api' },
];

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number, as: 'json' | 'text'): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: as === 'json' ? 'application/json' : 'text/plain' } });
    if (!res.ok) throw new HttpError(res.status);
    return as === 'json' ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function classify(err: unknown): ChainFailReason {
  if (err instanceof HttpError) return err.status === 404 || err.status === 400 ? 'NOT_FOUND' : 'HTTP_ERROR';
  if (err instanceof DOMException && err.name === 'AbortError') return 'TIMEOUT';
  if (err instanceof TypeError) return 'CORS_OR_OFFLINE';
  return 'NETWORK_ERROR';
}

interface EsploraTx {
  txid: string;
  fee: number;
  weight: number;
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } }[];
  vout: { scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}
interface EsploraAddr {
  address: string;
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

/**
 * Inspect a Bitcoin TxID or address on public Esplora APIs (no API key).
 * Falls back gracefully to a deterministic simulated forensic snapshot when offline, CORS-blocked,
 * not found, or when the query isn't a Bitcoin identifier.
 */
export async function fetchPublicBitcoinInfo(query: string, timeoutMs = 6500): Promise<LiveChainResult> {
  const q = query.trim();
  const kind: 'tx' | 'address' | null = isBtcTxid(q) ? 'tx' : isBtcAddress(q) ? 'address' : null;
  if (!kind) return simulateChainInfo(q, /^0x[0-9a-f]{64}$/i.test(q) ? 'tx' : 'address', 'NOT_BTC');

  let reason: ChainFailReason = 'NETWORK_ERROR';
  for (const p of PROVIDERS) {
    const started = performance.now();
    try {
      const data = await fetchWithTimeout(`${p.base}/${kind}/${q}`, timeoutMs, 'json');
      let tipHeight: number | undefined;
      try {
        tipHeight = Number(await fetchWithTimeout(`${p.base}/blocks/tip/height`, 3500, 'text')) || undefined;
      } catch {
        /* tip height is optional */
      }
      const latencyMs = Math.round(performance.now() - started);
      const base = { source: p.name, live: true, kind, query: q, fetchedAt: new Date().toISOString(), latencyMs, tipHeight } as const;
      if (kind === 'tx') {
        const tx = data as EsploraTx;
        const outs = tx.vout.map((v) => ({ address: v.scriptpubkey_address ?? '(OP_RETURN / non-standard)', valueSats: v.value }));
        return {
          ...base,
          tx: {
            txid: tx.txid,
            confirmed: tx.status.confirmed,
            blockHeight: tx.status.block_height,
            blockTime: tx.status.block_time,
            confirmations: tx.status.confirmed && tipHeight && tx.status.block_height ? tipHeight - tx.status.block_height + 1 : 0,
            feeSats: tx.fee,
            vsize: Math.ceil(tx.weight / 4),
            inputs: tx.vin.length,
            outputs: tx.vout.length,
            totalOutSats: sum(tx.vout.map((v) => v.value)),
            topOutputs: [...outs].sort((a, b) => b.valueSats - a.valueSats).slice(0, 5),
            inputAddresses: [...new Set(tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter((a): a is string => !!a))].slice(0, 5),
          },
        };
      }
      const a = data as EsploraAddr;
      return {
        ...base,
        address: {
          address: a.address,
          txCount: a.chain_stats.tx_count,
          fundedSats: a.chain_stats.funded_txo_sum,
          spentSats: a.chain_stats.spent_txo_sum,
          balanceSats: a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum,
          mempoolTxCount: a.mempool_stats.tx_count,
          mempoolDeltaSats: a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum,
        },
      };
    } catch (err) {
      reason = classify(err);
      if (reason === 'NOT_FOUND') break; // both providers index the same chain
    }
  }
  return simulateChainInfo(q, kind, reason);
}

/** Deterministic pseudo-random snapshot so the UI stays useful offline. Clearly labelled SIMULATED. */
export function simulateChainInfo(q: string, kind: 'tx' | 'address', reason: ChainFailReason): LiveChainResult {
  let h = 2166136261;
  for (let i = 0; i < q.length; i++) h = Math.imul(h ^ q.charCodeAt(i), 16777619);
  const rnd = (n: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>> 0) % n) / n;
  };
  const tip = 925_000 + Math.floor(rnd(4000));
  const base = { source: 'simulated' as const, live: false, kind, query: q, fetchedAt: new Date().toISOString(), tipHeight: tip, reason };
  const fakeAddr = (p: string) => `${p}${Array.from({ length: 38 }, () => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[Math.floor(rnd(32))]).join('')}`;
  if (kind === 'tx') {
    const outputs = 2 + Math.floor(rnd(4));
    const values = Array.from({ length: outputs }, () => Math.floor(200_000 + rnd(45_000_000)));
    const height = tip - Math.floor(rnd(1200));
    return {
      ...base,
      tx: {
        txid: q,
        confirmed: true,
        blockHeight: height,
        blockTime: Math.floor(Date.now() / 1000) - (tip - height) * 600,
        confirmations: tip - height + 1,
        feeSats: Math.floor(1500 + rnd(18_000)),
        vsize: Math.floor(140 + rnd(600)),
        inputs: 1 + Math.floor(rnd(5)),
        outputs,
        totalOutSats: sum(values),
        topOutputs: values.map((v) => ({ address: fakeAddr('bc1q'), valueSats: v })).sort((a, b) => b.valueSats - a.valueSats),
        inputAddresses: [fakeAddr('bc1q')],
      },
    };
  }
  const funded = Math.floor(5_000_000 + rnd(900_000_000));
  const spent = Math.floor(funded * (0.55 + rnd(0.45)));
  return {
    ...base,
    address: {
      address: q,
      txCount: 3 + Math.floor(rnd(140)),
      fundedSats: funded,
      spentSats: spent,
      balanceSats: funded - spent,
      mempoolTxCount: rnd(1) > 0.7 ? 1 : 0,
      mempoolDeltaSats: 0,
    },
  };
}

export const satsToBtc = (s: number) => s / 1e8;
