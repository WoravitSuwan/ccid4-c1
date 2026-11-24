/** JSON / Markdown evidence case export with SHA-256 integrity hash. */
import type { CaseTaintResult, CrossCaseLink, InterceptionTarget, InvestigationCase, RiskAssessment, TaintMethod } from '../types/investigation';
import { METHOD_LABEL, fmtDateTime, fmtMoney, fmtPct } from './format';
import { toTHB } from './taintEngine';

export interface ExportBundle {
  c: InvestigationCase;
  method: TaintMethod;
  taint: CaseTaintResult;
  risk: RiskAssessment;
  links: CrossCaseLink[];
  targets: InterceptionTarget[];
  exportedAt: number;
}

export async function sha256Hex(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unavailable (insecure context)';
  }
}

export function buildCaseJSON(b: ExportBundle): string {
  const { c, method, taint, risk, links, targets, exportedAt } = b;
  return JSON.stringify(
    {
      schema: 'ccib.evidence-case/v1',
      exportedAt: new Date(exportedAt).toISOString(),
      exportedBy: `${c.officer.rank} ${c.officer.name} · ${c.officer.unitShort}`,
      taintMethod: { key: method, label: METHOD_LABEL[method] },
      case: {
        id: c.id, primaryKey: c.primaryKey, title: c.title, titleEn: c.titleEn, typology: c.typology, synthesized: !!c.synthesized,
        lossAmountTHB: c.lossAmount, reportNo: c.reportNo, openedAt: c.openedAt, victimProfile: c.victimProfile,
        modusOperandi: c.modusOperandi, summary: c.summary, fx: { usdtThb: c.usdtThbRate, btcThb: c.btcThbRate },
      },
      risk,
      interceptionTargets: targets,
      fundDisposition: taint.totals,
      entities: c.entities.map((e) => ({ ...e, taint: taint.nodes[e.id] })),
      transactions: c.edges.map((e) => ({ ...e, taint: taint.edges[e.id] })),
      geoEvents: c.geoEvents,
      timeline: [...c.timeline].sort((a, b2) => Date.parse(a.timestamp) - Date.parse(b2.timestamp)),
      crossCaseLinks: links,
    },
    null,
    2,
  );
}

export function buildCaseMarkdown(b: ExportBundle, jsonHash?: string): string {
  const { c, method, taint, risk, links, targets, exportedAt } = b;
  const ent = (id: string) => c.entities.find((e) => e.id === id);
  const L: string[] = [];
  L.push(`# รายงานหลักฐานคดี ${c.id}`);
  L.push(`**${c.title}** — _${c.titleEn}_${c.synthesized ? ' · ⚠️ คดีสังเคราะห์ (Dynamic Case Synthesis)' : ''}`);
  L.push('');
  L.push('| รายการ | ข้อมูล |', '|---|---|');
  L.push(`| ความเสียหาย | ${fmtMoney(c.lossAmount, 'THB')} |`);
  L.push(`| Risk Score | **${risk.score} / 100 (${risk.label})** |`);
  L.push(`| วิธีคำนวณ Taint | ${METHOD_LABEL[method]} |`);
  L.push(`| เลขรับแจ้ง | ${c.reportNo} |`);
  L.push(`| ผู้เสียหาย | ${c.victimProfile.name} · ${c.victimProfile.age} ปี · ${c.victimProfile.province} |`);
  L.push(`| ช่องทางหลอกลวง | ${c.victimProfile.channel} |`);
  L.push(`| พนักงานสอบสวน | ${c.officer.rank} ${c.officer.name} · ${c.officer.unitShort} |`);
  L.push(`| ส่งออกเมื่อ | ${fmtDateTime(exportedAt)} ICT |`);
  L.push('', `> ${c.summary}`, '');
  L.push('## การกระจายเงินของผู้เสียหาย (Fund Disposition)');
  L.push('| ปลายทาง | มูลค่า (THB) | สัดส่วน |', '|---|---:|---:|');
  for (const d of taint.totals.disposition) L.push(`| ${d.label} | ${fmtMoney(d.thb, 'THB', { decimals: 2 })} | ${fmtPct(d.pct)} |`);
  L.push('');
  L.push('## ลำดับความสำคัญการสกัดกั้น (Interception Priority)');
  L.push('| # | เป้าหมาย | Chokepoint | Priority | คงค้างปนเปื้อน | เหตุผล |', '|---|---|---|---:|---:|---|');
  targets.forEach((t, i) => {
    const e = ent(t.entityId);
    L.push(`| ${i + 1} | ${e?.institution} \`${e?.identifier}\` | ${t.chokepoint} | ${t.priority} | ${fmtMoney(t.remainingTainted, t.currency)} | ${t.reason} |`);
  });
  L.push('');
  L.push('## เอนทิตีและการคำนวณเงินปนเปื้อน');
  for (const e of c.entities) {
    const n = taint.nodes[e.id];
    L.push(`### ${e.role} — ${e.label}`);
    L.push(`- Identifier: \`${e.identifier}\` · ${e.institution}${e.chain ? ` · ${e.chain}` : ''}${e.holderName ? ` · ${e.holderName}` : ''}`);
    if (e.ip) L.push(`- IP / ASN: \`${e.ip}\` · ${e.asn ?? ''} ${e.isp ?? ''}`);
    if (e.device) L.push(`- Device: ${e.device}${e.fingerprints?.length ? ` · ${e.fingerprints.join(', ')}` : ''}`);
    if (n) {
      L.push(`- Victim In: ${fmtMoney(n.victimIn, n.currency)} · Other In: ${fmtMoney(n.otherIn, n.currency)} · Out: ${fmtMoney(n.outflow, n.currency)} · Remaining Tainted: **${fmtMoney(n.remainingTainted, n.currency)}**${n.currency !== 'THB' ? ` (≈ ${fmtMoney(toTHB(n.remainingTainted, n.currency, c), 'THB')})` : ''}`);
      L.push(`- Math: \`${n.explanation}\``);
    }
    L.push('');
  }
  L.push('## ธุรกรรม (Transactions)');
  L.push('| เวลา (ICT) | จาก → ถึง | จำนวน | ปนเปื้อน | ช่องทาง | อ้างอิง / TxID |', '|---|---|---:|---:|---|---|');
  for (const e of [...c.edges].sort((a, b2) => Date.parse(a.timestamp) - Date.parse(b2.timestamp))) {
    const et = taint.edges[e.id];
    L.push(`| ${fmtDateTime(e.timestamp)} | ${ent(e.source)?.identifier} → ${ent(e.target)?.identifier} | ${fmtMoney(e.amount, e.currency)}${e.receivedAmount ? ` → ${fmtMoney(e.receivedAmount, e.receivedCurrency ?? e.currency)}` : ''} | ${et ? `${fmtMoney(et.tainted, et.currency)} (${fmtPct(et.taintPct)})` : '—'} | ${e.channel} | \`${e.txRef}\` |`);
  }
  L.push('');
  L.push('## พิกัดและเส้นทางเคลื่อนที่ (Geo Telemetry)');
  L.push('| เวลา (ICT) | ประเภท | สถานที่ | GPS | รายละเอียด |', '|---|---|---|---|---|');
  for (const g of [...c.geoEvents].sort((a, b2) => Date.parse(a.timestamp) - Date.parse(b2.timestamp)))
    L.push(`| ${fmtDateTime(g.timestamp)} | ${g.type} | ${g.locationName} | \`${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}\` | ${[g.terminalId, g.ip, g.asn, g.cellId, g.searchRadiusM ? `radius ${g.searchRadiusM} m` : ''].filter(Boolean).join(' · ')} |`);
  L.push('');
  L.push('## ความเสี่ยง (Risk Factors)');
  L.push('| ปัจจัย | คะแนน | รายละเอียด |', '|---|---:|---|');
  for (const f of risk.factors) L.push(`| ${f.label} (${f.labelEn}) | ${f.points > 0 ? '+' : ''}${f.points} / ${f.max} | ${f.detail} |`);
  L.push('');
  L.push('## การเชื่อมโยงข้ามคดี (Cross-Case Links)');
  if (!links.length) L.push('_ไม่พบโหนดร่วม_');
  for (const l of links)
    L.push(`- **${l.remoteCaseId}** (${l.strength}) — ${ent(l.localEntityId)?.identifier} ↔ ${l.remoteIdentifier}: ${l.evidence.map((x) => `${x.label} \`${x.value}\``).join(', ')}`);
  L.push('');
  L.push('---');
  L.push(`Evidence integrity: SHA-256 (JSON export) \`${jsonHash ?? 'n/a'}\``);
  L.push('_สร้างโดย CCIB Cyber-Financial & Geo-Interception Command Center — ข้อมูลประกอบการสอบสวน ต้องยืนยันกับหน่วยงานต้นทางก่อนใช้เป็นพยานหลักฐาน_');
  return L.join('\n');
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
