import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type NodeChange,
} from '@xyflow/react';
import { Info, LayoutGrid, Maximize, Workflow } from 'lucide-react';
import type {
  CaseTaintResult,
  CrossCaseLink,
  EdgeTaint,
  FlowEdge,
  FlowEntity,
  InterceptionTarget,
  InvestigationCase,
  Selection,
  TaintMethod,
} from '../types/investigation';
import FlowEntityNode, { NODE_W, type EntityNodeType } from './FlowEntityNode';
import { ENTITY_META, IconButton, PaneHeader, cx } from './ui';
import { METHOD_LABEL, fmtHM, fmtMoney, fmtMoneyShort, fmtPct } from '../utils/format';
import { nodeDepths, toTHB } from '../utils/taintEngine';

// ───────────────────────── Custom animated edge ─────────────────────────

type FlowEdgeData = {
  edge: FlowEdge;
  taint?: EdgeTaint;
  from: string;
  to: string;
  width: number;
  ghost: boolean;
  emphasis: 'high' | 'normal' | 'dim';
  current: boolean;
  onSelect: (edgeId: string) => void;
};
type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

const FlowEdgeView = memo(function FlowEdgeView(props: EdgeProps<FlowEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });
  // keep labels legible when zoomed out (counter-scale up to 1.2× so they never cover the cards)
  const labelScale = useStore((s) => Math.min(1.2, Math.max(1, 0.85 / s.transform[2])));
  if (!data) return null;
  const { edge, taint, from, to, width, ghost, emphasis, current } = data;
  const gid = `eg-${id}`;
  const opacity = ghost ? 0.07 : emphasis === 'dim' ? 0.4 : 1;
  const pct = taint?.taintPct ?? 0;
  const conv = edge.receivedAmount && edge.receivedCurrency && edge.receivedCurrency !== edge.currency;

  return (
    <>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      {!ghost && <path d={path} fill="none" stroke={`url(#${gid})`} strokeOpacity={emphasis === 'high' ? 0.28 : 0.12} strokeWidth={width + 7} />}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={22} style={{ stroke: `url(#${gid})`, strokeWidth: width, opacity, transition: 'opacity .4s' }} />
      {!ghost && (
        <path
          d={path}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={emphasis === 'dim' ? 0.12 : 0.42}
          strokeWidth={Math.max(1, width * 0.35)}
          className={cx('flow-dash pointer-events-none', (current || edge.isLive) && 'flow-dash-fast')}
        />
      )}
      {!ghost && emphasis !== 'dim' && (
        <circle r={Math.max(2.5, width * 0.7)} fill={to} style={{ filter: `drop-shadow(0 0 5px ${to})` }}>
          <animateMotion dur={edge.isLive || current ? '1.1s' : '2.6s'} repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onSelect(edge.id);
          }}
          className={cx(
            'nodrag nopan absolute rounded-md border bg-slate-950/95 px-1.5 py-1 text-left shadow-lg shadow-black/60 backdrop-blur transition hover:border-slate-300',
            emphasis === 'high' ? 'border-slate-300/80' : 'border-slate-600',
            current && 'ring-2 ring-white/60',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${labelScale})`, pointerEvents: 'all', opacity: ghost ? 0.15 : emphasis === 'dim' ? 0.55 : 1, zIndex: emphasis === 'high' ? 10 : 1 }}
          title={`${edge.channel} · ${edge.txRef}`}
        >
          <div className="num flex items-center gap-1 text-[11px] font-semibold leading-tight text-slate-50">
            {fmtMoneyShort(edge.amount, edge.currency)}
            {conv && <span className="text-slate-300">→ {fmtMoneyShort(edge.receivedAmount!, edge.receivedCurrency!)}</span>}
            {edge.isLive && <span className="rounded bg-red-500 px-1 text-[8.5px] text-white">LIVE</span>}
          </div>
          <div className="num mt-0.5 flex items-center gap-1 text-[9.5px] leading-none">
            <span className="text-slate-300">{fmtHM(edge.timestamp)}</span>
            <span className="rounded px-1 py-px font-semibold text-sky-100" style={{ background: `rgb(56 189 248 / ${0.12 + pct * 0.38})` }}>
              TAINT {fmtPct(pct, 0)}
            </span>
          </div>
        </button>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes = { entity: FlowEntityNode };
const FIT = { padding: 0.22, duration: 400, maxZoom: 1.05 } as const;
const edgeTypes = { flow: FlowEdgeView };

// ───────────────────────── Layered auto-layout ─────────────────────────

const COL_W = 350; // card 240 + ~110 gap for edge labels
const ROW_H = 198; // card 172 + gap (nodeOrigin centres cards vertically)
const TB_COL = NODE_W + 34; // portrait: siblings side by side
const TB_ROW = 268; // portrait: card 172 + ~96 gap for edge labels

export type GraphOrientation = 'LR' | 'TB';

export function layeredLayout(entities: FlowEntity[], edges: FlowEdge[], orientation: GraphOrientation = 'LR'): Record<string, { x: number; y: number }> {
  const depth = nodeDepths(entities, edges);
  const cols = new Map<number, string[]>();
  for (const e of entities) cols.set(depth[e.id], [...(cols.get(depth[e.id]) ?? []), e.id]);
  const maxD = Math.max(0, ...cols.keys());
  const rowIdx: Record<string, number> = {};
  for (let d = 0; d <= maxD; d++) {
    const ids = cols.get(d) ?? [];
    if (d > 0) {
      const bary = (id: string) => {
        const parents = edges.filter((x) => x.target === id && rowIdx[x.source] !== undefined).map((x) => rowIdx[x.source]);
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0;
      };
      ids.sort((a, b) => bary(a) - bary(b));
    }
    ids.forEach((id, i) => (rowIdx[id] = i - (ids.length - 1) / 2));
  }
  return Object.fromEntries(
    entities.map((e) => [
      e.id,
      orientation === 'LR' ? { x: depth[e.id] * COL_W, y: rowIdx[e.id] * ROW_H } : { x: rowIdx[e.id] * TB_COL, y: depth[e.id] * TB_ROW },
    ]),
  );
}

// ───────────────────────── Fund disposition bar ─────────────────────────

const DISPO_COLOR: Record<string, string> = {
  cash_out: ENTITY_META.cash_out.color,
  exchange: ENTITY_META.exchange.color,
  mule_bank: ENTITY_META.mule_bank.color,
  crypto_wallet: ENTITY_META.crypto_wallet.color,
  unattributed: '#475569',
};

const DISPO_SHORT: Record<string, string> = {
  cash_out: 'เงินสด',
  exchange: 'Exchange',
  mule_bank: 'บัญชีม้า',
  crypto_wallet: 'คริปโต',
  unattributed: 'ระหว่างทาง',
};

/** Single-line strip: where the victim's money is now (THB equivalent), recomputed per taint method. */
function DispositionBar({ taint, method }: { taint: CaseTaintResult; method: TaintMethod }) {
  const d = taint.totals.disposition;
  const [hover, setHover] = useState<string | null>(null);
  const tip = (x: (typeof d)[number]) => `${x.label}: ${fmtMoney(x.thb, 'THB', { decimals: 0 })} (${fmtPct(x.pct, 1)})`;
  return (
    <div key={method} className="animate-flash flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-ops-line px-3">
      <span className="hidden shrink-0 whitespace-nowrap text-[12px] font-medium text-slate-200 sm:inline" title={`Victim Fund Disposition · ${METHOD_LABEL[method]}`}>
        เงินผู้เสียหายอยู่ที่ไหน
      </span>
      <div className="flex h-3 min-w-[120px] flex-1 gap-[2px] overflow-hidden rounded" role="img" aria-label={d.map(tip).join(' · ')}>
        {d.map((x) => (
          <div
            key={x.key}
            onMouseEnter={() => setHover(x.key)}
            onMouseLeave={() => setHover(null)}
            className="h-full transition-[width] duration-700 first:rounded-l last:rounded-r"
            style={{
              width: `${Math.max(1.5, x.pct * 100)}%`,
              background:
                x.key === 'exchange'
                  ? `repeating-linear-gradient(135deg, ${DISPO_COLOR[x.key]} 0 5px, ${DISPO_COLOR[x.key]}aa 5px 8px)`
                  : DISPO_COLOR[x.key],
              opacity: hover && hover !== x.key ? 0.45 : 1,
            }}
            title={tip(x)}
          />
        ))}
      </div>
      <div className="hidden shrink-0 items-center gap-3 lg:flex">
        {d.map((x) => (
          <span
            key={x.key}
            title={tip(x)}
            onMouseEnter={() => setHover(x.key)}
            onMouseLeave={() => setHover(null)}
            className={cx('flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-slate-300 transition', hover && hover !== x.key && 'opacity-50')}
          >
            <span className="size-2 rounded-sm" style={{ background: DISPO_COLOR[x.key] }} />
            {DISPO_SHORT[x.key]}
            <span className="num font-semibold text-slate-50">{fmtPct(x.pct, 0)}</span>
          </span>
        ))}
      </div>
      <span className="shrink-0 whitespace-nowrap text-[12px] text-slate-300">
        อายัดได้ ≈ <span className="num font-semibold text-slate-50">{fmtMoney(taint.totals.recoverableTHB, 'THB', { decimals: 0 })}</span>
        <span className="num hidden text-slate-400 sm:inline"> / {fmtMoney(taint.totals.victimLossTHB, 'THB', { decimals: 0 })}</span>
      </span>
    </div>
  );
}

// ───────────────────────── Graph ─────────────────────────

interface Props {
  c: InvestigationCase;
  taint: CaseTaintResult;
  method: TaintMethod;
  selection: Selection;
  revealedEntities: Set<string> | null;
  revealedEdges: Set<string> | null;
  currentEdgeId: string | null;
  currentEntityId: string | null;
  links: CrossCaseLink[];
  targets: InterceptionTarget[];
  onSelectEntity: (id: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

type GraphCommands = { relayout: () => void; fit: () => void };

function GraphCanvas(p: Props & { commandsRef: { current: GraphCommands | null } }) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes] = useState<EntityNodeType[]>([]);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const layoutCase = useRef<string | null>(null);
  const userMoved = useRef(false);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const lastFitKey = useRef('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<GraphOrientation>('LR');
  const userViewport = useRef(false); // officer panned / zoomed manually → don't auto-refit on resize
  const fitRef = useRef(() => {});
  fitRef.current = () => void fitView(FIT);

  // Portrait / narrow canvas (phones, split tablets) → top-to-bottom flow; re-centre on resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setOrientation(width < 720 && height > width * 0.85 ? 'TB' : 'LR');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!userViewport.current) fitRef.current();
      }, 180);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    layoutCase.current = null;
    setLayoutNonce((n) => n + 1);
  }, [orientation]);

  const entityCount = p.c.entities.length;
  // Build / merge node state (keeps user-dragged positions; new live nodes get auto-placed)
  useEffect(() => {
    const auto = layeredLayout(p.c.entities, p.c.edges, orientation);
    if (layoutCase.current !== p.c.id) {
      positions.current = new Map(Object.entries(auto));
      layoutCase.current = p.c.id;
      userMoved.current = false;
    }
    const fresh = p.c.entities.filter((e) => !positions.current.has(e.id));
    if (fresh.length && !userMoved.current) {
      // untouched layout → re-run the layered layout so live nodes slot in cleanly
      positions.current = new Map(Object.entries(auto));
    } else {
      // officer has arranged the graph → keep it, drop new nodes into the first free slot of their column
      for (const e of fresh) {
        const pos = { ...auto[e.id] };
        const taken = () => [...positions.current.values()].some((q) => Math.abs(q.x - pos.x) < NODE_W + 20 && Math.abs(q.y - pos.y) < ROW_H - 10);
        let guard = 0;
        while (taken() && guard++ < 20) {
          if (orientation === 'LR') pos.y += ROW_H;
          else pos.x += TB_COL;
        }
        positions.current.set(e.id, pos);
      }
    }

    const linkCount = (id: string) => new Set(p.links.filter((l) => l.localEntityId === id).map((l) => l.remoteCaseId)).size;
    const target = (id: string) => p.targets.find((t) => t.entityId === id);
    setNodes(
      p.c.entities.map((e) => {
        const t = p.taint.nodes[e.id];
        const tg = target(e.id);
        return {
          id: e.id,
          type: 'entity' as const,
          position: positions.current.get(e.id) ?? auto[e.id],
          data: {
            entity: e,
            taint: t,
            thbRemaining: t ? toTHB(t.remainingTainted, e.currency, p.c) : 0,
            ghost: p.revealedEntities ? !p.revealedEntities.has(e.id) : false,
            current: p.currentEntityId === e.id,
            isSelected: p.selection.entityId === e.id,
            linkCount: linkCount(e.id),
            priority: tg?.priority,
            chokepoint: tg?.chokepoint ?? e.chokepoint,
            isPrimary: p.c.primaryEntityId === e.id,
            geoCount: p.c.geoEvents.filter((g) => g.entityId === e.id).length,
            vertical: orientation === 'TB',
          },
        };
      }),
    );
  }, [p.c, p.taint, p.selection.entityId, p.revealedEntities, p.currentEntityId, p.links, p.targets, layoutNonce, orientation]);

  // Fit view when the case changes, the layout is reset, or new live nodes are appended
  useEffect(() => {
    const key = `${p.c.id}|${entityCount}|${layoutNonce}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    userViewport.current = false;
    const id = setTimeout(() => fitRef.current(), 120);
    return () => clearTimeout(id);
  }, [p.c.id, entityCount, layoutNonce]);

  p.commandsRef.current = {
    relayout: () => {
      layoutCase.current = null;
      setLayoutNonce((n) => n + 1);
    },
    fit: () => {
      userViewport.current = false;
      fitRef.current();
    },
  };

  const onNodesChange = useCallback((changes: NodeChange<EntityNodeType>[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      for (const ch of changes)
        if (ch.type === 'position' && ch.position) {
          positions.current.set(ch.id, ch.position);
          if (ch.dragging) userMoved.current = true;
        }
      return next;
    });
  }, []);

  const edges = useMemo<FlowEdgeType[]>(() => {
    const byId = new Map(p.c.entities.map((e) => [e.id, e]));
    const values = p.c.edges.map((e) => toTHB(e.amount, e.currency, p.c));
    const max = Math.max(1, ...values);
    const sel = p.selection.entityId;
    const selEdge = p.selection.edgeId;
    return p.c.edges.map((e, i) => {
      const from = ENTITY_META[byId.get(e.source)?.type ?? 'victim'].color;
      const to = ENTITY_META[byId.get(e.target)?.type ?? 'victim'].color;
      const touches = sel ? e.source === sel || e.target === sel : false;
      const emphasis: FlowEdgeData['emphasis'] = selEdge === e.id || touches ? 'high' : sel || selEdge ? 'dim' : 'normal';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'flow' as const,
        markerEnd: { type: MarkerType.ArrowClosed, color: to, width: 16, height: 16 },
        zIndex: emphasis === 'high' ? 5 : 0,
        data: {
          edge: e,
          taint: p.taint.edges[e.id],
          from,
          to,
          width: 1.6 + 3.4 * Math.sqrt(values[i] / max),
          ghost: p.revealedEdges ? !p.revealedEdges.has(e.id) : false,
          emphasis,
          current: p.currentEdgeId === e.id,
          onSelect: p.onSelectEdge,
        },
      };
    });
  }, [p.c, p.taint, p.selection.entityId, p.selection.edgeId, p.revealedEdges, p.currentEdgeId, p.onSelectEdge]);

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1">
      <ReactFlow<EntityNodeType, FlowEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => p.onSelectEntity(n.id)}
        onMoveStart={(event) => {
          if (event) userViewport.current = true; // null = programmatic (fitView)
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="dark"
        minZoom={0.2}
        maxZoom={2}
        nodeOrigin={[0, 0.5]}
        fitView
        fitViewOptions={FIT}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#1e293b" />
        <Controls showInteractive={false} position="bottom-right" orientation="horizontal" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => ENTITY_META[(n.data as EntityNodeType['data']).entity.type].color}
          nodeStrokeWidth={0}
          nodeBorderRadius={6}
          style={{ width: 132, height: 80, marginBottom: 46 }}
          ariaLabel="Mini-map"
        />
      </ReactFlow>
      <LegendPill />
    </div>
  );
}

/** Compact semantic colour legend pinned to the bottom-left of the canvas. */
function LegendPill() {
  return (
    <div
      className="pointer-events-auto absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-120px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-ops-line2 bg-ops-bar/95 px-3 py-1.5 shadow-lg shadow-black/50 backdrop-blur"
      aria-label="คำอธิบายสี (Legend)"
    >
      {(Object.keys(ENTITY_META) as (keyof typeof ENTITY_META)[]).map((k) => {
        const m = ENTITY_META[k];
        const Icon = m.icon;
        return (
          <span key={k} className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-200" title={`${m.th} · ${m.en}`}>
            <Icon className="size-3.5" style={{ color: m.color }} />
            {LEGEND_SHORT[k]}
          </span>
        );
      })}
      <span
        className="text-slate-300 hover:text-white"
        title="เส้นไล่สีต้นทาง→ปลายทาง · ความหนา = มูลค่า · TAINT = สัดส่วนเงินผู้เสียหาย · แถบฟ้า = เงินผู้เสียหาย / เทา = เงินอื่น · ซูมออก = การ์ดตัวอักษรใหญ่ · จอแนวตั้ง = ไหลบนลงล่าง"
      >
        <Info className="size-3.5" />
      </span>
    </div>
  );
}

const LEGEND_SHORT: Record<keyof typeof ENTITY_META, string> = {
  victim: 'ผู้เสียหาย',
  mule_bank: 'บัญชีม้า',
  crypto_wallet: 'คริปโต',
  exchange: 'Exchange',
  cash_out: 'ATM / เงินสด',
};

export default function MoneyFlowGraph(p: Props) {
  const commands = useRef<GraphCommands | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader icon={Workflow} title="เส้นทางการเงินข้ามช่องทาง" subtitle={p.c.title} accent="#f59e0b">
        <IconButton title="จัดเรียงอัตโนมัติ / รีเซ็ตเลย์เอาต์ (Auto-Arrange / Reset Layout)" onClick={() => commands.current?.relayout()} className="h-7">
          <LayoutGrid className="size-3.5" />
          <span className="hidden whitespace-nowrap text-[11.5px] sm:inline">จัดเรียงอัตโนมัติ</span>
        </IconButton>
        <IconButton title="พอดีหน้าจอ (Fit view)" onClick={() => commands.current?.fit()} className="h-7">
          <Maximize className="size-3.5" />
        </IconButton>
        <span className="num hidden whitespace-nowrap rounded border border-fuchsia-400/60 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-100 sm:inline">TAINT · {p.method === 'fifo' ? 'FIFO' : 'PROPORTIONAL'}</span>
      </PaneHeader>
      <DispositionBar taint={p.taint} method={p.method} />
      <ReactFlowProvider>
        <GraphCanvas {...p} commandsRef={commands} />
      </ReactFlowProvider>
    </div>
  );
}
