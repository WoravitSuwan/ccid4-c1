/**
 * Official Thai police draft documents (บันทึกข้อความด่วน บช.สอท.) + forensic evidence summaries.
 * Output is a DRAFT for the inquiry officer — facts, legal basis and format must be verified before signing.
 */
import type {
  CrossCaseLink,
  DocSigner,
  DocumentType,
  EdgeTaint,
  FlowEdge,
  FlowEntity,
  GeoEvent,
  InvestigationCase,
  NodeTaint,
  TaintMethod,
} from '../types/investigation';
import {
  BANK_FULL_NAME,
  METHOD_LABEL,
  METHOD_LABEL_TH,
  fmtCoord,
  fmtDateTime,
  fmtMoney,
  fmtPct,
  fmtThaiDate,
  fmtThaiDateTime,
  toThaiDigits,
} from './format';
import { GEO_TYPE_LABEL } from './geo';
import { toTHB } from './taintEngine';

export const DOC_TYPE_META: Record<DocumentType, { th: string; en: string; short: string }> = {
  freeze_request: { th: 'คำร้องขอระงับธุรกรรม / อายัด', en: 'FREEZE REQUEST', short: 'ขออายัด' },
  kyc_ip_request: { th: 'ขอข้อมูล KYC & IP Log', en: 'KYC / IP REQUEST', short: 'ขอ KYC/IP' },
  atm_cctv_request: { th: 'ขอภาพ CCTV ตู้ ATM', en: 'ATM CCTV REQUEST', short: 'ขอ CCTV' },
};

export function eligibleEntities(type: DocumentType, c: InvestigationCase): FlowEntity[] {
  if (type === 'atm_cctv_request') return c.entities.filter((e) => e.type === 'cash_out');
  return c.entities.filter((e) => e.type === 'mule_bank' || e.type === 'exchange' || e.type === 'crypto_wallet');
}

export function defaultDocTypeFor(e: FlowEntity): DocumentType {
  if (e.type === 'cash_out') return 'atm_cctv_request';
  if (e.type === 'exchange') return 'kyc_ip_request';
  return 'freeze_request';
}

export function defaultSigner(c: InvestigationCase): DocSigner {
  return {
    rank: c.officer.rank,
    name: c.officer.name,
    position: `${c.officer.position} ${c.officer.unitShort}`.trim(),
    docNo: `ตช 0026.(${c.officer.unitShort})/${c.id.slice(-4)}`,
  };
}

export type DocBlock =
  | { kind: 'para'; heading?: string; text: string }
  | { kind: 'bullets'; heading?: string; items: string[] }
  | { kind: 'math'; text: string }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] };

export interface GeneratedDocument {
  type: DocumentType;
  urgency: string;
  agency: string;
  docNo: string;
  dateText: string;
  subject: string;
  recipient: string;
  reference: string;
  attachments: string[];
  blocks: DocBlock[];
  closing: string;
  signer: { rank: string; name: string; position: string };
  disclaimer: string;
  plainText: string;
}

export interface DocContext {
  c: InvestigationCase;
  entity: FlowEntity;
  taint: NodeTaint;
  edgeTaint: Record<string, EdgeTaint>;
  method: TaintMethod;
  signer: DocSigner;
  links: CrossCaseLink[];
  now: number;
  thaiDigits: boolean;
}

const entityName = (c: InvestigationCase, id: string) => {
  const e = c.entities.find((x) => x.id === id);
  return e ? `${e.institution} ${e.identifier}` : id;
};

function institutionFull(e: FlowEntity) {
  return BANK_FULL_NAME[e.institution] ?? e.institution;
}

function txTable(ctx: DocContext, N: (s: string) => string): DocBlock | null {
  const { c, entity, edgeTaint } = ctx;
  const rel = c.edges
    .filter((e) => e.source === entity.id || e.target === entity.id)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!rel.length) return null;
  const row = (e: FlowEdge): string[] => {
    const incoming = e.target === entity.id;
    const et = edgeTaint[e.id];
    const amt = incoming && e.receivedAmount ? fmtMoney(e.receivedAmount, e.receivedCurrency ?? e.currency) : fmtMoney(e.amount, e.currency);
    const tainted = et ? (incoming ? fmtMoney(et.taintedReceived, et.receivedCurrency) : fmtMoney(et.tainted, et.currency)) : '—';
    return [
      N(fmtDateTime(e.timestamp)),
      incoming ? `รับเข้า จาก ${entityName(c, e.source)}` : `โอนออก ไป ${entityName(c, e.target)}`,
      N(amt),
      `${N(tainted)}${et ? ` (${N(fmtPct(et.taintPct))})` : ''}`,
      e.txRef,
    ];
  };
  return {
    kind: 'table',
    caption: `ตารางรายการเดินบัญชีที่เกี่ยวข้อง (คำนวณเงินปนเปื้อนด้วย ${METHOD_LABEL[ctx.method]})`,
    headers: ['วัน-เวลา (ICT)', 'รายการ', 'จำนวนเงิน', 'ส่วนปนเปื้อน', 'เลขอ้างอิง / TxID'],
    rows: rel.map(row),
  };
}

function taintMathBlock(ctx: DocContext, N: (s: string) => string): DocBlock[] {
  const { taint: n, entity, c } = ctx;
  const m = (v: number) => N(fmtMoney(v, n.currency));
  const thb = entity.currency !== 'THB' ? ` (≈ ${N(fmtMoney(toTHB(n.remainingTainted, entity.currency, c), 'THB'))} ที่อัตรา ฿${N(String(entity.currency === 'USDT' ? c.usdtThbRate : c.btcThbRate))}/${entity.currency})` : '';
  return [
    {
      kind: 'para',
      text:
        entity.type === 'cash_out'
          ? `จากการวิเคราะห์เงินปะปนด้วย${METHOD_LABEL_TH[ctx.method]} พบว่ามีการถอนเงินสดรวม ${m(n.totalIn)} ในจำนวนนี้เป็นเงินของผู้เสียหาย ${m(n.victimIn)} คิดเป็นร้อยละ ${N((n.poolTaintPct * 100).toFixed(2))}`
          : `จากการวิเคราะห์เงินปะปนด้วย${METHOD_LABEL_TH[ctx.method]} พบว่ามีเงินของผู้เสียหายเข้า ${m(n.victimIn)} เงินจากแหล่งอื่น ${m(n.otherIn)} รวม ${m(n.totalIn)} โอนออกแล้ว ${m(n.outflow)} (เป็นเงินปนเปื้อน ${m(n.taintedOut)}) คงเหลือเงินปนเปื้อนประมาณ ${m(n.remainingTainted)}${thb} จากยอดคงเหลือรวม ${m(n.remainingTotal)}`,
    },
    { kind: 'math', text: N(n.explanation) },
  ];
}

const LEGAL_FREEZE =
  'อาศัยอำนาจตามพระราชกำหนดมาตรการป้องกันและปราบปรามอาชญากรรมทางเทคโนโลยี พ.ศ. 2566 และที่แก้ไขเพิ่มเติม ประกอบประมวลกฎหมายวิธีพิจารณาความอาญา มาตรา 132 (4)';
const LEGAL_KYC =
  'อาศัยอำนาจตามประมวลกฎหมายวิธีพิจารณาความอาญา มาตรา 132 (4) ประกอบพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550 และที่แก้ไขเพิ่มเติม (ข้อมูลจราจรทางคอมพิวเตอร์ที่ผู้ให้บริการมีหน้าที่เก็บรักษา)';
const LEGAL_CCTV =
  'อาศัยอำนาจตามประมวลกฎหมายวิธีพิจารณาความอาญา มาตรา 132 (4) เพื่อประโยชน์แห่งการสอบสวนและการติดตามจับกุมผู้กระทำความผิด';

export function buildOfficialDocument(type: DocumentType, ctx: DocContext): GeneratedDocument {
  const { c, entity, signer, now, links } = ctx;
  const N = (s: string) => (ctx.thaiDigits ? toThaiDigits(s) : s);
  const victim = c.entities.find((e) => e.type === 'victim');
  const firstVictimEdge = c.edges.filter((e) => e.source === victim?.id).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];
  const geos = c.geoEvents.filter((g) => g.entityId === entity.id).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const entityLinks = links.filter((l) => l.localEntityId === entity.id);
  const agency = `${c.officer.unit} (${c.officer.unitShort}) โทร. ${N(c.officer.phone)}`;

  const facts: DocBlock = {
    kind: 'para',
    heading: '1. ข้อเท็จจริง',
    text: `ด้วย ${c.officer.unitShort} ได้รับแจ้งความร้องทุกข์จาก ${c.victimProfile.name} อายุ ${N(String(c.victimProfile.age))} ปี (เลขรับแจ้งความออนไลน์ ${c.reportNo}) คดีหมายเลข ${c.id} ว่าถูกคนร้ายหลอกลวงในลักษณะ "${c.title}" ผ่านช่องทาง ${c.victimProfile.channel} เป็นเหตุให้โอนเงินจำนวน ${N(fmtMoney(c.lossAmount, 'THB'))} จากบัญชี${victim ? `${BANK_FULL_NAME[victim.institution] ?? victim.institution} เลขที่ ${victim.identifier}` : 'ของผู้เสียหาย'}${firstVictimEdge ? ` เมื่อวันที่ ${N(fmtThaiDateTime(firstVictimEdge.timestamp))}` : ''} พนักงานสอบสวนได้ตรวจสอบเส้นทางการเงินข้ามช่องทาง (Cross-Rail Money Flow) แล้วพบว่า${entity.type === 'cash_out' ? `มีการถอนเงินสดที่เกี่ยวเนื่องกับการกระทำความผิดผ่านตู้ ATM หมายเลข ${entity.terminalId ?? entity.identifier}` : `${entity.type === 'mule_bank' ? 'บัญชีเงินฝาก' : 'บัญชี/กระเป๋าสินทรัพย์ดิจิทัล'}เลขที่ ${entity.identifier}${entity.holderName ? ` ชื่อบัญชี ${entity.holderName}` : ''} (${entity.institution}${entity.chain ? ` · ${entity.chain}` : ''}) เป็นบัญชีที่รับโอนเงินอันเกี่ยวเนื่องกับการกระทำความผิด`}`,
  };

  const linkBlock: DocBlock | null = entityLinks.length
    ? {
        kind: 'bullets',
        heading: 'ข้อมูลเชื่อมโยงข้ามคดี (Cross-Case Link)',
        items: entityLinks.map((l) => `${l.remoteCaseId} — ${l.remoteEntityLabel} (${l.remoteIdentifier}) · หลักฐาน: ${l.evidence.map((e) => `${e.label} [${e.value}]`).join(', ')}`),
      }
    : null;

  const telemetry: string[] = [];
  if (entity.ip) telemetry.push(`IP Address เข้าใช้งานล่าสุด ${entity.ip} (${entity.asn ?? ''} ${entity.isp ?? ''})`.trim());
  if (entity.device) telemetry.push(`อุปกรณ์ ${entity.device}${entity.fingerprints?.length ? ` · ${entity.fingerprints.join(', ')}` : ''}`);
  for (const g of geos)
    telemetry.push(`${GEO_TYPE_LABEL[g.type].th} เมื่อ ${N(fmtDateTime(g.timestamp))} ณ ${g.locationName} พิกัด GPS ${N(fmtCoord(g.lat, g.lng))}${g.accuracyM ? ` (±${N(String(g.accuracyM))} ม.)` : ''}${g.ip ? ` · IP ${g.ip}` : ''}${g.cellId ? ` · ${g.cellId}` : ''}`);

  let subject = '';
  let recipient = '';
  const attachments: string[] = ['สำเนาบันทึกการรับแจ้งความร้องทุกข์', 'รายงานเส้นทางการเงิน (Money Flow & Taint Report) จากระบบ CCIB Command Center'];
  const blocks: DocBlock[] = [facts];
  const table = txTable(ctx, N);

  if (type === 'freeze_request') {
    const isBank = entity.type === 'mule_bank';
    const isExchange = entity.type === 'exchange';
    subject = isBank
      ? `ขอให้ระงับการทำธุรกรรมเป็นการชั่วคราว (อายัด) บัญชีเงินฝากเลขที่ ${entity.identifier}`
      : `ขอให้ระงับการถอน/โอนสินทรัพย์ดิจิทัลเป็นการชั่วคราว (Freeze) ที่เกี่ยวข้องกับ ${entity.identifier}`;
    recipient = isBank
      ? `ผู้จัดการ${institutionFull(entity)} (ฝ่ายบริหารความเสี่ยงด้านการทุจริต / Fraud Management)`
      : isExchange
        ? `ผู้มีอำนาจลงนาม ${entity.institution} (ฝ่ายกำกับดูแลการปฏิบัติตามกฎหมาย / Compliance & Law Enforcement Desk)`
        : entity.currency === 'USDT'
          ? `Tether Operations Limited (ผ่านช่องทาง Law Enforcement Request) สำเนาเรียน เลขาธิการสำนักงาน ก.ล.ต.`
          : 'ผู้ให้บริการสินทรัพย์ดิจิทัลที่ได้รับอนุญาต (ผ่านสำนักงาน ก.ล.ต.)';
    blocks.push(...taintMathBlock(ctx, N));
    if (table) blocks.push(table);
    if (linkBlock) blocks.push(linkBlock);
    blocks.push({ kind: 'para', heading: '2. ข้อกฎหมาย', text: LEGAL_FREEZE });
    blocks.push({
      kind: 'bullets',
      heading: '3. ข้อพิจารณาและขอให้ดำเนินการ',
      items: isBank
        ? [
            `ระงับการทำธุรกรรม (อายัด) บัญชีเลขที่ ${entity.identifier} เป็นการชั่วคราวโดยทันที อย่างน้อยเท่ากับยอดเงินปนเปื้อนคงเหลือ ${N(fmtMoney(ctx.taint.remainingTainted, entity.currency))}`,
            'แจ้งยอดเงินคงเหลือ ณ เวลาที่ระงับธุรกรรม พร้อมหลักฐานการระงับ',
            'จัดส่งรายการเดินบัญชี (Statement) ย้อนหลังตั้งแต่วันเปิดบัญชีจนถึงปัจจุบัน ในรูปแบบไฟล์อิเล็กทรอนิกส์',
            'จัดส่งข้อมูลผู้ถือบัญชี (KYC) สำเนาบัตรประชาชน ภาพถ่ายใบหน้า หมายเลขโทรศัพท์ และอีเมลที่ผูกกับบัญชี',
            'จัดส่งประวัติการเข้าใช้งาน Mobile Banking (IP Address, Device ID, วันเวลา) และบัญชีปลายทางที่รับโอนต่อ',
          ]
        : [
            `ระงับการถอนและการโอนสินทรัพย์ดิจิทัล (Withdrawal/Transfer Freeze) ที่เกี่ยวข้องกับ ${entity.identifier} โดยทันที อย่างน้อยเท่ากับยอดปนเปื้อน ${N(fmtMoney(ctx.taint.remainingTainted, entity.currency))}`,
            'ระบุบัญชีผู้ใช้ (UID) ที่ผูกกับ Address/Deposit Tag ดังกล่าว พร้อมยอดคงเหลือแยกตามสินทรัพย์ ณ เวลาที่ระงับ',
            'จัดส่งประวัติการฝาก-ถอน (TxID) บัญชีธนาคารที่ผูกไว้สำหรับถอนเงินบาท และ Address ปลายทางที่ลงทะเบียน (Whitelist)',
            'เก็บรักษาข้อมูลและหลักฐานอิเล็กทรอนิกส์ทั้งหมดไว้ ห้ามลบหรือแก้ไข จนกว่าจะได้รับแจ้งจากพนักงานสอบสวน',
          ],
    });
  } else if (type === 'kyc_ip_request') {
    subject = `ขอข้อมูลผู้ใช้บริการ (KYC) และข้อมูลจราจรทางคอมพิวเตอร์ (IP Log) ที่เกี่ยวข้องกับ ${entity.identifier}`;
    recipient =
      entity.type === 'mule_bank'
        ? `ผู้จัดการ${institutionFull(entity)} (ฝ่ายกำกับดูแลการปฏิบัติตามกฎหมาย)`
        : entity.type === 'exchange'
          ? `ผู้มีอำนาจลงนาม ${entity.institution} (ฝ่ายกำกับดูแลการปฏิบัติตามกฎหมาย / Compliance & Law Enforcement Desk)`
          : 'ผู้ให้บริการสินทรัพย์ดิจิทัลที่ได้รับอนุญาตทุกราย (ผ่านสำนักงาน ก.ล.ต.)';
    blocks.push(...taintMathBlock(ctx, N));
    if (telemetry.length) blocks.push({ kind: 'bullets', heading: 'ข้อมูล Telemetry ที่ตรวจพบแล้ว', items: telemetry });
    if (table) blocks.push(table);
    if (linkBlock) blocks.push(linkBlock);
    blocks.push({ kind: 'para', heading: '2. ข้อกฎหมาย', text: LEGAL_KYC });
    const from = fmtThaiDate(Math.min(...c.edges.map((e) => Date.parse(e.timestamp))) - 48 * 3600e3);
    blocks.push({
      kind: 'bullets',
      heading: '3. ข้อมูลที่ขอให้จัดส่ง',
      items: [
        'ข้อมูลยืนยันตัวตน (KYC/KYB): ชื่อ-นามสกุล เลขประจำตัวประชาชน/หนังสือเดินทาง ภาพถ่ายบัตรและภาพใบหน้า (Liveness) หมายเลขโทรศัพท์ อีเมล ที่อยู่',
        `ประวัติการเข้าสู่ระบบ (Login Log) ตั้งแต่วันที่ ${N(from)} ถึงปัจจุบัน: วันเวลา IP Address (IPv4/IPv6 + Port) Device ID / User-Agent และพิกัด (ถ้ามี)`,
        'บัญชีธนาคารที่ผูกสำหรับฝาก-ถอนเงินบาท และประวัติการทำรายการ P2P / OTC ทั้งหมด',
        'ประวัติการฝาก-ถอนสินทรัพย์ดิจิทัลพร้อม TxID / Address ต้นทาง-ปลายทาง',
        'บัญชีผู้ใช้อื่นที่ใช้อุปกรณ์ / IP / บัญชีธนาคารร่วมกัน (Linked Accounts)',
      ],
    });
  } else {
    const g = geos.find((x) => x.type === 'atm_withdrawal') ?? geos[0];
    const inEdges = c.edges.filter((e) => e.target === entity.id);
    const total = inEdges.reduce((a, e) => a + e.amount, 0);
    const txCount = inEdges.reduce((a, e) => a + (e.txCount ?? 1), 0);
    const ts = g ? Date.parse(g.timestamp) : Date.parse(inEdges[0]?.timestamp ?? new Date(now).toISOString());
    const w0 = fmtDateTime(ts - 30 * 60e3);
    const w1 = fmtDateTime(ts + 30 * 60e3);
    subject = `ขอภาพบันทึกจากกล้องวงจรปิด (CCTV) และ Electronic Journal ตู้ ATM หมายเลข ${entity.terminalId ?? entity.identifier}`;
    recipient = `ผู้จัดการ${institutionFull(entity)} (ฝ่ายบริหารเครือข่ายเครื่อง ATM / ฝ่ายรักษาความปลอดภัย)`;
    blocks.push({
      kind: 'bullets',
      heading: 'รายละเอียดการถอนเงินสด',
      items: [
        `ตู้ ATM หมายเลข ${entity.terminalId ?? entity.identifier} · ${entity.locationName ?? g?.locationName ?? '-'}`,
        g ? `พิกัด GPS ${N(fmtCoord(g.lat, g.lng))}${g.accuracyM ? ` (±${N(String(g.accuracyM))} ม.)` : ''}` : 'พิกัด GPS: -',
        `วันเวลาที่ถอน ${N(fmtThaiDateTime(ts))} จำนวน ${N(String(txCount))} รายการ รวม ${N(fmtMoney(total, 'THB'))}`,
        ...inEdges.map((e) => `ถอนจากบัญชี ${entityName(c, e.source)} · ${e.channel} · อ้างอิง ${e.txRef}`),
      ],
    });
    blocks.push(...taintMathBlock(ctx, N));
    if (linkBlock) blocks.push(linkBlock);
    blocks.push({ kind: 'para', heading: '2. ข้อกฎหมาย', text: LEGAL_CCTV });
    blocks.push({
      kind: 'bullets',
      heading: '3. ขอให้ดำเนินการ',
      items: [
        `จัดส่งภาพบันทึกกล้องวงจรปิดทุกมุมกล้อง (กล้องหน้าตู้ / Pinhole / กล้องภายนอกบริเวณตู้) ช่วงเวลา ${N(w0)} ถึง ${N(w1)} (ก่อน-หลัง 30 นาที)`,
        'จัดส่ง Electronic Journal (EJ) และข้อมูลการถอนเงินไม่ใช้บัตร (Cardless) ได้แก่ หมายเลขอ้างอิง บัญชี และหมายเลขโทรศัพท์ที่ใช้ขอรหัส',
        'เก็บรักษาภาพและข้อมูลไว้เป็นพยานหลักฐานโดยด่วน ก่อนครบรอบการบันทึกทับของระบบ',
        `ขอความร่วมมือแจ้งเตือนทันทีหากมีการทำรายการซ้ำที่ตู้ใด ๆ ในรัศมี ${N((c.searchRadiusM / 1000).toFixed(1))} กม. จากจุดนี้`,
      ],
    });
  }

  const closing = 'จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการด่วนที่สุด และขอได้โปรดแจ้งผลการดำเนินการกลับมายังพนักงานสอบสวนภายใน 24 ชั่วโมง จักขอบคุณยิ่ง';
  const doc: Omit<GeneratedDocument, 'plainText'> = {
    type,
    urgency: 'ด่วนที่สุด',
    agency,
    docNo: N(signer.docNo),
    dateText: N(fmtThaiDate(now)),
    subject,
    recipient,
    reference: `คดีอาญาที่ ${c.id} · เลขรับแจ้ง ${c.reportNo} · ${METHOD_LABEL[ctx.method]}`,
    attachments: attachments.map(N),
    blocks,
    closing: N(closing),
    signer: { rank: signer.rank, name: signer.name, position: signer.position },
    disclaimer: 'แบบร่างสร้างโดยระบบ CCIB Command Center — พนักงานสอบสวนต้องตรวจสอบข้อเท็จจริง ข้อกฎหมาย และรูปแบบหนังสือราชการก่อนลงนามและนำส่ง',
  };
  return { ...doc, plainText: documentToPlainText(doc) };
}

export function documentToPlainText(d: Omit<GeneratedDocument, 'plainText'>): string {
  const L: string[] = [];
  L.push(`${d.urgency}`.padStart(60));
  L.push('บันทึกข้อความ'.padStart(40));
  L.push('');
  L.push(`ส่วนราชการ  ${d.agency}`);
  L.push(`ที่  ${d.docNo}                    วันที่  ${d.dateText}`);
  L.push(`เรื่อง  ${d.subject}`);
  L.push('');
  L.push(`เรียน  ${d.recipient}`);
  L.push(`อ้างถึง  ${d.reference}`);
  L.push(`สิ่งที่ส่งมาด้วย  ${d.attachments.map((a, i) => `${i + 1}. ${a}`).join('  ')}`);
  L.push('');
  for (const b of d.blocks) {
    if (b.kind === 'para') {
      if (b.heading) L.push(b.heading);
      L.push(`        ${b.text}`);
    } else if (b.kind === 'math') {
      L.push(`        [การคำนวณ] ${b.text}`);
    } else if (b.kind === 'bullets') {
      if (b.heading) L.push(b.heading);
      b.items.forEach((it, i) => L.push(`        (${i + 1}) ${it}`));
    } else {
      L.push(`        ${b.caption}`);
      L.push(`        ${b.headers.join(' | ')}`);
      b.rows.forEach((r) => L.push(`        ${r.join(' | ')}`));
    }
    L.push('');
  }
  L.push(`        ${d.closing}`);
  L.push('');
  L.push('(ลงชื่อ) ...........................................'.padStart(70));
  L.push(`(${d.signer.rank} ${d.signer.name})`.padStart(60));
  L.push(`${d.signer.position}`.padStart(60));
  L.push('');
  L.push(`หมายเหตุ: ${d.disclaimer}`);
  return L.join('\n');
}

/** Copyable one-glance evidence summary for the inspector. */
export function buildForensicSummary(args: {
  c: InvestigationCase;
  entity: FlowEntity;
  taint?: NodeTaint;
  method: TaintMethod;
  geos: GeoEvent[];
  links: CrossCaseLink[];
  now: number;
}): string {
  const { c, entity, taint, method, geos, links, now } = args;
  const L: string[] = [];
  L.push(`[${c.id}] ${entity.role} · ${entity.institution} ${entity.identifier}`);
  L.push(`คดี: ${c.title} (${c.titleEn})`);
  if (entity.holderName) L.push(`ชื่อบัญชี: ${entity.holderName}`);
  if (entity.chain) L.push(`เครือข่าย: ${entity.chain} · สกุล ${entity.currency}`);
  if (taint) {
    L.push(`Taint (${METHOD_LABEL[method]}): ${taint.explanation}`);
    L.push(
      `ยอดรับเข้า ${fmtMoney(taint.totalIn, taint.currency)} | เงินผู้เสียหาย ${fmtMoney(taint.victimIn, taint.currency)} (${fmtPct(taint.poolTaintPct)}) | คงเหลือปนเปื้อน ${fmtMoney(taint.remainingTainted, taint.currency)}${taint.currency !== 'THB' ? ` ≈ ${fmtMoney(toTHB(taint.remainingTainted, taint.currency, c), 'THB')}` : ''}`,
    );
  }
  if (entity.ip) L.push(`IP / ASN: ${entity.ip} · ${entity.asn ?? ''} ${entity.isp ?? ''}`.trim());
  if (entity.device) L.push(`อุปกรณ์: ${entity.device}${entity.fingerprints?.length ? ` · ${entity.fingerprints.join(', ')}` : ''}`);
  for (const g of geos)
    L.push(`GPS #${g.id.split('-').pop()}: ${fmtCoord(g.lat, g.lng)} · ${g.locationName} · ${fmtDateTime(g.timestamp)} ICT${g.terminalId ? ` · ${g.terminalId}` : ''}`);
  if (links.length)
    L.push(`Cross-case: ${links.map((l) => `${l.remoteCaseId} (${l.evidence.map((e) => e.label).join(', ')})`).join('; ')}`);
  L.push(`สร้างเมื่อ: ${fmtDateTime(now)} ICT · CCIB Cyber-Financial & Geo-Interception Command Center`);
  return L.join('\n');
}
