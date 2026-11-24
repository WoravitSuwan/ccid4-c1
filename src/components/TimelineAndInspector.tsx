import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Bitcoin,
  Cctv,
  Check,
  ChevronRight,
  ClipboardCopy,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  FingerprintPattern,
  Gauge,
  Globe,
  History,
  Link2,
  LoaderCircle,
  LogIn,
  MapPin,
  Network,
  Radio,
  ScanSearch,
  Signal,
  Snowflake,
  Target,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type {
  CaseTaintResult,
  CrossCaseLink,
  DocumentType,
  FlowEdge,
  FlowEntity,
  InterceptionTarget,
  InvestigationCase,
  LiveChainResult,
  NodeTaint,
  RiskAssessment,
  Selection,
  TaintMethod,
  TimelineEvent,
  TimelineKind,
} from '../types/investigation';
import {
  BANK_FULL_NAME,
  METHOD_LABEL,
  fmtAgo,
  fmtCoord,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtTime,
  shortId,
} from '../utils/format';
import { GEO_TYPE_LABEL } from '../utils/geo';
import { satsToBtc, toTHB } from '../utils/taintEngine';
import { buildForensicSummary } from '../utils/documents';
import { copyText } from '../utils/browser';
import { CHOKEPOINT_META, CopyButton, ENTITY_META, RISK_COLOR, SEVERITY_COLOR, STATUS_META, Tag, cx } from './ui';

// ═════════════════════════ Timeline strip ═════════════════════════

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  transfer: ArrowRightLeft,
  login: LogIn,
  withdrawal: Banknote,
  swap: ArrowRightLeft,
  deposit: ArrowDownLeft,
  ping: Signal,
  alert: TriangleAlert,
};

interface TimelineProps {
  c: InvestigationCase;
  events: TimelineEvent[];
  revealedCount: number;
  inPlayback: boolean;
  isPlaying: boolean;
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  onJumpLive: () => void;
  now: number;
}

export function TimelineStrip({ c, events, revealedCount, inPlayback, isPlaying, selectedEventId, onSelectEvent, onJumpLive, now }: TimelineProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const total = events.length;
  const first = events[0] ? Date.parse(events[0].timestamp) : now;
  const last = events.at(-1) ? Date.parse(events.at(-1)!.timestamp) : now;
  const entity = (id: string) => c.entities.find((e) => e.id === id);

  useEffect(() => {
    if (!selectedEventId) return;
    refs.current.get(selectedEventId)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedEventId]);
  const lastId = events.at(-1)?.id;
  useEffect(() => {
    if (!inPlayback && scroller.current && events.at(-1)?.isLive) scroller.current.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' });
  }, [lastId, inPlayback, events]);

  return (
    <footer className="shrink-0 border-t border-ops-line bg-ops-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2">
        <History className="size-4 text-cyan-300" />
        <span className="whitespace-nowrap text-[13px] font-semibold text-slate-50">ไทม์ไลน์เหตุการณ์</span>
        <span className="num hidden whitespace-nowrap text-[11px] text-slate-300 sm:inline">{total} เหตุการณ์</span>
        {inPlayback ? (
          <Tag color="#22d3ee">
            {isPlaying ? '▶ PLAYBACK' : '❚❚ PAUSED'} {revealedCount}/{total}
          </Tag>
        ) : (
          <Tag color="#f87171">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" /> LIVE · ALL EVENTS
          </Tag>
        )}
        <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-ops-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={revealedCount}>
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 transition-[width] duration-500" style={{ width: `${total ? (revealedCount / total) * 100 : 0}%` }} />
        </div>
        <span className="num whitespace-nowrap text-[11px] text-slate-300">
          {fmtTime(first)} → {fmtTime(last)} · {fmtDuration(last - first)}
        </span>
        {inPlayback && (
          <button type="button" onClick={onJumpLive} className="num whitespace-nowrap rounded-md border border-red-400/70 bg-red-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-red-100 hover:bg-red-500/25">
            ● กลับสู่สด (LIVE)
          </button>
        )}
      </div>
      <div ref={scroller} className="thin-scroll flex items-stretch gap-2 overflow-x-auto px-3 pt-2 pb-2.5">
        {events.map((ev, i) => {
          const Icon = KIND_ICON[ev.kind];
          const revealed = i < revealedCount;
          const current = inPlayback && i === revealedCount - 1;
          const selected = ev.id === selectedEventId;
          const prev = events[i - 1];
          const delta = prev ? Date.parse(ev.timestamp) - Date.parse(prev.timestamp) : null;
          const ent = entity(ev.entityId);
          const sevColor = SEVERITY_COLOR[ev.severity];
          const ident = ent ? (ent.identifier.length > 16 ? shortId(ent.identifier, 6, 4) : ent.identifier) : '';
          return (
            <button
              key={ev.id}
              ref={(el) => {
                if (el) refs.current.set(ev.id, el);
                else refs.current.delete(ev.id);
              }}
              type="button"
              onClick={() => onSelectEvent(ev.id)}
              title={`${ev.title}\n${ev.detail}`}
              className={cx(
                'relative flex w-[235px] min-w-[235px] shrink-0 flex-col rounded-lg border px-3 py-2 text-left transition',
                selected ? 'border-cyan-400 bg-slate-800/95 ring-2 ring-cyan-400' : 'border-ops-line2 bg-ops-card hover:border-slate-500 hover:bg-ops-raised',
                !revealed && 'opacity-35',
                ev.isLive && !selected && 'bg-red-500/[0.08] animate-live-pop',
              )}
              style={{ boxShadow: `inset 3px 0 0 ${sevColor}` }}
              aria-pressed={selected}
              aria-current={current ? 'step' : undefined}
            >
              <div className="flex items-center gap-1.5">
                <Icon className="size-4 shrink-0" style={{ color: ent ? ENTITY_META[ent.type].color : sevColor }} />
                <span className="num whitespace-nowrap text-[12px] font-semibold text-slate-50">{fmtTime(ev.timestamp)}</span>
                {ev.isLive && <Tag color="#ef4444" solid>LIVE</Tag>}
                {current && <Tag color="#22d3ee" solid>NOW</Tag>}
                <span className="num ml-auto whitespace-nowrap text-[10.5px] text-slate-300">{delta !== null ? `+${fmtDuration(delta)}` : 'T0'}</span>
              </div>
              <div className="mt-1 text-[12px] font-medium leading-snug text-slate-100">{ev.title}</div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                <span className="num whitespace-nowrap text-[12px] font-bold text-slate-50">
                  {ev.amount !== undefined && ev.currency ? fmtMoney(ev.amount, ev.currency) : ev.geoEventId ? '◎ GEO FIX' : '—'}
                </span>
                <span className="num whitespace-nowrap text-[10.5px] text-slate-300">{ident}</span>
              </div>
            </button>
          );
        })}
      </div>
    </footer>
  );
}

// ═════════════════════════ Inspector ═════════════════════════

export type InspectorTab = 'entity' | 'network' | 'chain';

export interface ChainState {
  status: 'idle' | 'loading' | 'done';
  query: string;
  result: LiveChainResult | null;
}

interface InspectorProps {
  c: InvestigationCase;
  taint: CaseTaintResult;
  taintAlt: CaseTaintResult;
  method: TaintMethod;
  selection: Selection;
  risk: RiskAssessment;
  links: CrossCaseLink[];
  targets: InterceptionTarget[];
  now: number;
  tab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  onSelectEntity: (id: string) => void;
  onSelectGeo: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onOpenDoc: (type: DocumentType, entityId: string) => void;
  onOpenCase: (caseId: string, entityId?: string) => void;
  chain: ChainState;
  onChainLookup: (q: string) => void;
}

function Section({ title, icon: Icon, children, right }: { title: string; icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-ops-line2 bg-ops-card">
      <div className="flex items-center gap-2 border-b border-ops-line2 px-3 py-2">
        <Icon className="size-4 text-cyan-300" />
        <h3 className="text-[12.5px] font-semibold text-slate-50">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

function KV({ k, v, mono = true, accent }: { k: string; v: ReactNode; mono?: boolean; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-2 last:border-0">
      <span className="shrink-0 text-[11.5px] text-slate-300">{k}</span>
      <span className={cx('min-w-0 text-right text-[12px] text-slate-100 [overflow-wrap:anywhere]', mono && 'num')} style={accent ? { color: accent } : undefined}>
        {v}
      </span>
    </div>
  );
}

function explorerUrl(value: string, kind: 'tx' | 'address', chain?: string): string | null {
  if (/^0x[0-9a-f]{64}$/i.test(value)) return `https://etherscan.io/tx/${value}`;
  if (/^0x[0-9a-f]{40}$/i.test(value)) return `https://etherscan.io/address/${value}`;
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return `https://tronscan.org/#/address/${value}`;
  if (/^[0-9a-f]{64}$/i.test(value)) return chain === 'BTC' ? `https://mempool.space/tx/${value}` : `https://tronscan.org/#/transaction/${value}`;
  if (/^(bc1|[13])/.test(value) && kind === 'address') return `https://mempool.space/address/${value}`;
  return null;
}

function TaintBreakdown({ e, t, alt, method, c }: { e: FlowEntity; t: NodeTaint; alt: NodeTaint | undefined; method: TaintMethod; c: InvestigationCase }) {
  const m = (v: number) => fmtMoney(v, t.currency);
  const thb = (v: number) => (t.currency !== 'THB' ? fmtMoney(toTHB(v, t.currency, c), 'THB', { decimals: 0 }) : null);
  const v = t.totalIn > 0 ? t.victimIn / t.totalIn : 0;
  const vOut = t.victimIn > 0 ? Math.min(1, t.taintedOut / t.victimIn) : 0;
  const oOut = t.otherIn > 0 ? Math.min(1, t.cleanOut / t.otherIn) : 0;
  const rows: [string, string, number, string?][] = t.isOrigin
    ? [['เงินผู้เสียหายที่โอนออก', 'Victim Out', t.victimIn]]
    : e.type === 'cash_out'
      ? [
          ['ถอนเงินสดรวม', 'Total Withdrawn', t.totalIn],
          ['ส่วนเงินผู้เสียหาย', 'Tainted Cash', t.victimIn, '#7dd3fc'],
          ['ส่วนเงินอื่น', 'Other Cash', t.otherIn],
        ]
      : [
          ['เงินผู้เสียหายเข้า', 'Victim In', t.victimIn, '#7dd3fc'],
          ['เงินอื่น (ปะปน)', 'Other In', t.otherIn],
          ['ยอดรวมในบัญชี', 'Total Pool', t.totalIn],
          ['โอนออกทั้งหมด', 'Outflow', t.outflow],
          ['ส่วนปนเปื้อนที่โอนออก', 'Tainted Out', t.taintedOut, '#7dd3fc'],
          ['คงเหลือปนเปื้อน', 'Remaining Tainted', t.remainingTainted, '#bae6fd'],
          ['คงเหลือเงินอื่น', 'Remaining Clean', t.remainingClean],
          ['คงเหลือรวม', 'Remaining Total', t.remainingTotal],
        ];

  return (
    <div key={method} className="animate-flash space-y-2 rounded-md">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag color="#e879f9">{METHOD_LABEL[method]}</Tag>
        {!t.isOrigin && e.type !== 'cash_out' && (
          <Tag color="#94a3b8">{t.fifoVictimFirst ? 'FIFO ORDER: VICTIM FIRST' : 'FIFO ORDER: OTHER FIRST'}</Tag>
        )}
        <span className="num ml-auto text-[10.5px] text-sky-300">POOL TAINT {fmtPct(t.poolTaintPct)}</span>
      </div>

      <div className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/[0.06] px-2 py-1.5">
        <div className="num mb-0.5 text-[10.5px] tracking-wider text-fuchsia-300/80">MATH · การคำนวณ</div>
        <p className="num text-[11px] leading-relaxed text-slate-100">{t.explanation}</p>
      </div>

      {!t.isOrigin && t.totalIn > 0 && (
        <div>
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="สัดส่วนเงินผู้เสียหายเทียบเงินอื่นในบัญชี">
            {v > 0 && (
              <div className="flex h-full" style={{ width: `${v * 100}%` }}>
                <div style={{ width: `${(1 - vOut) * 100}%`, background: '#38bdf8' }} />
                <div style={{ width: `${vOut * 100}%`, background: 'repeating-linear-gradient(135deg,#38bdf8 0 3px,#38bdf855 3px 6px)' }} />
              </div>
            )}
            {v < 1 && (
              <div className="flex h-full flex-1">
                <div style={{ width: `${(1 - oOut) * 100}%`, background: '#64748b' }} />
                <div style={{ width: `${oOut * 100}%`, background: 'repeating-linear-gradient(135deg,#64748b 0 3px,#64748b55 3px 6px)' }} />
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-sky-400" />เงินผู้เสียหาย (คงค้าง)</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg,#38bdf8 0 2px,#38bdf855 2px 4px)' }} />ปนเปื้อนที่โอนออกแล้ว</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-slate-500" />เงินอื่น</span>
          </div>
        </div>
      )}

      <div className="divide-y divide-ops-line rounded-md border border-ops-line">
        {rows.map(([th, en, val, accent]) => (
          <div key={en} className="flex items-baseline justify-between gap-2 px-2.5 py-2">
            <span className="text-[11.5px] text-slate-300">
              {th} <span className="num text-[10px] text-slate-400">{en}</span>
            </span>
            <span className="text-right">
              <span className="num text-[11.5px] font-semibold" style={{ color: accent ?? '#e2e8f0' }}>{m(val)}</span>
              {thb(val) && <span className="num block text-[10.5px] text-slate-400">≈ {thb(val)}</span>}
            </span>
          </div>
        ))}
        {!t.isOrigin && e.type !== 'cash_out' && t.outflow > 0 && (
          <div className="flex items-baseline justify-between px-2 py-1">
            <span className="text-[10.5px] text-slate-400">Taint % ของยอดโอนออก</span>
            <span className="num text-[11.5px] font-semibold text-sky-200">{fmtPct(t.taintPctOut)}</span>
          </div>
        )}
      </div>

      {e.pool?.externalOther && (
        <p className="text-[10.5px] leading-relaxed text-slate-400">
          <span className="text-slate-400">แหล่งเงินอื่น:</span> {e.pool.externalOther.source} ({m(e.pool.externalOther.amount)}
          {e.pool.externalOther.at ? ` · ${fmtTime(e.pool.externalOther.at)}` : ' · ก่อนเกิดเหตุ'})
          {e.pool.note && <span className="block">{e.pool.note}</span>}
        </p>
      )}

      {alt && !t.isOrigin && e.type !== 'cash_out' && t.outflow > 0 && (
        <div className="overflow-hidden rounded-md border border-ops-line">
          <div className="num grid grid-cols-[1fr_auto_auto] gap-x-3 bg-ops-bg/70 px-2 py-1 text-[10.5px] tracking-wide text-slate-400">
            <span>เปรียบเทียบวิธี</span>
            <span className="text-right">TAINTED OUT</span>
            <span className="text-right">REMAINING</span>
          </div>
          {(
            [
              ['proportional', method === 'proportional' ? t : alt],
              ['fifo', method === 'fifo' ? t : alt],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className={cx('num grid grid-cols-[1fr_auto_auto] gap-x-3 px-2 py-1 text-[10.5px]', k === method ? 'bg-fuchsia-500/10 text-slate-100' : 'text-slate-400')}>
              <span>{k === 'fifo' ? 'FIFO' : 'Proportional'}{k === method && ' ◀'}</span>
              <span className="text-right">{fmtMoney(n.taintedOut, t.currency)}</span>
              <span className="text-right">{fmtMoney(n.remainingTainted, t.currency)}</span>
            </div>
          ))}
          <div className="num px-2 py-1 text-[10.5px] text-slate-400">
            ส่วนต่างยอดคงเหลือปนเปื้อน Δ {fmtMoney(Math.abs(t.remainingTainted - alt.remainingTainted), t.currency)}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeCard({ edge, c, taint, onSelectEntity }: { edge: FlowEdge; c: InvestigationCase; taint: CaseTaintResult; onSelectEntity: (id: string) => void }) {
  const et = taint.edges[edge.id];
  const src = c.entities.find((e) => e.id === edge.source);
  const dst = c.entities.find((e) => e.id === edge.target);
  const url = explorerUrl(edge.txRef, 'tx', src?.chain ?? dst?.chain);
  return (
    <Section title="ธุรกรรมที่เลือก" icon={ArrowRightLeft} right={edge.isLive ? <Tag color="#ef4444" solid>LIVE</Tag> : <Tag color="#94a3b8">{edge.rail.toUpperCase().replace('_', '-')}</Tag>}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <button type="button" onClick={() => src && onSelectEntity(src.id)} className="num truncate rounded border border-ops-line px-1.5 py-0.5 text-slate-200 hover:border-ops-line2" style={{ color: src ? ENTITY_META[src.type].color : undefined }}>
          {src ? shortId(src.identifier, 8, 4) : '?'}
        </button>
        <ChevronRight className="size-3.5 shrink-0 text-slate-400" />
        <button type="button" onClick={() => dst && onSelectEntity(dst.id)} className="num truncate rounded border border-ops-line px-1.5 py-0.5 text-slate-200 hover:border-ops-line2" style={{ color: dst ? ENTITY_META[dst.type].color : undefined }}>
          {dst ? shortId(dst.identifier, 8, 4) : '?'}
        </button>
      </div>
      <div className="mt-1.5">
        <KV k="จำนวน" v={fmtMoney(edge.amount, edge.currency)} />
        {edge.receivedAmount && edge.receivedCurrency && <KV k={`ได้รับ (@ ฿${edge.fxRate ?? '-'})`} v={fmtMoney(edge.receivedAmount, edge.receivedCurrency)} />}
        {et && <KV k="ส่วนปนเปื้อน" v={`${fmtMoney(et.tainted, et.currency)} · ${fmtPct(et.taintPct)}`} accent="#7dd3fc" />}
        <KV k="ช่องทาง" v={edge.channel} mono={false} />
        <KV k="เวลา" v={`${fmtDateTime(edge.timestamp)} ICT`} />
        {edge.txCount && <KV k="จำนวนรายการ" v={`${edge.txCount} รายการ`} />}
      </div>
      <div className="mt-1 flex items-center gap-1.5 rounded border border-ops-line bg-ops-bg px-1.5 py-1">
        <span className="num min-w-0 flex-1 truncate text-[10.5px] text-slate-300" title={edge.txRef}>{edge.txRef}</span>
        <CopyButton text={edge.txRef} title="คัดลอก TxID / เลขอ้างอิง" />
        {url && (
          <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center rounded-md border border-ops-line2 px-1.5 py-0.5 text-slate-300 hover:text-white" title="เปิดใน Block Explorer">
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </Section>
  );
}

function EntityTab(p: InspectorProps) {
  const { c, taint, taintAlt, method, selection, links, targets, now } = p;
  const e = selectedEntity(c, selection);
  const t = taint.nodes[e.id];
  const alt = taintAlt.nodes[e.id];
  const meta = ENTITY_META[e.type];
  const Icon = meta.icon;
  const geos = c.geoEvents.filter((g) => g.entityId === e.id).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const ins = c.edges.filter((x) => x.target === e.id);
  const outs = c.edges.filter((x) => x.source === e.id);
  const eLinks = links.filter((l) => l.localEntityId === e.id);
  const target = targets.find((x) => x.entityId === e.id);
  const edge = selection.edgeId ? c.edges.find((x) => x.id === selection.edgeId) : undefined;
  const summary = useMemo(() => buildForensicSummary({ c, entity: e, taint: t, method, geos, links: eLinks, now }), [c, e, t, method, geos, eLinks, now]);
  const addrUrl = explorerUrl(e.identifier, 'address', e.chain);

  return (
    <div className="space-y-2.5">
      {edge && <EdgeCard edge={edge} c={c} taint={taint} onSelectEntity={p.onSelectEntity} />}

      <section className="overflow-hidden rounded-lg border bg-ops-card" style={{ borderColor: `${meta.color}66`, boxShadow: `0 0 24px ${meta.color}1a` }}>
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${meta.color}, transparent)` }} />
        <div className="p-2.5">
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: `${meta.color}1f`, boxShadow: `inset 0 0 0 1px ${meta.color}66` }}>
              <Icon className="size-4.5" style={{ color: meta.color }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="num text-[10px] font-semibold tracking-wider" style={{ color: meta.color }}>{e.role}</span>
                <Tag color={STATUS_META[e.status].color}>{STATUS_META[e.status].th}</Tag>
                {e.isLive && <Tag color="#ef4444" solid>LIVE</Tag>}
              </div>
              <div className="mt-0.5 text-[12.5px] font-semibold text-slate-100">{e.label}</div>
              <div className="text-[10.5px] text-slate-400">{BANK_FULL_NAME[e.institution] ?? e.institution}{e.chain ? ` · ${e.chain} · ${e.currency}` : ''}</div>
            </div>
            {target && (
              <div className="text-right" title="Interception Priority">
                <div className="num text-[18px] font-bold leading-none text-orange-300">{target.priority}</div>
                <div className="num text-[10.5px] tracking-wider text-slate-400">PRIORITY</div>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-ops-line bg-ops-bg px-2 py-1.5">
            <span className="num min-w-0 flex-1 break-all text-[12px] font-semibold text-slate-50">{e.identifier}</span>
            <CopyButton text={e.identifier} title="คัดลอกเลขบัญชี / Address" />
            {addrUrl && (
              <a href={addrUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center rounded-md border border-ops-line2 px-1.5 py-0.5 text-slate-300 hover:text-white" title="เปิดใน Block Explorer">
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="mt-1.5">
            {e.holderName && <KV k="ชื่อบัญชี" v={e.holderName} mono={false} />}
            {e.accountOpened && <KV k="วันเปิดบัญชี" v={e.accountOpened} />}
            {e.terminalId && <KV k="ATM Terminal ID" v={e.terminalId} />}
            {e.locationName && <KV k="ที่ตั้ง" v={e.locationName} mono={false} />}
            {target && <KV k="Chokepoint" v={CHOKEPOINT_META[target.chokepoint].label} accent={CHOKEPOINT_META[target.chokepoint].color} />}
          </div>
          {e.notes && <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">{e.notes}</p>}
          {!!e.tags?.length && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {e.tags.map((x) => <Tag key={x} color="#94a3b8">{x}</Tag>)}
            </div>
          )}
          {target && <p className="mt-1.5 rounded-md bg-orange-500/10 px-2 py-1 text-[10.5px] text-orange-200">{target.reason}</p>}
        </div>
      </section>

      {t && (
        <Section title="Taint & เงินปะปน (Mixed-Fund Engine)" icon={Gauge}>
          <TaintBreakdown e={e} t={t} alt={alt} method={method} c={c} />
        </Section>
      )}

      {(e.ip || e.device || geos.length > 0) && (
        <Section title="Telemetry · IP / อุปกรณ์ / พิกัด" icon={Globe}>
          {e.ip && <KV k="IP Address" v={<span className="flex items-center justify-end gap-1">{e.ip} <CopyButton text={e.ip} /></span>} />}
          {e.asn && <KV k="ASN / ISP" v={`${e.asn} · ${e.isp ?? ''}`} />}
          {e.device && <KV k="อุปกรณ์" v={e.device} />}
          {!!e.fingerprints?.length && (
            <div className="flex items-center justify-between py-[3px]">
              <span className="flex items-center gap-1 text-[10.5px] text-slate-400"><FingerprintPattern className="size-3" /> Fingerprint</span>
              <span className="flex flex-wrap justify-end gap-1">{e.fingerprints.map((f) => <Tag key={f} color="#e879f9">{f}</Tag>)}</span>
            </div>
          )}
          {geos.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {geos.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => p.onSelectGeo(g.id)} className={cx('flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition', selection.geoId === g.id ? 'border-sky-400/60 bg-sky-400/10' : 'border-ops-line hover:border-ops-line2')}>
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                    <span className="min-w-0 flex-1">
                      <span className="num block text-[10px] tracking-wide text-slate-400">{GEO_TYPE_LABEL[g.type].en} · {fmtTime(g.timestamp)}</span>
                      <span className="block truncate text-[11px] text-slate-200">{g.locationName}</span>
                      <span className="num block text-[10px] text-slate-400">{fmtCoord(g.lat, g.lng)}{g.terminalId ? ` · ${g.terminalId}` : ''}{g.ip ? ` · ${g.ip}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {(ins.length > 0 || outs.length > 0) && (
        <Section title="ธุรกรรมเข้า-ออก" icon={ArrowRightLeft} right={<span className="num text-[10px] text-slate-400">IN {ins.length} · OUT {outs.length}</span>}>
          <ul className="space-y-1">
            {[...ins.map((x) => ['in', x] as const), ...outs.map((x) => ['out', x] as const)]
              .sort((a, b) => Date.parse(a[1].timestamp) - Date.parse(b[1].timestamp))
              .map(([dir, x]) => {
                const other = c.entities.find((y) => y.id === (dir === 'in' ? x.source : x.target));
                const et = taint.edges[x.id];
                return (
                  <li key={x.id}>
                    <button type="button" onClick={() => p.onSelectEdge(x.id)} className={cx('flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition', selection.edgeId === x.id ? 'border-sky-400/60 bg-sky-400/10' : 'border-ops-line hover:border-ops-line2')}>
                      {dir === 'in' ? <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-400" /> : <ArrowUpRight className="size-3.5 shrink-0 text-orange-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="num block truncate text-[11px] text-slate-200">{other ? shortId(other.identifier, 9, 5) : '?'}</span>
                        <span className="num block text-[10.5px] text-slate-400">{fmtTime(x.timestamp)} · {x.channel}</span>
                      </span>
                      <span className="text-right">
                        <span className="num block text-[11px] font-semibold text-slate-100">{fmtMoney(dir === 'in' && x.receivedAmount ? x.receivedAmount : x.amount, dir === 'in' && x.receivedCurrency ? x.receivedCurrency : x.currency)}</span>
                        {et && <span className="num block text-[10.5px] text-sky-300">TAINT {fmtPct(et.taintPct, 1)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </Section>
      )}

      {eLinks.length > 0 && (
        <Section title="เชื่อมโยงข้ามคดี (Common Node)" icon={Link2} right={<Tag color="#e879f9">{eLinks.length} LINK</Tag>}>
          <ul className="space-y-1.5">
            {eLinks.map((l) => <LinkRow key={l.key} l={l} onOpenCase={p.onOpenCase} />)}
          </ul>
        </Section>
      )}

      <Section title="สรุปหลักฐานนิติวิทยาศาสตร์ (คัดลอกได้)" icon={ClipboardCopy} right={<CopyButton text={summary} label="คัดลอก" />}>
        <pre className="num thin-scroll max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10.5px] leading-relaxed text-slate-300">{summary}</pre>
      </Section>
    </div>
  );
}

function LinkRow({ l, onOpenCase, showLocal, c }: { l: CrossCaseLink; onOpenCase: (caseId: string, entityId?: string) => void; showLocal?: boolean; c?: InvestigationCase }) {
  const color = l.strength === 'strong' ? '#e879f9' : l.strength === 'medium' ? '#f59e0b' : '#64748b';
  const local = showLocal && c ? c.entities.find((e) => e.id === l.localEntityId) : undefined;
  return (
    <li className="rounded-md border border-ops-line bg-ops-bg/50 p-2">
      <div className="flex items-center gap-1.5">
        <Tag color={color}>{l.strength.toUpperCase()}</Tag>
        <span className="num text-[11px] font-semibold text-slate-100">{l.remoteCaseId}</span>
        <button type="button" onClick={() => onOpenCase(l.remoteCaseId, l.remoteEntityId)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-ops-line px-1.5 py-0.5 text-[10.5px] text-slate-300 hover:border-ops-line2 hover:text-white">
          เปิดคดี <ChevronRight className="size-3" />
        </button>
      </div>
      <div className="mt-0.5 truncate text-[10.5px] text-slate-400">{l.remoteCaseTitle}</div>
      <div className="num mt-0.5 truncate text-[10.5px] text-slate-300">
        {local && <span className="text-slate-400">{shortId(local.identifier, 8, 4)} ↔ </span>}
        {l.remoteEntityLabel} · {shortId(l.remoteIdentifier, 10, 5)}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {l.evidence.map((ev) => (
          <Tag key={`${ev.type}-${ev.value}`} color="#94a3b8">
            {ev.label}: {shortId(ev.value, 12, 4)}
          </Tag>
        ))}
      </div>
    </li>
  );
}

function RiskGauge({ risk }: { risk: RiskAssessment }) {
  const color = RISK_COLOR[risk.level];
  const r = 46;
  const len = Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 112 64" className="h-[70px] w-[124px] shrink-0" role="img" aria-label={`Risk score ${risk.score} of 100`}>
        <path d="M 10 58 A 46 46 0 0 1 102 58" fill="none" stroke="#1e293b" strokeWidth="9" strokeLinecap="round" />
        <path d="M 10 58 A 46 46 0 0 1 102 58" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(risk.score / 100) * len} ${len}`} style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray .8s' }} />
        <text x="56" y="50" textAnchor="middle" className="num" fontSize="22" fontWeight="700" fill="#f8fafc">{risk.score}</text>
        <text x="56" y="61" textAnchor="middle" className="num" fontSize="7" fill="#64748b">/ 100</text>
      </svg>
      <div className="min-w-0">
        <div className="num text-[13px] font-bold" style={{ color }}>{risk.label}</div>
        <div className="text-[10.5px] leading-relaxed text-slate-400">Interception Priority / Risk Score — คะแนนรวมแบบโปร่งใสจาก {risk.factors.length} ปัจจัย อธิบายได้ในชั้นศาล</div>
      </div>
    </div>
  );
}

function NetworkTab(p: InspectorProps) {
  const { c, risk, links, targets } = p;
  const byCase = useMemo(() => {
    const m = new Map<string, CrossCaseLink[]>();
    for (const l of links) m.set(l.remoteCaseId, [...(m.get(l.remoteCaseId) ?? []), l]);
    return [...m.entries()];
  }, [links]);
  return (
    <div className="space-y-2.5">
      <Section title="คะแนนความเสี่ยง & ลำดับความสำคัญ" icon={Gauge}>
        <RiskGauge risk={risk} />
        <ul className="mt-2 space-y-1.5">
          {risk.factors.map((f) => (
            <li key={f.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[10.5px] text-slate-300">
                  {f.label} <span className="num text-[10px] text-slate-400">{f.labelEn}</span>
                </span>
                <span className="num shrink-0 text-[10.5px] font-semibold text-slate-100">
                  {f.points > 0 ? '+' : ''}{f.points}<span className="text-slate-400">/{f.max}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-ops-line">
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, f.points / f.max) * 100}%`, background: f.key === 'analyst' ? '#e879f9' : f.key === 'live' ? '#ef4444' : '#94a3b8' }} />
              </div>
              <div className="truncate text-[10.5px] text-slate-400" title={f.detail}>{f.detail}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="จุดสกัดกั้น (Chokepoints) — เรียงตามความสำคัญ" icon={Target} right={<span className="num text-[10px] text-slate-400">{targets.length} TARGETS</span>}>
        <ol className="space-y-1.5">
          {targets.map((t, i) => {
            const e = c.entities.find((x) => x.id === t.entityId)!;
            const cm = CHOKEPOINT_META[t.chokepoint];
            return (
              <li key={t.entityId} className="rounded-md border border-ops-line bg-ops-bg/50 p-2">
                <div className="flex items-center gap-2">
                  <span className="num grid size-5 shrink-0 place-items-center rounded bg-ops-line text-[10px] font-bold text-slate-200">{i + 1}</span>
                  <button type="button" onClick={() => p.onSelectEntity(e.id)} className="num min-w-0 flex-1 truncate text-left text-[11.5px] font-semibold text-slate-100 hover:underline">
                    {shortId(e.identifier, 10, 5)}
                  </button>
                  <Tag color={cm.color}>{cm.label}</Tag>
                  <span className="num text-[13px] font-bold text-orange-300">{t.priority}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-ops-line">
                  <div className="h-full rounded-full bg-orange-400/80" style={{ width: `${t.priority}%` }} />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[10px] leading-snug text-slate-400">{t.reason}</span>
                  <button type="button" onClick={() => p.onOpenDoc(t.action, e.id)} className="shrink-0 rounded-md border border-ops-line2 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-ops-raised">
                    {t.action === 'atm_cctv_request' ? 'ขอ CCTV' : t.action === 'kyc_ip_request' ? 'ขอ KYC' : 'ขออายัด'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="เครือข่ายข้ามคดี (Cross-Case Network)" icon={Network} right={<Tag color="#e879f9">{byCase.length} CASES</Tag>}>
        {byCase.length === 0 && <p className="text-[11px] text-slate-400">ไม่พบโหนดร่วมกับคดีอื่นในระบบ</p>}
        <div className="space-y-2">
          {byCase.map(([caseId, ls]) => (
            <div key={caseId}>
              <ul className="space-y-1.5">
                {ls.map((l) => <LinkRow key={l.key} l={l} onOpenCase={p.onOpenCase} showLocal c={c} />)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ข้อมูลคดี" icon={FileText}>
        <KV k="รหัสคดี" v={c.id} />
        <KV k="เลขรับแจ้ง" v={c.reportNo} />
        <KV k="ผู้เสียหาย" v={`${c.victimProfile.name} · ${c.victimProfile.age} ปี`} mono={false} />
        <KV k="พื้นที่" v={c.victimProfile.province} mono={false} />
        <KV k="ช่องทาง" v={c.victimProfile.channel} mono={false} />
        <KV k="พนักงานสอบสวน" v={`${c.officer.rank} ${c.officer.name} · ${c.officer.unitShort}`} mono={false} />
        <KV k="อัตราอ้างอิง" v={`฿${c.usdtThbRate}/USDT`} />
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-400">{c.modusOperandi}</p>
        <p className="mt-1 rounded-md bg-ops-bg px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-300">{c.summary}</p>
      </Section>
    </div>
  );
}

const BTC_SAMPLE_TX = 'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d';
const BTC_SAMPLE_ADDR = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

function ChainTab(p: InspectorProps) {
  const { chain, c } = p;
  const [q, setQ] = useState(chain.query);
  useEffect(() => setQ(chain.query), [chain.query]);
  const r = chain.result;
  const live = r?.live;
  const reasonTh: Record<string, string> = {
    NETWORK_ERROR: 'เครือข่ายขัดข้อง',
    CORS_OR_OFFLINE: 'ออฟไลน์ / ถูกบล็อก CORS',
    TIMEOUT: 'หมดเวลาเชื่อมต่อ',
    NOT_FOUND: 'ไม่พบบน Bitcoin mainnet (อาจเป็น TRON/EVM)',
    NOT_BTC: 'ไม่ใช่รูปแบบ Bitcoin (TRON/EVM ต้องใช้ Explorer)',
    HTTP_ERROR: 'ผู้ให้บริการตอบกลับผิดพลาด',
  };
  return (
    <div className="space-y-2.5">
      <Section title="ตรวจสอบบล็อกเชนสด (Live Blockchain Lookup)" icon={Bitcoin}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) p.onChainLookup(q.trim());
          }}
          className="flex gap-1.5"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC TxID (64 hex) หรือ BTC Address" spellCheck={false} className="num min-w-0 flex-1 rounded-md border border-ops-line2 bg-ops-bg px-2 py-1.5 text-[11px] text-slate-100 placeholder:font-sans placeholder:text-slate-400 focus:border-sky-400/70 focus:outline-none" />
          <button type="submit" disabled={chain.status === 'loading'} className="inline-flex items-center gap-1 rounded-md bg-amber-500/90 px-2.5 text-[11px] font-semibold text-ops-bg hover:bg-amber-400 disabled:opacity-50">
            {chain.status === 'loading' ? <LoaderCircle className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} ตรวจสอบสด
          </button>
        </form>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button type="button" onClick={() => p.onChainLookup(BTC_SAMPLE_TX)} className="num rounded border border-ops-line px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-100">ตัวอย่าง TxID (Pizza 2010)</button>
          <button type="button" onClick={() => p.onChainLookup(BTC_SAMPLE_ADDR)} className="num rounded border border-ops-line px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-100">ตัวอย่าง Address (Genesis)</button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
          ใช้ API สาธารณะ <span className="num">mempool.space</span> → <span className="num">blockstream.info</span> ไม่ต้องใช้ API Key · หากออฟไลน์/ถูกบล็อก CORS ระบบแสดงข้อมูลจำลองเชิงนิติวิทยาศาสตร์พร้อมระบุชัดเจน
        </p>
      </Section>

      {chain.status === 'loading' && (
        <div className="flex items-center gap-2 rounded-lg border border-ops-line bg-ops-card p-3 text-[11px] text-slate-300">
          <LoaderCircle className="size-4 animate-spin text-amber-400" /> กำลังสืบค้น <span className="num">{shortId(chain.query, 10, 6)}</span> …
        </div>
      )}

      {r && chain.status === 'done' && (
        <Section
          title={r.kind === 'tx' ? 'ผลตรวจสอบธุรกรรม (TX)' : 'ผลตรวจสอบ Address'}
          icon={Database}
          right={live ? <Tag color="#22c55e" solid><Radio className="size-2.5" /> LIVE · {r.source}</Tag> : <Tag color="#f59e0b">SIMULATED FALLBACK</Tag>}
        >
          {!live && r.reason && (
            <p className="mb-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10.5px] text-amber-200">
              <TriangleAlert className="mr-1 inline size-3" />{reasonTh[r.reason] ?? r.reason} — แสดงข้อมูลจำลอง (ห้ามใช้เป็นพยานหลักฐาน)
            </p>
          )}
          <div className="num mb-1.5 break-all rounded border border-ops-line bg-ops-bg px-1.5 py-1 text-[10.5px] text-slate-300">{r.query}</div>
          {r.tx && (
            <>
              <KV k="สถานะ" v={r.tx.confirmed ? `CONFIRMED · ${fmtNum(r.tx.confirmations ?? 0, 0)} conf.` : 'UNCONFIRMED (mempool)'} accent={r.tx.confirmed ? '#86efac' : '#fcd34d'} />
              {r.tx.blockHeight && <KV k="Block Height" v={fmtNum(r.tx.blockHeight, 0)} />}
              {r.tx.blockTime && <KV k="Block Time" v={`${fmtDateTime(r.tx.blockTime * 1000)} ICT`} />}
              <KV k="Inputs / Outputs" v={`${r.tx.inputs} → ${r.tx.outputs}`} />
              <KV k="Total Out" v={`${satsToBtc(r.tx.totalOutSats).toFixed(8)} BTC`} />
              <KV k="≈ THB (อ้างอิง)" v={fmtMoney(toTHB(satsToBtc(r.tx.totalOutSats), 'BTC', c), 'THB', { decimals: 0 })} />
              <KV k="Fee · vSize" v={`${fmtNum(r.tx.feeSats, 0)} sats · ${r.tx.vsize} vB`} />
              <div className="mt-1.5 text-[10px] text-slate-400">Top outputs</div>
              <ul className="mt-0.5 space-y-0.5">
                {r.tx.topOutputs.map((o, i) => (
                  <li key={i} className="num flex justify-between gap-2 text-[10.5px]">
                    <span className="truncate text-slate-300">{shortId(o.address, 10, 6)}</span>
                    <span className="shrink-0 text-slate-100">{satsToBtc(o.valueSats).toFixed(8)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.address && (
            <>
              <KV k="ยอดคงเหลือ" v={`${satsToBtc(r.address.balanceSats).toFixed(8)} BTC`} accent="#fcd34d" />
              <KV k="≈ THB (อ้างอิง)" v={fmtMoney(toTHB(satsToBtc(r.address.balanceSats), 'BTC', c), 'THB', { decimals: 0 })} />
              <KV k="รับเข้ารวม" v={`${satsToBtc(r.address.fundedSats).toFixed(8)} BTC`} />
              <KV k="ใช้ออกรวม" v={`${satsToBtc(r.address.spentSats).toFixed(8)} BTC`} />
              <KV k="จำนวนธุรกรรม" v={fmtNum(r.address.txCount, 0)} />
              <KV k="ใน Mempool" v={`${r.address.mempoolTxCount} tx`} />
            </>
          )}
          <div className="num mt-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
            <span><Clock3 className="mr-1 inline size-3" />{fmtTime(r.fetchedAt)}{r.latencyMs ? ` · ${r.latencyMs} ms` : ''}</span>
            {r.tipHeight && <span><Cpu className="mr-1 inline size-3" />tip {fmtNum(r.tipHeight, 0)}</span>}
          </div>
          {live && (
            <a href={`https://mempool.space/${r.kind}/${r.query}`} target="_blank" rel="noreferrer noopener" className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-sky-300 hover:underline">
              เปิดใน mempool.space <ExternalLink className="size-3" />
            </a>
          )}
        </Section>
      )}

      <Section title="กระเป๋าคริปโตในคดีนี้" icon={Wallet}>
        <ul className="space-y-1">
          {c.entities
            .filter((e) => e.type === 'crypto_wallet' || e.type === 'exchange')
            .map((e) => {
              const url = explorerUrl(e.identifier, 'address', e.chain);
              return (
                <li key={e.id} className="flex items-center gap-1.5 rounded-md border border-ops-line px-2 py-1">
                  <span className="size-1.5 rounded-full" style={{ background: ENTITY_META[e.type].color }} />
                  <button type="button" onClick={() => p.onSelectEntity(e.id)} className="num min-w-0 flex-1 truncate text-left text-[10.5px] text-slate-200 hover:underline">{shortId(e.identifier, 10, 6)}</button>
                  <Tag color="#94a3b8">{e.chain ?? e.currency}</Tag>
                  {e.chain === 'BTC' ? (
                    <button type="button" onClick={() => p.onChainLookup(e.identifier)} className="rounded border border-ops-line px-1 py-0.5 text-[10px] text-amber-300">LIVE</button>
                  ) : url ? (
                    <a href={url} target="_blank" rel="noreferrer noopener" className="text-slate-400 hover:text-slate-200" title="เปิดใน Explorer"><ExternalLink className="size-3" /></a>
                  ) : null}
                </li>
              );
            })}
        </ul>
        <p className="mt-1.5 text-[10px] text-slate-400">TRC-20 / ERC-20 เปิดตรวจสอบผ่าน Tronscan / Etherscan (ไม่ต้องใช้ API Key)</p>
      </Section>
    </div>
  );
}

const selectedEntity = (c: InvestigationCase, sel: Selection): FlowEntity =>
  c.entities.find((x) => x.id === sel.entityId) ?? c.entities.find((x) => x.id === c.primaryEntityId) ?? c.entities[0];

/** Prominent police actions for the selected entity — always visible at the bottom of the inspector. */
function ActionFooter(p: InspectorProps) {
  const { c, selection, taint, method, links, now } = p;
  const e = selectedEntity(c, selection);
  const [copied, setCopied] = useState(false);
  const byId = (id: string) => c.entities.find((x) => x.id === id);
  // Freeze / KYC target: the entity itself, or the account that fed a cash-out, or the first account the victim paid.
  const freezeTarget =
    e.type === 'cash_out'
      ? byId(c.edges.find((x) => x.target === e.id)?.source ?? '')
      : e.type === 'victim'
        ? byId(c.edges.find((x) => x.source === e.id)?.target ?? '')
        : e;
  const freezeType: DocumentType = freezeTarget?.type === 'exchange' ? 'kyc_ip_request' : 'freeze_request';
  // CCTV target: this ATM, an ATM this account paid into, or the most recent ATM in the case.
  const atms = c.entities.filter((x) => x.type === 'cash_out');
  const lastAtm = [...c.edges].filter((x) => atms.some((a) => a.id === x.target)).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const atm =
    e.type === 'cash_out'
      ? e
      : byId(c.edges.find((x) => x.source === e.id && byId(x.target)?.type === 'cash_out')?.target ?? '') ?? (lastAtm ? byId(lastAtm.target) : undefined);
  const geos = c.geoEvents.filter((g) => g.entityId === e.id).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const summary = buildForensicSummary({ c, entity: e, taint: taint.nodes[e.id], method, geos, links: links.filter((l) => l.localEntityId === e.id), now });
  const fmtTarget = (x?: FlowEntity) => (x ? `${x.institution} ${x.identifier.length > 18 ? shortId(x.identifier, 8, 5) : x.identifier}` : '—');

  return (
    <div className="shrink-0 border-t border-ops-line2 bg-ops-bar px-3 pt-2 pb-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-300">
        <span>
          อายัด/KYC: <span className="num font-semibold text-slate-50">{fmtTarget(freezeTarget)}</span>
        </span>
        <span>
          CCTV: <span className="num font-semibold text-slate-50">{atm ? atm.terminalId ?? atm.identifier : 'ไม่มีตู้ ATM ในคดี'}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!freezeTarget}
          onClick={() => freezeTarget && p.onOpenDoc(freezeType, freezeTarget.id)}
          title={freezeTarget ? `ออกบันทึกข้อความด่วนสำหรับ ${fmtTarget(freezeTarget)}` : 'ไม่มีบัญชีที่อายัดได้'}
          className="col-span-2 flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-fuchsia-600 px-3 text-[13px] font-bold text-white shadow-[0_0_18px_rgb(192_38_211/0.35)] transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Snowflake className="size-4" /> ออกคำร้องขออายัด / ขอ KYC
        </button>
        <button
          type="button"
          disabled={!atm}
          onClick={() => atm && p.onOpenDoc('atm_cctv_request', atm.id)}
          title={atm ? `ขอภาพ CCTV ตู้ ${atm.terminalId ?? atm.identifier}` : 'คดีนี้ยังไม่พบการถอนเงินสดที่ตู้ ATM'}
          className="flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-red-600 px-2 text-[12.5px] font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Cctv className="size-4" /> ขอภาพ CCTV ตู้ ATM
        </button>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(summary)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
          className={cx(
            'flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-bold transition',
            copied ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-900 hover:bg-white',
          )}
        >
          {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {copied ? 'คัดลอกแล้ว' : 'คัดลอกสรุปหลักฐาน'}
        </button>
      </div>
    </div>
  );
}

export function InspectorPanel(p: InspectorProps) {
  const tabs: [InspectorTab, string, LucideIcon, ReactNode?][] = [
    ['entity', 'ตรวจสอบเอนทิตี', ScanSearch],
    ['network', 'เครือข่าย/ความเสี่ยง', Network, p.links.length ? <span className="num rounded bg-fuchsia-500/20 px-1 text-[10.5px] text-fuchsia-200">{new Set(p.links.map((l) => l.remoteCaseId)).size}</span> : undefined],
    ['chain', 'บล็อกเชนสด', Bitcoin, p.chain.result?.live ? <span className="size-1.5 rounded-full bg-emerald-400" /> : undefined],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-ops-line bg-ops-bar px-1.5" role="tablist">
        {tabs.map(([k, label, Icon, badge]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={p.tab === k}
            onClick={() => p.onTabChange(k)}
            className={cx('flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[12px] transition', p.tab === k ? 'bg-ops-raised text-white shadow-[inset_0_0_0_1px_#22d3ee99]' : 'text-slate-300 hover:bg-white/5 hover:text-white')}
          >
            <Icon className="size-4 shrink-0" />
            <span>{label}</span>
            {badge}
          </button>
        ))}
      </div>
      <div className="num flex items-center gap-1.5 border-b border-ops-line px-3 py-1.5 text-[10.5px] tracking-wider text-slate-300">
        FORENSIC INSPECTOR · {p.c.id} · <span className="font-sans tracking-normal">รับแจ้ง {fmtAgo(p.c.openedAt, p.now)}</span>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {p.tab === 'entity' && <EntityTab {...p} />}
        {p.tab === 'network' && <NetworkTab {...p} />}
        {p.tab === 'chain' && <ChainTab {...p} />}
      </div>
      <ActionFooter {...p} />
    </div>
  );
}

