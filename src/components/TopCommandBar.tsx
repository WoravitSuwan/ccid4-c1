import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Banknote,
  Bell,
  ChevronDown,
  CornerDownLeft,
  FileBraces,
  FileText,
  Hash,
  Keyboard,
  Landmark,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Wallet,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { InputType, InvestigationCase, RiskAssessment, TaintMethod } from '../types/investigation';
import type { SearchSuggestion } from '../data/mockCases';
import { PRESET_META } from '../data/mockCases';
import { detectInput } from '../utils/inputDetect';
import { fmtMoney, fmtThaiDateShort, fmtTime, shortId } from '../utils/format';
import { IconButton, RISK_COLOR, Tag, cx } from './ui';

export type ChainStatus = 'standby' | 'checking' | 'online' | 'offline';

interface Props {
  activeCase: InvestigationCase;
  risk: RiskAssessment;
  cases: InvestigationCase[];
  caseRisks: Record<string, RiskAssessment>;
  method: TaintMethod;
  onMethodChange: (m: TaintMethod) => void;
  isPlaying: boolean;
  playhead: number | null;
  total: number;
  onPlayToggle: () => void;
  onStep: () => void;
  onReset: () => void;
  onInjectLive: () => void;
  onExport: (kind: 'json' | 'md') => void;
  onSearch: (q: string) => void;
  onOpenCase: (caseId: string) => void;
  onOpenChain: () => void;
  searchIndex: SearchSuggestion[];
  soundOn: boolean;
  onToggleSound: () => void;
  chainStatus: ChainStatus;
  liveAlertTotal: number;
  unseenAlerts: number;
  onAlertsClick: () => void;
}

const INPUT_ICON: Record<InputType, LucideIcon> = {
  bank_account: Landmark,
  crypto_wallet: Wallet,
  txid: Hash,
  case_id: FileText,
  unknown: Search,
};
const INPUT_COLOR: Record<InputType, string> = {
  bank_account: '#fbbf24',
  crypto_wallet: '#a5b4fc',
  txid: '#7dd3fc',
  case_id: '#d8b4fe',
  unknown: '#94a3b8',
};
const SUG_ICON: Record<SearchSuggestion['kind'], LucideIcon> = {
  case_id: FileText,
  bank_account: Landmark,
  crypto_wallet: Wallet,
  txid: Hash,
  atm: Banknote,
  ip: Wifi,
};
const CHAIN_LABEL: Record<ChainStatus, string> = {
  standby: 'STANDBY',
  checking: 'QUERYING…',
  online: 'LIVE',
  offline: 'SIM FALLBACK',
};

/** Preset label: bank accounts in full, long wallet addresses shortened (0x9f8c…71a4). */
const presetKey = (c: InvestigationCase) => (c.primaryKey.length > 16 ? shortId(c.primaryKey, 6, 4) : c.primaryKey);

const LiveClock = memo(function LiveClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hidden shrink-0 items-baseline gap-2 whitespace-nowrap rounded-lg border border-ops-line bg-ops-bg px-3 py-1.5 xl:flex" aria-label="เวลาปัจจุบัน (ICT)">
      <span className="num text-[14px] font-semibold text-slate-50">{fmtTime(now)}</span>
      <span className="num text-[11px] text-slate-400">{fmtThaiDateShort(now)} · ICT</span>
    </div>
  );
});

/** Shorter search placeholder on phones so it never clips. */
function useWide(query = '(min-width: 640px)') {
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

// ───────────────────────── Row 2: smart search ─────────────────────────

function SmartSearch({ onSearch, onOpenCase, index, cases }: { onSearch: (q: string) => void; onOpenCase: (id: string) => void; index: SearchSuggestion[]; cases: InvestigationCase[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // -1 = nothing highlighted → Enter searches the typed text
  const wrap = useDismiss(open, () => setOpen(false));
  const det = useMemo(() => detectInput(q), [q]);
  const DetIcon = INPUT_ICON[det.type];
  const wide = useWide();
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

  const suggestions = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) {
      const recent = index.filter((s) => s.kind === 'case_id');
      const tx = index.filter((s) => s.kind === 'txid').slice(0, 3);
      return [...recent, ...tx].slice(0, 10);
    }
    return index.filter((s) => norm(s.value).includes(needle) || s.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, index]);
  const exact = suggestions.some((s) => norm(s.value) === norm(q.trim()));
  const rows: (SearchSuggestion | null)[] = q.trim() && !exact ? [...suggestions, null] : suggestions; // null = synthesize

  useEffect(() => setHi(-1), [q]);

  const submit = (value: string) => {
    if (!value.trim()) return;
    onSearch(value.trim());
    setQ(value.trim());
    setOpen(false);
  };
  const choose = (s: SearchSuggestion | null) => {
    if (!s) return submit(q);
    if (s.kind === 'case_id') {
      onOpenCase(s.caseId);
      setQ('');
      setOpen(false);
      return;
    }
    submit(s.value);
  };

  return (
    <div ref={wrap} className="relative min-w-[300px] flex-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (open && hi >= 0 && hi < rows.length) choose(rows[hi]);
          else submit(q);
        }}
        className="flex h-10 items-center gap-2.5 rounded-lg border border-ops-line2 bg-ops-bg pr-1.5 pl-3 shadow-inner transition focus-within:border-cyan-400/80 focus-within:shadow-[0_0_0_3px_rgb(34_211_238/0.15)]"
        role="search"
      >
        <Search className="size-4 shrink-0 text-slate-300" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(rows.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(-1, h - 1));
            }
          }}
          placeholder={wide ? 'กรอกเลขบัญชีธนาคาร, Crypto Wallet หรือ TxID...' : 'เลขบัญชี / Wallet / TxID...'}
          aria-label="ค้นหาเลขบัญชี กระเป๋าคริปโต TxID หรือรหัสคดี"
          className="num min-w-0 flex-1 bg-transparent text-[13px] text-slate-50 placeholder:font-sans placeholder:text-slate-400 focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        {q.trim() && (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ color: INPUT_COLOR[det.type], background: `${INPUT_COLOR[det.type]}1c`, boxShadow: `inset 0 0 0 1px ${INPUT_COLOR[det.type]}55` }}
          title={det.hint}
          aria-live="polite"
        >
          <DetIcon className="size-3.5" />
          {det.label}
          {det.chain && <span className="num opacity-90">· {det.chain}</span>}
        </span>
        )}
        <button type="submit" className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-cyan-400 px-3 text-[12px] font-bold text-ops-bg hover:bg-cyan-300">
          สืบค้น <CornerDownLeft className="size-3.5" />
        </button>
      </form>

      {open && rows.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1200] overflow-hidden rounded-lg border border-ops-line2 bg-ops-bar shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-ops-line px-3 py-2 text-[11px] text-slate-300">
            <span>{q.trim() ? `ผลการค้นหาในฐานข้อมูลคดี (${cases.length} คดี)` : 'คดีและ TxID ในระบบ — คลิกเพื่อเปิดทันที'}</span>
            <span className="num text-slate-400">↑↓ · Enter · Esc</span>
          </div>
          <ul className="thin-scroll max-h-[360px] overflow-auto py-1">
            {rows.map((s, i) => {
              if (!s)
                return (
                  <li key="synth">
                    <button
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={() => choose(null)}
                      className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left', hi === i ? 'bg-fuchsia-500/15' : 'hover:bg-white/5')}
                    >
                      <Sparkles className="size-4 shrink-0 text-fuchsia-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-slate-50">
                          สร้างคดีติดตามใหม่จาก <span className="num break-all text-fuchsia-200">{q.trim()}</span>
                        </span>
                        <span className="block text-[11px] text-slate-400">Dynamic Case Synthesis · {det.label}{det.chain === 'BTC' ? ' · ตรวจสอบบล็อกเชนสดอัตโนมัติ' : ''}</span>
                      </span>
                    </button>
                  </li>
                );
              const Icon = SUG_ICON[s.kind];
              return (
                <li key={`${s.caseId}-${s.value}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(s)}
                    className={cx('flex w-full items-center gap-3 px-3 py-2 text-left', hi === i ? 'bg-cyan-400/10' : 'hover:bg-white/5')}
                  >
                    <Icon className="size-4 shrink-0 text-slate-300" />
                    <span className="min-w-0 flex-1">
                      <span className="num block break-all text-[12.5px] text-slate-50">{s.kind === 'txid' ? shortId(s.value, 16, 10) : s.value}</span>
                      <span className="block text-[11px] text-slate-400">{s.label}</span>
                    </span>
                    <span className="num shrink-0 text-[11px] text-slate-300">{s.caseId}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Row 1: tools menu ─────────────────────────

function MenuItem({ icon: Icon, title, sub, onClick, right }: { icon: LucideIcon; title: string; sub?: string; onClick: () => void; right?: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none">
      <Icon className="size-4 shrink-0 text-cyan-300" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-slate-50">{title}</span>
        {sub && <span className="block text-[11px] text-slate-400">{sub}</span>}
      </span>
      {right}
    </button>
  );
}

function ToolsMenu(p: Pick<Props, 'onExport' | 'onOpenChain' | 'soundOn' | 'onToggleSound' | 'chainStatus' | 'liveAlertTotal' | 'unseenAlerts' | 'onAlertsClick'>) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  const chainColor = p.chainStatus === 'online' ? '#4ade80' : p.chainStatus === 'offline' ? '#fbbf24' : '#94a3b8';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'relative inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[12.5px] font-medium transition',
          open ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-100' : 'border-ops-line2 bg-ops-card text-slate-100 hover:bg-ops-raised',
        )}
      >
        <SlidersHorizontal className="size-4" />
        เครื่องมือ / ส่งออก
        <ChevronDown className="size-3.5 text-slate-300" />
        {p.unseenAlerts > 0 && (
          <span className="num absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-[0_0_10px_#ef4444]">
            {p.unseenAlerts}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-[1200] w-[300px] overflow-hidden rounded-lg border border-ops-line2 bg-ops-bar p-1.5 shadow-2xl shadow-black/60">
          <div className="px-2.5 pt-1 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-400">ส่งออกหลักฐาน</div>
          <MenuItem icon={FileBraces} title="หลักฐานดิจิทัล (JSON)" sub="โครงสร้างครบ + Taint + SHA-256" onClick={run(() => p.onExport('json'))} />
          <MenuItem icon={FileText} title="รายงานคดี (Markdown)" sub="ธุรกรรม · พิกัด · ความเสี่ยง · ข้ามคดี" onClick={run(() => p.onExport('md'))} />
          <div className="my-1.5 border-t border-ops-line" />
          <div className="px-2.5 pt-0.5 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-400">ระบบ</div>
          <MenuItem
            icon={p.chainStatus === 'offline' ? WifiOff : Wifi}
            title="Chain API (mempool.space)"
            sub="เปิดแท็บตรวจสอบบล็อกเชนสด"
            onClick={run(p.onOpenChain)}
            right={<span className="num shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ color: chainColor, boxShadow: `inset 0 0 0 1px ${chainColor}66` }}>{CHAIN_LABEL[p.chainStatus]}</span>}
          />
          <MenuItem
            icon={p.soundOn ? Volume2 : VolumeX}
            title="เสียงแจ้งเตือน"
            sub={p.soundOn ? 'เปิดอยู่ — เล่นเสียงเมื่อมีเหตุการณ์สด' : 'ปิดอยู่'}
            onClick={p.onToggleSound}
            right={
              <span className={cx('relative h-5 w-9 shrink-0 rounded-full transition', p.soundOn ? 'bg-cyan-400' : 'bg-slate-600')} aria-hidden>
                <span className={cx('absolute top-0.5 size-4 rounded-full bg-white transition-all', p.soundOn ? 'left-[18px]' : 'left-0.5')} />
              </span>
            }
          />
          <MenuItem
            icon={Bell}
            title="ประวัติการแจ้งเตือนสด"
            sub={p.liveAlertTotal ? `${p.liveAlertTotal} เหตุการณ์ในรอบนี้` : 'ยังไม่มีเหตุการณ์'}
            onClick={run(p.onAlertsClick)}
            right={p.unseenAlerts > 0 ? <span className="num rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{p.unseenAlerts}</span> : undefined}
          />
          <div className="mt-1.5 flex items-center gap-2 border-t border-ops-line px-2.5 pt-2 pb-1 text-[11px] text-slate-400">
            <Keyboard className="size-3.5 shrink-0" />
            <span>
              <kbd className="num text-slate-200">Space</kbd> เล่น/หยุด · <kbd className="num text-slate-200">→</kbd> ทีละขั้น · <kbd className="num text-slate-200">L</kbd> เหตุการณ์สด
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Command bar ─────────────────────────

export default function TopCommandBar(p: Props) {
  const c = p.activeCase;
  const inPlayback = p.playhead !== null;
  const riskColor = RISK_COLOR[p.risk.level];
  const presets = p.cases.filter((x) => PRESET_META[x.id]);

  return (
    <header className="relative z-[1100] shrink-0 border-b border-ops-line bg-ops-bar">
      {/* Row 1 — identity, case telemetry & simulation controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2.5 pb-2">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg border border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-500/25 to-cyan-500/10 shadow-[0_0_18px_rgb(168_85_247/0.3)]">
            <ShieldAlert className="size-5 text-fuchsia-200" />
          </div>
          <span className="num whitespace-nowrap text-[15px] font-bold tracking-[0.16em] text-white">CCIB COMMAND</span>
          <span className="hidden whitespace-nowrap rounded border border-ops-line2 px-1.5 py-0.5 text-[10.5px] text-slate-300 2xl:inline">บช.สอท.</span>
        </div>

        <div className="flex max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-ops-line2 bg-ops-card px-2.5 py-1.5" title={`${c.id} · ${c.title}`}>
          <span className="size-2 rounded-full bg-cyan-300 shadow-[0_0_8px_#67e8f9]" />
          <span className="num text-[13px] font-semibold text-cyan-200">{c.id}</span>
          {c.synthesized && <Tag color="#e879f9">SYNTHESIZED</Tag>}
          <span className="hidden h-4 w-px bg-ops-line2 sm:block" />
          <span className="num hidden text-[13px] font-semibold text-slate-50 sm:inline">{fmtMoney(c.lossAmount, 'THB')}</span>
          <span className="h-4 w-px bg-ops-line2" />
          <span
            className="num inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-bold"
            style={{ color: riskColor, background: `${riskColor}1f`, boxShadow: `inset 0 0 0 1px ${riskColor}70` }}
            title="Interception Priority / Risk Score"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: riskColor }} />
              <span className="relative inline-flex size-2 rounded-full" style={{ background: riskColor }} />
            </span>
            {p.risk.label} {p.risk.score}/100
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="flex h-9 items-center rounded-lg border border-ops-line2 bg-ops-bg p-0.5" role="radiogroup" aria-label="วิธีคำนวณเงินปนเปื้อน (Taint method)">
            {(
              [
                ['proportional', 'Proportional', 'Haircut %'],
                ['fifo', 'FIFO', 'First-In, First-Out'],
              ] as const
            ).map(([k, label, sub]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={p.method === k}
                onClick={() => p.onMethodChange(k)}
                title={`Taint: ${label} (${sub})`}
                className={cx(
                  'num h-full whitespace-nowrap rounded-md px-3 text-[12.5px] font-semibold transition',
                  p.method === k ? 'bg-fuchsia-500/25 text-white shadow-[inset_0_0_0_1px_rgb(232_121_249/0.7)]' : 'text-slate-300 hover:text-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Chronological playback">
            <IconButton title="รีเซ็ตไทม์ไลน์ (Reset)" onClick={p.onReset} className="h-9 w-9">
              <RotateCcw className="size-4" />
            </IconButton>
            <IconButton title={p.isPlaying ? 'หยุดชั่วคราว (Pause)' : 'เล่นตามลำดับเวลา (Play)'} onClick={p.onPlayToggle} active={p.isPlaying} className="h-9 min-w-[84px] px-3">
              {p.isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              <span className="num text-[12px] font-semibold">{inPlayback ? `${p.playhead}/${p.total}` : 'PLAY'}</span>
            </IconButton>
            <IconButton title="ทีละขั้น (Step)" onClick={p.onStep} className="h-9 w-9">
              <SkipForward className="size-4" />
            </IconButton>
          </div>

          <button
            type="button"
            onClick={p.onInjectLive}
            aria-label="จำลองความเคลื่อนไหวสด (Inject Live Alert)"
            title="จำลองธุรกรรม / การถอนเงินสดแบบเรียลไทม์ (Inject Live Alert)"
            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-red-400/70 bg-red-500/20 px-3 text-[12.5px] font-bold text-red-50 shadow-[0_0_20px_rgb(239_68_68/0.28)] transition hover:bg-red-500/30"
          >
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            <Radio className="size-4" />+ จำลองเหตุการณ์สด
          </button>

          <ToolsMenu {...p} />
        </div>
      </div>

      {/* Row 2 — focused search & quick case presets */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
        <SmartSearch onSearch={p.onSearch} onOpenCase={p.onOpenCase} index={p.searchIndex} cases={p.cases} />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="คดีตัวอย่าง (Quick presets)">
          {presets.map((x, i) => {
            const active = x.id === c.id;
            const r = p.caseRisks[x.id];
            const color = r ? RISK_COLOR[r.level] : '#94a3b8';
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => p.onOpenCase(x.id)}
                aria-pressed={active}
                title={`${x.id} · ${x.title} · ${PRESET_META[x.id].tag}${r ? ` · RISK ${r.score}` : ''}`}
                className={cx(
                  'flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border px-3 transition',
                  active ? 'border-cyan-400/80 bg-cyan-400/10 text-white' : 'border-ops-line2 bg-ops-card text-slate-200 hover:bg-ops-raised',
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="num text-[12px] font-bold text-slate-300">#{i + 1}</span>
                <span className="num text-[12.5px] font-semibold">{presetKey(x)}</span>
              </button>
            );
          })}
        </div>
        <LiveClock />
      </div>
    </header>
  );
}
