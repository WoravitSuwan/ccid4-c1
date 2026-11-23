import { memo } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { Link2, MapPin, Radio, Snowflake, Target } from 'lucide-react';
import type { ChokepointType, FlowEntity, NodeTaint } from '../types/investigation';
import { fmtMoney, fmtMoneyShort, fmtPct, shortId } from '../utils/format';
import { CHOKEPOINT_META, ENTITY_META, STATUS_META, Tag, cx } from './ui';

export type EntityNodeData = {
  entity: FlowEntity;
  taint?: NodeTaint;
  thbRemaining: number;
  ghost: boolean;
  current: boolean;
  isSelected: boolean;
  linkCount: number;
  priority?: number;
  chokepoint?: ChokepointType;
  isPrimary: boolean;
  geoCount: number;
  vertical: boolean;
};
export type EntityNodeType = Node<EntityNodeData, 'entity'>;

const VICTIM = '#38bdf8';

/** Fixed card geometry — identical in detail & compact (semantic-zoom) modes so fit-to-view stays stable. */
export const NODE_W = 240;
export const nodeHeight = (type: FlowEntity['type']) => (type === 'victim' ? 124 : 172);

/** Pool composition: victim share (cyan) vs other funds (slate); faded part = already moved out. */
function PoolBar({ t }: { t: NodeTaint }) {
  if (t.totalIn <= 0) return <div className="h-1.5 rounded-full bg-ops-line" />;
  const v = t.victimIn / t.totalIn;
  const vOut = t.victimIn > 0 ? Math.min(1, t.taintedOut / t.victimIn) : 0;
  const oOut = t.otherIn > 0 ? Math.min(1, t.cleanOut / t.otherIn) : 0;
  return (
    <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
      {v > 0 && (
        <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${v * 100}%` }}>
          <div className="h-full" style={{ width: `${(1 - vOut) * 100}%`, background: VICTIM }} />
          <div className="h-full" style={{ width: `${vOut * 100}%`, background: `${VICTIM}55` }} />
        </div>
      )}
      {v < 1 && (
        <div className="flex h-full flex-1 overflow-hidden rounded-full">
          <div className="h-full" style={{ width: `${(1 - oOut) * 100}%`, background: '#64748b' }} />
          <div className="h-full" style={{ width: `${oOut * 100}%`, background: '#64748b55' }} />
        </div>
      )}
    </div>
  );
}

/** Semantic zoom: below this zoom the card swaps to large-type essentials so it stays readable. */
const COMPACT_BELOW = 0.8;

function CompactBody({ data }: { data: EntityNodeData }) {
  const { entity: e, taint: t, chokepoint, linkCount } = data;
  const meta = ENTITY_META[e.type];
  const Icon = meta.icon;
  const isCash = e.type === 'cash_out';
  const metric = !t
    ? null
    : t.isOrigin
      ? { k: 'สูญเสีย', v: fmtMoneyShort(t.victimIn, t.currency) }
      : isCash
        ? { k: 'ถอนสด', v: fmtMoneyShort(t.totalIn, t.currency) }
        : { k: 'ค้างปนเปื้อน', v: fmtMoneyShort(t.remainingTainted, t.currency) };
  return (
    <div className="px-3 pt-2.5 pb-3">
      <div className="flex items-center gap-2">
        <Icon className="size-5 shrink-0" style={{ color: meta.color }} />
        <span className="num truncate text-[14px] font-bold tracking-wide" style={{ color: meta.color }}>{e.role.split(' · ')[0]}</span>
        {e.isLive && <Tag color="#ef4444" solid className="!text-[11px]">LIVE</Tag>}
      </div>
      <div className="num mt-1 truncate text-[19px] font-bold text-slate-50">{e.identifier.length > 16 ? shortId(e.identifier, 6, 4) : e.identifier}</div>
      {metric && (
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-slate-400">{metric.k}</span>
          <span className="num truncate text-[19px] font-bold text-sky-200">{metric.v}</span>
        </div>
      )}
      {t && !t.isOrigin && (
        <>
          <div className="mt-1.5 [&>div]:!h-2.5">
            <PoolBar t={isCash ? { ...t, taintedOut: 0, cleanOut: 0 } : t} />
          </div>
          <div className="num mt-1 flex items-center justify-between text-[13px]">
            <span className="text-sky-300">TAINT {fmtPct(t.poolTaintPct, 0)}</span>
            <span className="flex items-center gap-1.5">
              {chokepoint && <span className="size-2.5 rounded-full" style={{ background: CHOKEPOINT_META[chokepoint].color }} title={CHOKEPOINT_META[chokepoint].label} />}
              {linkCount > 0 && <span className="text-fuchsia-300">X{linkCount}</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function FlowEntityNode({ data }: NodeProps<EntityNodeType>) {
  const { entity: e, taint: t, ghost, current, isSelected, linkCount, priority, chokepoint } = data;
  const compact = useStore((s) => s.transform[2] < COMPACT_BELOW);
  const meta = ENTITY_META[e.type];
  const Icon = meta.icon;
  const status = STATUS_META[e.status];
  const isCash = e.type === 'cash_out';
  const isExchange = e.type === 'exchange';
  const long = e.identifier.length > 22;

  return (
    <div
      className={cx('relative transition-[opacity,filter] duration-500', ghost && 'opacity-[0.16] grayscale', e.isLive && 'animate-live-pop')}
      style={{ width: NODE_W, height: nodeHeight(e.type) }}
      title={`${e.role} · ${e.identifier}`}
    >
      {isCash && !ghost && (
        <>
          <span className="pointer-events-none absolute -inset-1.5 rounded-[14px] border-2 border-red-500/70 animate-pulse-ring" />
          <span className="pointer-events-none absolute -inset-1.5 rounded-[14px] border-2 border-red-500/40 animate-pulse-ring [animation-delay:1.1s]" />
        </>
      )}
      {current && <span className="pointer-events-none absolute -inset-1 rounded-[13px] border-2 border-white/70 animate-pulse" />}

      <Handle type="target" position={data.vertical ? Position.Top : Position.Left} className={cx(e.type === 'victim' && '!opacity-0')} />
      <div
        className="relative h-full overflow-hidden rounded-[10px] border bg-ops-card/95 backdrop-blur"
        style={{
          borderColor: isSelected ? meta.color : '#1e293b',
          boxShadow: isSelected
            ? `0 0 0 1px ${meta.color}, 0 0 28px ${meta.color}66, 0 12px 30px rgb(0 0 0 / 0.5)`
            : isExchange
              ? `0 0 22px ${meta.color}33, 0 10px 24px rgb(0 0 0 / 0.45)`
              : '0 10px 24px rgb(0 0 0 / 0.45)',
        }}
      >
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${meta.color}, ${meta.color}33)` }} />
        {compact ? (
          <CompactBody data={data} />
        ) : (
        <div className="px-2.5 pt-2 pb-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `${meta.color}1f`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
              <Icon className="size-3.5" style={{ color: meta.color }} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="num truncate text-[9.5px] font-semibold tracking-wider" style={{ color: meta.color }}>
                {e.role}
              </div>
              <div className="truncate text-[10.5px] text-slate-400">
                {e.institution}
                {e.chain && <span className="num text-slate-500"> · {e.chain}</span>}
              </div>
            </div>
            {e.isLive ? (
              <Tag color="#ef4444" solid>
                <Radio className="size-2.5" /> LIVE
              </Tag>
            ) : (
              <span className="flex items-center gap-1 text-[9.5px] text-slate-500" title={status.th}>
                <span className="size-1.5 rounded-full" style={{ background: status.color }} />
                {status.th}
              </span>
            )}
          </div>

          <div className={cx('num mt-1.5 truncate font-semibold text-slate-50', long ? 'text-[11px]' : 'text-[12.5px]')} title={e.identifier}>
            {long ? shortId(e.identifier, 10, 8) : e.identifier}
          </div>
          <div className="truncate text-[10.5px] text-slate-400">{e.label}</div>

          {t && (
            <div className="mt-1.5 space-y-1 rounded-md border border-ops-line bg-ops-bg/70 px-2 py-1">
              {t.isOrigin ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-slate-500">เงินที่สูญเสีย</span>
                  <span className="num text-[12px] font-semibold text-slate-100">{fmtMoney(t.victimIn, t.currency)}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] text-slate-500">
                      {isCash ? 'ถอนเงินสด' : 'รับเข้า'} <span className="num text-[11px] font-semibold text-slate-100">{isCash ? fmtMoney(t.totalIn, t.currency) : fmtMoneyShort(t.totalIn, t.currency)}</span>
                    </span>
                    <span className="num shrink-0 text-[9.5px] font-semibold text-sky-300">TAINT {fmtPct(t.poolTaintPct, 1)}</span>
                  </div>
                  <PoolBar t={isCash ? { ...t, taintedOut: 0, cleanOut: 0 } : t} />
                  {isCash ? (
                    <div className="text-[9.5px] text-slate-500">ออกจากระบบธนาคารแล้ว — ติดตามทางกายภาพ</div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="shrink-0 text-[10px] text-slate-500">ค้างปนเปื้อน</span>
                      <span className={cx('num truncate text-[11px] font-semibold', t.remainingTainted > 0.005 ? 'text-sky-200' : 'text-slate-500')}>
                        {e.currency === 'THB' ? fmtMoney(t.remainingTainted, t.currency) : fmtMoneyShort(t.remainingTainted, t.currency)}
                        {e.currency !== 'THB' && t.remainingTainted > 0.005 && <span className="font-normal text-slate-500"> ≈{fmtMoneyShort(data.thbRemaining, 'THB')}</span>}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(chokepoint || linkCount > 0 || priority !== undefined || data.geoCount > 0 || data.isPrimary) && (
            <div className="mt-1.5 flex flex-nowrap items-center gap-1 overflow-hidden">
              {chokepoint && (
                <Tag color={CHOKEPOINT_META[chokepoint].color}>
                  {chokepoint === 'EXCHANGE_KYC' || chokepoint === 'BANK_FREEZE' ? <Snowflake className="size-2.5" /> : <Target className="size-2.5" />}
                  {CHOKEPOINT_META[chokepoint].label}
                </Tag>
              )}
              {priority !== undefined && <Tag color={priority >= 65 ? '#f97316' : '#94a3b8'}>P{priority}</Tag>}
              {linkCount > 0 && (
                <Tag color="#e879f9">
                  <Link2 className="size-2.5" />X-CASE {linkCount}
                </Tag>
              )}
              {data.geoCount > 0 && (
                <Tag color="#94a3b8">
                  <MapPin className="size-2.5" />
                  {data.geoCount}
                </Tag>
              )}
              {data.isPrimary && <Tag color="#38bdf8">ค้นหา</Tag>}
            </div>
          )}
        </div>
        )}
      </div>
      <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} className={cx(isCash && '!opacity-0')} />
    </div>
  );
}

export default memo(FlowEntityNode);
