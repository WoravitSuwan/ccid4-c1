import { useEffect } from 'react';
import { CircleCheck, Info, MapPin, Siren, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { LiveAlert, Toast } from '../types/investigation';
import { fmtTime } from '../utils/format';
import { cx } from './ui';

const TONE: Record<Toast['tone'], { icon: LucideIcon; color: string }> = {
  info: { icon: Info, color: '#38bdf8' },
  success: { icon: CircleCheck, color: '#22c55e' },
  warning: { icon: TriangleAlert, color: '#f59e0b' },
  critical: { icon: Siren, color: '#ef4444' },
};

function ToastItem({ t, onDismiss, onFocusAlert }: { t: Toast; onDismiss: (id: string) => void; onFocusAlert: (a: LiveAlert) => void }) {
  const { icon: Icon, color } = TONE[t.tone];
  useEffect(() => {
    const id = setTimeout(() => onDismiss(t.id), t.tone === 'critical' ? 11000 : 5200);
    return () => clearTimeout(id);
  }, [t.id, t.tone, onDismiss]);
  return (
    <div
      role={t.tone === 'critical' ? 'alert' : 'status'}
      className={cx('pointer-events-auto relative w-[min(380px,calc(100vw-24px))] animate-toast-in overflow-hidden rounded-lg border bg-ops-bar/95 shadow-2xl shadow-black/60 backdrop-blur')}
      style={{ borderColor: `${color}80`, boxShadow: t.tone === 'critical' ? `0 0 32px ${color}40, 0 20px 40px rgb(0 0 0 / 0.6)` : undefined }}
    >
      {t.tone === 'critical' && <div className="h-[3px] animate-pulse" style={{ background: color }} />}
      <div className="flex gap-2.5 p-2.5">
        <Icon className={cx('mt-0.5 size-4.5 shrink-0', t.tone === 'critical' && 'animate-pulse')} style={{ color }} />
        <div className="min-w-0 flex-1">
          {t.tone === 'critical' && <div className="num text-[9.5px] font-bold tracking-[0.2em]" style={{ color }}>TACTICAL ALERT · การแจ้งเตือนสด</div>}
          <div className="text-[12.5px] font-semibold text-slate-50">{t.title}</div>
          {t.detail && <div className="mt-0.5 text-[12px] leading-snug text-slate-300">{t.detail}</div>}
          {t.alert && (
            <button
              type="button"
              onClick={() => {
                onFocusAlert(t.alert!);
                onDismiss(t.id);
              }}
              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-100 hover:bg-red-500/25"
            >
              <MapPin className="size-3" /> ดูตำแหน่ง & เอนทิตี
            </button>
          )}
        </div>
        <button type="button" onClick={() => onDismiss(t.id)} className="self-start rounded p-0.5 text-slate-400 hover:text-white" aria-label="ปิดการแจ้งเตือน">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss, onFocusAlert }: { toasts: Toast[]; onDismiss: (id: string) => void; onFocusAlert: (a: LiveAlert) => void }) {
  return (
    <div className="pointer-events-none fixed right-3 top-[116px] z-[2500] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.slice(0, 4).map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={onDismiss} onFocusAlert={onFocusAlert} />
      ))}
    </div>
  );
}

export function AlertHistory({ alerts, onClose, onFocusAlert }: { alerts: LiveAlert[]; onClose: () => void; onFocusAlert: (a: LiveAlert) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-[2400]" onClick={onClose} aria-hidden />
      <div className="fixed right-3 top-[60px] z-[2450] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-lg border border-ops-line2 bg-ops-bar shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-ops-line px-3 py-2">
          <span className="text-[12px] font-semibold text-slate-100">การแจ้งเตือนสดในรอบนี้</span>
          <span className="num text-[10px] text-slate-400">{alerts.length} ALERTS</span>
        </div>
        <ul className="thin-scroll max-h-[60vh] overflow-y-auto p-1">
          {alerts.length === 0 && <li className="px-3 py-4 text-center text-[11.5px] text-slate-400">ยังไม่มีการแจ้งเตือน — กด “+ จำลองความเคลื่อนไหวสด”</li>}
          {alerts.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onFocusAlert(a)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5">
                <Siren className={cx('mt-0.5 size-3.5 shrink-0', a.severity === 'critical' ? 'text-red-400' : 'text-amber-400')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] text-slate-100">{a.title}</span>
                  <span className="num block text-[10px] text-slate-400">{fmtTime(a.timestamp)} · {a.caseId}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
