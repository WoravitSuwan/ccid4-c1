import { useState, type ReactNode } from 'react';
import { Banknote, Building2, Check, Copy, Landmark, UserRound, Wallet, type LucideIcon } from 'lucide-react';
import type { ChokepointType, EntityStatus, EntityType, RiskLevel, Severity } from '../types/investigation';
import { copyText } from '../utils/browser';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export const ENTITY_META: Record<EntityType, { color: string; th: string; en: string; icon: LucideIcon }> = {
  victim: { color: '#38bdf8', th: 'ผู้เสียหาย / ต้นทาง', en: 'VICTIM', icon: UserRound },
  mule_bank: { color: '#f59e0b', th: 'บัญชีม้า (ธนาคาร)', en: 'MULE BANK', icon: Landmark },
  crypto_wallet: { color: '#818cf8', th: 'กระเป๋าคริปโต / Pool', en: 'CRYPTO WALLET', icon: Wallet },
  exchange: { color: '#a855f7', th: 'Exchange (จุดสกัด KYC)', en: 'EXCHANGE', icon: Building2 },
  cash_out: { color: '#ef4444', th: 'ถอนเงินสด / ATM', en: 'CASH-OUT', icon: Banknote },
};

export const CHOKEPOINT_META: Record<ChokepointType, { label: string; color: string; th: string }> = {
  EXCHANGE_KYC: { label: 'Exchange KYC', color: '#a855f7', th: 'อายัด / ขอ KYC' },
  ATM_CASHOUT: { label: 'ATM Cash-Out', color: '#ef4444', th: 'ขอ CCTV / สกัดจุดถอน' },
  HIGH_TAINT_POOL: { label: 'High Taint Pool', color: '#818cf8', th: 'Pool ปนเปื้อนสูง' },
  BANK_FREEZE: { label: 'Bank Freeze', color: '#f59e0b', th: 'อายัดบัญชีธนาคาร' },
};

export const STATUS_META: Record<EntityStatus, { th: string; color: string }> = {
  origin: { th: 'ต้นทาง', color: '#38bdf8' },
  flagged: { th: 'ถูกตั้งธง', color: '#f59e0b' },
  frozen: { th: 'อายัดแล้ว', color: '#22c55e' },
  cashed_out: { th: 'ถอนแล้ว', color: '#ef4444' },
  monitoring: { th: 'เฝ้าระวัง', color: '#a855f7' },
  active: { th: 'เคลื่อนไหว', color: '#f43f5e' },
};

export const RISK_COLOR: Record<RiskLevel, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: '#64748b',
  warning: '#f59e0b',
  critical: '#ef4444',
};

export function CopyButton({ text, label, className, title }: { text: string; label?: string; className?: string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={title ?? 'คัดลอก'}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-ops-line px-1.5 py-0.5 text-[10.5px] text-slate-400 transition hover:border-ops-line2 hover:text-slate-100',
        done && 'border-emerald-500/50 text-emerald-300',
        className,
      )}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label && <span>{done ? 'คัดลอกแล้ว' : label}</span>}
    </button>
  );
}

export function PaneHeader({
  icon: Icon,
  title,
  badge,
  accent = '#38bdf8',
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge: string;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ops-line bg-ops-bar/80 px-3">
      <Icon className="size-4 shrink-0" style={{ color: accent }} />
      <h2 className="truncate text-[13px] font-semibold text-slate-100">{title}</h2>
      <span className="num hidden shrink-0 rounded border border-ops-line px-1.5 py-px text-[9.5px] tracking-wider text-slate-500 sm:inline">
        {badge}
      </span>
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Tag({ children, color = '#64748b', className, solid }: { children: ReactNode; color?: string; className?: string; solid?: boolean }) {
  return (
    <span
      className={cx('num inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[9.5px] font-semibold tracking-wide', className)}
      style={
        solid
          ? { background: color, color: '#060911' }
          : { color, background: `${color}1a`, boxShadow: `inset 0 0 0 1px ${color}40` }
      }
    >
      {children}
    </span>
  );
}

export function RiskBadge({ score, level, label, size = 'md' }: { score: number; level: RiskLevel; label: string; size?: 'sm' | 'md' }) {
  const c = RISK_COLOR[level];
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-md font-semibold', size === 'md' ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]')}
      style={{ color: c, background: `${c}14`, boxShadow: `inset 0 0 0 1px ${c}55, 0 0 18px ${c}22` }}
      title="Interception Priority / Risk Score"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: c }} />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: c }} />
      </span>
      <span className="num">RISK {score}/100</span>
      <span className="num opacity-90">{label}</span>
    </span>
  );
}

export function IconButton({
  onClick,
  title,
  children,
  active,
  className,
  disabled,
}: {
  onClick?: () => void;
  title: string;
  children: ReactNode;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-sky-400/60 bg-sky-400/10 text-sky-200'
          : 'border-ops-line bg-ops-card text-slate-300 hover:border-ops-line2 hover:bg-ops-raised hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-ops-line bg-ops-bg/60 px-2 py-1.5">
      <div className="truncate text-[10px] text-slate-500">{label}</div>
      <div className="num truncate text-[13px] font-semibold text-slate-100" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="num truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
