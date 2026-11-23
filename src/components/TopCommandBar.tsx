import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Bell,
  ChevronDown,
  CornerDownLeft,
  Download,
  FileBraces,
  FileText,
  Hash,
  Landmark,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  SkipForward,
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
import { IconButton, RISK_COLOR, RiskBadge, Tag, cx } from './ui';

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
  bank_account: '#f59e0b',
  crypto_wallet: '#818cf8',
  txid: '#38bdf8',
  case_id: '#a855f7',
  unknown: '#64748b',
};
const SUG_ICON: Record<SearchSuggestion['kind'], LucideIcon> = {
  case_id: FileText,
  bank_account: Landmark,
  crypto_wallet: Wallet,
  txid: Hash,
  atm: Banknote,
  ip: Wifi,
};

const LiveClock = memo(function LiveClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hidden flex-col items-end leading-tight lg:flex">
      <span className="num text-[13px] font-semibold text-slate-100">{fmtTime(now)}</span>
      <span className="num text-[9.5px] text-slate-500">{fmtThaiDateShort(now)} · ICT (UTC+7)</span>
    </div>
  );
});

function SmartSearch({ onSearch, onOpenCase, index, cases }: { onSearch: (q: string) => void; onOpenCase: (id: string) => void; index: SearchSuggestion[]; cases: InvestigationCase[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // -1 = nothing highlighted → Enter searches the typed text
  const wrap = useRef<HTMLDivElement>(null);
  const det = useMemo(() => detectInput(q), [q]);
  const DetIcon = INPUT_ICON[det.type];

  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/[\s-]/g, '');
    if (!needle) {
      const picks = index.filter((s) => s.kind === 'case_id' || s.kind === 'txid').slice(0, 9);
      return picks;
    }
    return index.filter((s) => s.value.toLowerCase().replace(/[\s-]/g, '').includes(needle) || s.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, index]);
  const exact = suggestions.some((s) => s.value.toLowerCase().replace(/[\s-]/g, '') === q.trim().toLowerCase().replace(/[\s-]/g, ''));
  const rows = q.trim() && !exact ? [...suggestions, null] : suggestions; // null = "synthesize" row

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
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
    <div ref={wrap} className="relative min-w-[220px] flex-1 basis-[260px] xl:max-w-[470px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (open && hi >= 0 && hi < rows.length) choose(rows[hi]);
          else submit(q);
        }}
        className="flex h-9 items-center gap-2 rounded-lg border border-ops-line2 bg-ops-bg px-2.5 shadow-inner focus-within:border-sky-400/70 focus-within:shadow-[0_0_0_3px_rgb(56_189_248/0.12)]"
      >
        <Search className="size-4 shrink-0 text-slate-500" />
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
            } else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="ค้นหา เลขบัญชี / Wallet / TxID / รหัสคดี"
          aria-label="ค้นหาเลขบัญชี กระเป๋าคริปโต TxID หรือรหัสคดี"
          className="num min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-100 placeholder:font-sans placeholder:text-slate-500 focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <span
          className="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium sm:inline-flex"
          style={{ color: INPUT_COLOR[det.type], background: `${INPUT_COLOR[det.type]}18`, boxShadow: `inset 0 0 0 1px ${INPUT_COLOR[det.type]}44` }}
          title={det.hint}
        >
          <DetIcon className="size-3" />
          {det.label}
          {det.chain && <span className="num opacity-80">· {det.chain}</span>}
        </span>
        <button type="submit" className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-sky-500/90 px-2 text-[11px] font-semibold text-ops-bg hover:bg-sky-400">
          สืบค้น <CornerDownLeft className="size-3" />
        </button>
      </form>

      {open && rows.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1200] overflow-hidden rounded-lg border border-ops-line2 bg-ops-bar shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-ops-line px-3 py-1.5 text-[10px] text-slate-500">
            <span>{q.trim() ? `ผลการค้นหาในฐานข้อมูลคดี (${cases.length} คดี)` : 'คดีและ TxID ในระบบ — คลิกเพื่อเปิดทันที'}</span>
            <span className="num">↑↓ Enter</span>
          </div>
          <ul className="thin-scroll max-h-[340px] overflow-auto py-1">
            {rows.map((s, i) => {
              if (!s)
                return (
                  <li key="synth">
                    <button
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={() => choose(null)}
                      className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-left', hi === i ? 'bg-fuchsia-500/10' : 'hover:bg-white/5')}
                    >
                      <Sparkles className="size-4 shrink-0 text-fuchsia-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-slate-100">
                          สังเคราะห์คดีใหม่จาก <span className="num text-fuchsia-300">{shortId(q.trim(), 14, 6)}</span>
                        </span>
                        <span className="block text-[10.5px] text-slate-500">Dynamic Case Synthesis · {det.label}{det.chain === 'BTC' ? ' · พร้อมตรวจสอบบล็อกเชนสด' : ''}</span>
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
                    className={cx('flex w-full items-center gap-2.5 px-3 py-1.5 text-left', hi === i ? 'bg-sky-500/10' : 'hover:bg-white/5')}
                  >
                    <Icon className="size-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="num block truncate text-[12px] text-slate-100">{s.kind === 'txid' ? shortId(s.value, 14, 8) : s.value}</span>
                      <span className="block truncate text-[10.5px] text-slate-500">{s.label}</span>
                    </span>
                    <span className="num shrink-0 text-[10px] text-slate-500">{s.caseId}</span>
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

function ExportMenu({ onExport }: { onExport: (k: 'json' | 'md') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div ref={ref} className="relative">
      <IconButton title="ส่งออกหลักฐาน (JSON/MD)" onClick={() => setOpen((o) => !o)} active={open}>
        <Download className="size-3.5" />
        <span className="hidden 2xl:inline">ส่งออกหลักฐาน</span>
        <span className="num text-[10px] text-slate-500">JSON/MD</span>
        <ChevronDown className="size-3" />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[1200] w-64 overflow-hidden rounded-lg border border-ops-line2 bg-ops-bar p-1 shadow-2xl shadow-black/60">
          {(
            [
              ['json', FileBraces, 'หลักฐานดิจิทัล (JSON)', 'โครงสร้างครบ + Taint + SHA-256'],
              ['md', FileText, 'รายงานคดี (Markdown)', 'ตาราง ธุรกรรม พิกัด ความเสี่ยง'],
            ] as const
          ).map(([k, Icon, t, d]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onExport(k);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/5"
            >
              <Icon className="mt-0.5 size-4 text-sky-300" />
              <span>
                <span className="block text-[12px] text-slate-100">{t}</span>
                <span className="block text-[10.5px] text-slate-500">{d}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopCommandBar(p: Props) {
  const c = p.activeCase;
  const inPlayback = p.playhead !== null;
  return (
    <header className="relative z-[1100] shrink-0 border-b border-ops-line bg-ops-bar">
      {/* Row 1 — identity, active case, system status */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-2 pb-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/20 to-sky-500/10 shadow-[0_0_20px_rgb(168_85_247/0.25)]">
            <ShieldAlert className="size-5 text-fuchsia-300" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span className="num text-[14px] font-bold tracking-[0.18em] text-white">CCIB</span>
              <span className="num hidden text-[10px] tracking-[0.14em] text-slate-400 2xl:inline">CYBER-FINANCIAL & GEO-INTERCEPTION COMMAND CENTER</span>
            </div>
            <div className="truncate text-[11px] text-slate-400">ศูนย์บัญชาการสืบสวนเส้นทางการเงินดิจิทัลและพิกัดจุดดักจับแบบเรียลไทม์ · บช.สอท.</div>
          </div>
        </div>

        <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-lg border border-ops-line bg-ops-card/70 px-2.5 py-1">
          <span className="num shrink-0 text-[12px] font-semibold text-sky-300">{c.id}</span>
          {c.synthesized && <Tag color="#d946ef">SYNTHESIZED</Tag>}
          <span className="min-w-0 truncate text-[12px] text-slate-200" title={c.title}>{c.title}</span>
          <span className="hidden shrink-0 text-slate-600 xl:inline">|</span>
          <span className="hidden shrink-0 text-[11px] text-slate-400 xl:inline">
            ความเสียหาย <span className="num font-semibold text-slate-100">{fmtMoney(c.lossAmount, 'THB')}</span>
          </span>
          <div className="ml-auto shrink-0">
            <RiskBadge score={p.risk.score} level={p.risk.level} label={p.risk.label} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cx(
              'num hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] lg:inline-flex',
              p.chainStatus === 'online' ? 'border-emerald-500/40 text-emerald-300' : p.chainStatus === 'offline' ? 'border-amber-500/40 text-amber-300' : 'border-ops-line text-slate-400',
            )}
            title="Live public blockchain API (mempool.space / blockstream.info)"
          >
            {p.chainStatus === 'offline' ? <WifiOff className="size-3" /> : <Wifi className={cx('size-3', p.chainStatus === 'checking' && 'animate-pulse')} />}
            CHAIN API · {p.chainStatus === 'online' ? 'LIVE' : p.chainStatus === 'offline' ? 'SIM FALLBACK' : p.chainStatus === 'checking' ? 'QUERYING' : 'STANDBY'}
          </span>
          <IconButton title={p.soundOn ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'} onClick={p.onToggleSound}>
            {p.soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5 text-slate-500" />}
          </IconButton>
          <IconButton title="การแจ้งเตือนสด" onClick={p.onAlertsClick} className="relative">
            <Bell className={cx('size-3.5', p.unseenAlerts > 0 && 'text-red-400')} />
            {p.liveAlertTotal > 0 && (
              <span className={cx('num absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold', p.unseenAlerts > 0 ? 'animate-pulse bg-red-500 text-white' : 'bg-slate-600 text-white')}>
                {p.liveAlertTotal}
              </span>
            )}
          </IconButton>
          <LiveClock />
        </div>
      </div>

      {/* Row 2 — operations */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <SmartSearch onSearch={p.onSearch} onOpenCase={p.onOpenCase} index={p.searchIndex} cases={p.cases} />

        <div className="flex items-center gap-1" role="group" aria-label="คดีตัวอย่าง (Quick presets)">
          {p.cases
            .filter((x) => PRESET_META[x.id])
            .map((x, i) => {
              const active = x.id === c.id;
              const r = p.caseRisks[x.id];
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => p.onOpenCase(x.id)}
                  title={`${x.id} · ${x.title}`}
                  className={cx(
                    'flex h-9 items-center gap-2 rounded-md border px-2 text-left transition',
                    active ? 'border-sky-400/60 bg-sky-400/10' : 'border-ops-line bg-ops-card hover:border-ops-line2 hover:bg-ops-raised',
                  )}
                >
                  <span className="size-1.5 rounded-full" style={{ background: r ? RISK_COLOR[r.level] : '#64748b', boxShadow: `0 0 8px ${r ? RISK_COLOR[r.level] : '#64748b'}` }} />
                  <span className="leading-none">
                    <span className="num block text-[10px] text-slate-500">CASE #{i + 1} · {r?.score ?? '–'}</span>
                    <span className="block text-[11px] text-slate-200">
                      <span className="num">{PRESET_META[x.id].short}</span> {PRESET_META[x.id].tag}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>

        <div className="flex h-9 items-center rounded-lg border border-ops-line bg-ops-bg p-0.5" role="radiogroup" aria-label="วิธีคำนวณเงินปนเปื้อน">
          {(
            [
              ['proportional', 'Proportional', 'Haircut %'],
              ['fifo', 'FIFO', 'First-In, First-Out'],
            ] as const
          ).map(([k, t, s]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={p.method === k}
              onClick={() => p.onMethodChange(k)}
              className={cx(
                'flex h-full items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-semibold transition',
                p.method === k ? 'bg-fuchsia-500/20 text-fuchsia-100 shadow-[inset_0_0_0_1px_rgb(217_70_239/0.5)]' : 'text-slate-400 hover:text-slate-200',
              )}
              title={`Taint: ${t} (${s})`}
            >
              <span className="num">{t}</span>
              <span className="num hidden text-[9.5px] font-normal opacity-70 2xl:inline">{s}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Chronological playback">
          <IconButton title="รีเซ็ตไทม์ไลน์ (Reset)" onClick={p.onReset}>
            <RotateCcw className="size-3.5" />
          </IconButton>
          <IconButton title={p.isPlaying ? 'หยุดชั่วคราว (Pause)' : 'เล่นตามลำดับเวลา (Play)'} onClick={p.onPlayToggle} active={p.isPlaying}>
            {p.isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            <span className="num text-[10.5px]">{inPlayback ? `${p.playhead}/${p.total}` : 'PLAY'}</span>
          </IconButton>
          <IconButton title="ทีละขั้น (Step)" onClick={p.onStep}>
            <SkipForward className="size-3.5" />
          </IconButton>
        </div>

        <button
          type="button"
          onClick={p.onInjectLive}
          className="group relative flex h-9 items-center gap-2 overflow-hidden rounded-lg border border-red-500/60 bg-red-500/15 px-3 text-[12px] font-semibold text-red-100 shadow-[0_0_22px_rgb(239_68_68/0.25)] transition hover:bg-red-500/25"
          title="จำลองธุรกรรม/การถอนเงินสดแบบเรียลไทม์ (Inject Live Alert)"
        >
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          <Radio className="size-3.5" />
          <span>+ จำลองความเคลื่อนไหวสด</span>
          <span className="num hidden text-[9.5px] font-normal text-red-300/80 2xl:inline">INJECT LIVE ALERT</span>
        </button>

        <div className="ml-auto">
          <ExportMenu onExport={p.onExport} />
        </div>
      </div>
    </header>
  );
}
