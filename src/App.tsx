/**
 * CCIB Cyber-Financial & Geo-Interception Command Center
 * Root state orchestration — one selection model shared by Graph ↔ Map ↔ Timeline ↔ Inspector.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DocumentType,
  InvestigationCase,
  LiveAlert,
  Selection,
  TaintMethod,
  Toast,
} from './types/investigation';
import {
  DATA_EPOCH,
  MOCK_CASES,
  buildSearchIndex,
  findCasesByIdentifier,
  findCrossCaseLinks,
  linkedCaseIdsForRisk,
} from './data/mockCases';
import { computeCaseRisk, computeCaseTaint, computeInterceptionTargets, fetchPublicBitcoinInfo } from './utils/taintEngine';
import { injectLiveAlert, synthesizeCase } from './utils/liveSimulator';
import { detectInput, isBtcAddress, isBtcTxid } from './utils/inputDetect';
import { buildCaseJSON, buildCaseMarkdown, downloadText, sha256Hex } from './utils/exporters';
import { playAlertTone } from './utils/browser';
import { METHOD_LABEL, fmtMoney, shortId } from './utils/format';
import { sortGeo } from './utils/geo';
import TopCommandBar, { type ChainStatus } from './components/TopCommandBar';
import MoneyFlowGraph from './components/MoneyFlowGraph';
import TacticalMap from './components/TacticalMap';
import { InspectorPanel, TimelineStrip, type ChainState, type InspectorTab } from './components/TimelineAndInspector';
import ActionDocumentModal from './components/ActionDocumentModal';
import { AlertHistory, ToastStack } from './components/AlertToasts';

const PLAYBACK_MS = 1500;
const byTime = (a: { timestamp: string }, b: { timestamp: string }) => Date.parse(a.timestamp) - Date.parse(b.timestamp);

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const initialSelection = (c: InvestigationCase, entityId?: string, edgeId?: string): Selection => ({
  entityId: entityId ?? c.primaryEntityId,
  geoId: null,
  eventId: null,
  edgeId: edgeId ?? null,
});

export default function App() {
  const [cases, setCases] = useState<InvestigationCase[]>(MOCK_CASES);
  const [activeId, setActiveId] = useState(MOCK_CASES[0].id);
  const [method, setMethod] = useState<TaintMethod>('fifo');
  const [selection, setSelection] = useState<Selection>(() => initialSelection(MOCK_CASES[0]));
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simNow, setSimNow] = useState(DATA_EPOCH);
  const [tab, setTab] = useState<InspectorTab>('entity');
  const [doc, setDoc] = useState<{ type: DocumentType; entityId: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [chain, setChain] = useState<ChainState>({ status: 'idle', query: '', result: null });
  const [chainStatus, setChainStatus] = useState<ChainStatus>('standby');
  const chainReq = useRef(0);
  const now = useNow(15_000);

  const c = cases.find((x) => x.id === activeId) ?? cases[0];
  const events = useMemo(() => [...c.timeline].sort(byTime), [c.timeline]);
  const total = events.length;
  const revealedCount = playhead ?? total;
  const asOf =
    playhead === null || playhead >= total
      ? Number.POSITIVE_INFINITY
      : playhead === 0
        ? Date.parse(events[0]?.timestamp ?? new Date().toISOString()) - 1
        : Date.parse(events[playhead - 1].timestamp);

  // ── Playback reveal sets (null = everything visible / LIVE) ──
  const revealed = useMemo(() => {
    if (playhead === null || playhead >= total) return null;
    const ents = new Set<string>(c.entities.filter((e) => e.type === 'victim').map((e) => e.id));
    const edges = new Set<string>();
    const geos = new Set<string>();
    for (const ev of events.slice(0, playhead)) {
      ents.add(ev.entityId);
      if (ev.edgeId) edges.add(ev.edgeId);
      if (ev.geoEventId) geos.add(ev.geoEventId);
    }
    for (const ed of c.edges)
      if (Date.parse(ed.timestamp) <= asOf) {
        edges.add(ed.id);
        ents.add(ed.source);
        ents.add(ed.target);
      }
    for (const g of c.geoEvents) if (Date.parse(g.timestamp) <= asOf) geos.add(g.id);
    return { ents, edges, geos };
  }, [c, events, playhead, total, asOf]);

  // ── Engines ──
  const taint = useMemo(() => computeCaseTaint(c, method, asOf), [c, method, asOf]);
  const taintAlt = useMemo(() => computeCaseTaint(c, method === 'fifo' ? 'proportional' : 'fifo', asOf), [c, method, asOf]);
  /** Full (non-playback) taint for documents & exports — evidence always reflects every known transfer. */
  const fullTaint = useMemo(() => computeCaseTaint(c, method), [c, method]);
  const links = useMemo(() => findCrossCaseLinks(c, cases), [c, cases]);
  const risk = useMemo(() => computeCaseRisk(c, { linkedCaseIds: linkedCaseIdsForRisk(links), now: simNow }), [c, links, simNow]);
  const caseRisks = useMemo(
    () => Object.fromEntries(cases.map((x) => [x.id, computeCaseRisk(x, { linkedCaseIds: linkedCaseIdsForRisk(findCrossCaseLinks(x, cases)), now: simNow })])),
    [cases, simNow],
  );
  const targets = useMemo(() => computeInterceptionTargets(c, taint, links, simNow), [c, taint, links, simNow]);
  const searchIndex = useMemo(() => buildSearchIndex(cases), [cases]);
  const visibleGeos = useMemo(() => (revealed ? c.geoEvents.filter((g) => revealed.geos.has(g.id)) : c.geoEvents), [c.geoEvents, revealed]);
  const currentEvent = playhead !== null && playhead > 0 && playhead <= total ? events[playhead - 1] : null;

  // ── Toasts ──
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    setToasts((prev) => [{ ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }, ...prev].slice(0, 6));
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  // ── Selection sync (Graph ↔ Map ↔ Timeline ↔ Inspector) ──
  /** The entity's own latest GPS fix, else the latest fix of a directly connected entity (so the map always pans). */
  const latestGeoOf = useCallback(
    (entityId: string) => {
      const visible = (ids: Set<string>) => sortGeo(c.geoEvents.filter((g) => ids.has(g.entityId) && (!revealed || revealed.geos.has(g.id)))).at(-1);
      const own = visible(new Set([entityId]));
      if (own) return own;
      const neighbours = new Set(c.edges.flatMap((e) => (e.source === entityId ? [e.target] : e.target === entityId ? [e.source] : [])));
      return visible(neighbours);
    },
    [c.geoEvents, c.edges, revealed],
  );

  const selectEntity = useCallback(
    (id: string) => {
      const ev = [...events].reverse().find((e) => e.entityId === id);
      setSelection({ entityId: id, geoId: latestGeoOf(id)?.id ?? null, eventId: ev?.id ?? null, edgeId: null });
      setTab('entity');
    },
    [events, latestGeoOf],
  );

  const selectGeo = useCallback(
    (geoId: string) => {
      const g = c.geoEvents.find((x) => x.id === geoId);
      if (!g) return;
      const ev = events.find((e) => e.geoEventId === geoId);
      setSelection({ entityId: g.entityId, geoId, eventId: ev?.id ?? null, edgeId: ev?.edgeId ?? null });
      setTab('entity');
    },
    [c.geoEvents, events],
  );

  const selectEvent = useCallback(
    (eventId: string) => {
      const ev = events.find((e) => e.id === eventId);
      if (!ev) return;
      setSelection({ entityId: ev.entityId, geoId: ev.geoEventId ?? latestGeoOf(ev.entityId)?.id ?? null, eventId, edgeId: ev.edgeId ?? null });
      setTab('entity');
    },
    [events, latestGeoOf],
  );

  const selectEdge = useCallback(
    (edgeId: string) => {
      const ed = c.edges.find((x) => x.id === edgeId);
      if (!ed) return;
      const ev = events.find((e) => e.edgeId === edgeId);
      setSelection({ entityId: ed.target, geoId: ev?.geoEventId ?? latestGeoOf(ed.target)?.id ?? null, eventId: ev?.id ?? null, edgeId });
      setTab('entity');
    },
    [c.edges, events, latestGeoOf],
  );

  const openCase = useCallback(
    (caseId: string, entityId?: string, edgeId?: string) => {
      const target = cases.find((x) => x.id === caseId);
      setActiveId(caseId);
      setPlayhead(null);
      setIsPlaying(false);
      if (target) setSelection(initialSelection(target, entityId, edgeId));
      setTab('entity');
    },
    [cases],
  );

  // ── Playback engine ──
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setPlayhead((p) => {
        const cur = p ?? 0;
        if (cur >= total) return null;
        return cur + 1;
      });
    }, PLAYBACK_MS);
    return () => clearInterval(id);
  }, [isPlaying, total]);

  useEffect(() => {
    if (playhead === null && isPlaying) setIsPlaying(false);
  }, [playhead, isPlaying]);

  useEffect(() => {
    if (playhead === null || playhead === 0) return;
    const ev = events[playhead - 1];
    if (!ev) return;
    setSelection((sel) => ({ entityId: ev.entityId, eventId: ev.id, geoId: ev.geoEventId ?? sel.geoId, edgeId: ev.edgeId ?? null }));
  }, [playhead, events]);

  const victimId = c.entities.find((e) => e.type === 'victim')?.id ?? c.primaryEntityId;
  const togglePlay = useCallback(() => {
    if (isPlaying) return setIsPlaying(false);
    if (playhead === null || playhead >= total) {
      setPlayhead(0);
      setSelection({ entityId: victimId, geoId: null, eventId: null, edgeId: null });
    }
    setIsPlaying(true);
  }, [isPlaying, playhead, total, victimId]);

  const step = useCallback(() => {
    setIsPlaying(false);
    setPlayhead((p) => (p === null ? 1 : p + 1 > total ? null : p + 1));
  }, [total]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setPlayhead(0);
    setSelection({ entityId: victimId, geoId: null, eventId: null, edgeId: null });
  }, [victimId]);

  const jumpLive = useCallback(() => {
    setIsPlaying(false);
    setPlayhead(null);
  }, []);

  // ── Live alert injection ──
  const injectLive = useCallback(() => {
    const t = Date.now();
    const { next, alert } = injectLiveAlert(c, t);
    setCases((prev) => prev.map((x) => (x.id === next.id ? next : x)));
    setSimNow(t);
    setPlayhead(null);
    setIsPlaying(false);
    const ev = next.timeline.find((e) => e.id === alert.eventId);
    setSelection({ entityId: alert.entityId, geoId: alert.geoId ?? null, eventId: alert.eventId, edgeId: ev?.edgeId ?? null });
    setTab('entity');
    setAlerts((a) => [alert, ...a]);
    setUnseen((u) => u + 1);
    pushToast({ tone: alert.severity === 'critical' ? 'critical' : 'warning', title: alert.title, detail: alert.detail, alert });
    if (soundOn) playAlertTone(alert.severity);
  }, [c, pushToast, soundOn]);

  const focusAlert = useCallback(
    (a: LiveAlert) => {
      const target = cases.find((x) => x.id === a.caseId);
      if (!target) return;
      setActiveId(a.caseId);
      setPlayhead(null);
      setIsPlaying(false);
      const ev = target.timeline.find((e) => e.id === a.eventId);
      setSelection({ entityId: a.entityId, geoId: a.geoId ?? null, eventId: a.eventId, edgeId: ev?.edgeId ?? null });
      setTab('entity');
      setHistoryOpen(false);
    },
    [cases],
  );

  // ── Live blockchain lookup ──
  const runChainLookup = useCallback(async (q: string) => {
    const req = ++chainReq.current;
    setChain({ status: 'loading', query: q, result: null });
    setChainStatus('checking');
    setTab('chain');
    const r = await fetchPublicBitcoinInfo(q);
    if (req !== chainReq.current) return;
    setChain({ status: 'done', query: q, result: r });
    setChainStatus(r.live ? 'online' : 'offline');
  }, []);

  // ── Smart search ──
  const handleSearch = useCallback(
    (q: string) => {
      const det = detectInput(q);
      const hits = findCasesByIdentifier(q, cases);
      if (hits.length) {
        const h = hits.find((x) => x.field === 'primary_key' || x.field === 'case_id') ?? hits[0];
        openCase(h.caseId, h.entityId, h.edgeId);
        const others = [...new Set(hits.map((x) => x.caseId))].filter((id) => id !== h.caseId);
        pushToast({
          tone: 'success',
          title: `พบ "${shortId(q, 12, 6)}" ในคดี ${h.caseId}`,
          detail: others.length ? `ปรากฏในคดีอื่นด้วย: ${others.join(', ')} — ดูแท็บเครือข่ายข้ามคดี` : `ตรงกับ ${det.label} ในฐานข้อมูลคดี`,
        });
        return;
      }
      const syn = synthesizeCase(q, det, cases.map((x) => x.id));
      setCases((prev) => [...prev, syn]);
      setActiveId(syn.id);
      setPlayhead(null);
      setIsPlaying(false);
      setSelection(initialSelection(syn));
      setTab('entity');
      pushToast({
        tone: 'info',
        title: `ไม่พบในฐานข้อมูล — สังเคราะห์คดี ${syn.id}`,
        detail: `Dynamic Case Synthesis จากรูปแบบ "${det.label}" · ความเสียหายจำลอง ${fmtMoney(syn.lossAmount, 'THB')} (ต้องยืนยันข้อมูลจริง)`,
      });
      if (isBtcAddress(q) || isBtcTxid(q)) void runChainLookup(q);
    },
    [cases, openCase, pushToast, runChainLookup],
  );

  // ── Method toggle ──
  const changeMethod = useCallback(
    (m: TaintMethod) => {
      if (m === method) return;
      setMethod(m);
      const r = computeCaseTaint(c, m, asOf);
      pushToast({ tone: 'info', title: `คำนวณใหม่ด้วย ${METHOD_LABEL[m]}`, detail: `ยอดปนเปื้อนที่ยังอายัดได้ ≈ ${fmtMoney(r.totals.recoverableTHB, 'THB', { decimals: 0 })} · ถอนเป็นเงินสดแล้ว ${fmtMoney(r.totals.cashedOutTHB, 'THB', { decimals: 0 })}` });
    },
    [method, c, asOf, pushToast],
  );

  // ── Evidence export ──
  const exportCase = useCallback(
    async (kind: 'json' | 'md') => {
      const bundle = { c, method, taint: fullTaint, risk, links, targets: computeInterceptionTargets(c, fullTaint, links, simNow), exportedAt: Date.now() };
      const json = buildCaseJSON(bundle);
      const hash = await sha256Hex(json);
      if (kind === 'json') downloadText(`${c.id}_evidence_${method}.json`, json, 'application/json');
      else downloadText(`${c.id}_report_${method}.md`, buildCaseMarkdown(bundle, hash), 'text/markdown');
      pushToast({ tone: 'success', title: `ส่งออกหลักฐาน ${kind === 'json' ? 'JSON' : 'Markdown'} แล้ว`, detail: `${c.id} · SHA-256 ${hash.slice(0, 20)}…` });
    },
    [c, method, fullTaint, risk, links, simNow, pushToast],
  );

  // ── Keyboard shortcuts (Space = play/pause, → = step, L = live alert) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (doc || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') step();
      else if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey) injectLive();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, togglePlay, step, injectLive]);

  const openDoc = useCallback((type: DocumentType, entityId: string) => setDoc({ type, entityId }), []);
  const liveTotal = alerts.length;

  return (
    <div className="flex min-h-screen flex-col bg-ops-bg xl:h-screen xl:overflow-hidden">
      <TopCommandBar
        activeCase={c}
        risk={risk}
        cases={cases}
        caseRisks={caseRisks}
        method={method}
        onMethodChange={changeMethod}
        isPlaying={isPlaying}
        playhead={playhead}
        total={total}
        onPlayToggle={togglePlay}
        onStep={step}
        onReset={reset}
        onInjectLive={injectLive}
        onExport={(k) => void exportCase(k)}
        onSearch={handleSearch}
        onOpenCase={(id) => openCase(id)}
        onOpenChain={() => setTab('chain')}
        searchIndex={searchIndex}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn((s) => !s)}
        chainStatus={chainStatus}
        liveAlertTotal={liveTotal}
        unseenAlerts={unseen}
        onAlertsClick={() => {
          setHistoryOpen(true);
          setUnseen(0);
        }}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(370px,410px)] xl:grid-rows-[minmax(0,1.32fr)_minmax(0,1fr)]">
        <section className="h-[72vh] min-h-[460px] overflow-hidden rounded-lg border border-ops-line bg-ops-card/40 lg:col-span-2 lg:h-[64vh] xl:col-span-1 xl:col-start-1 xl:row-start-1 xl:h-auto xl:min-h-0" aria-label="Money flow graph">
          <MoneyFlowGraph
            c={c}
            taint={taint}
            method={method}
            selection={selection}
            revealedEntities={revealed?.ents ?? null}
            revealedEdges={revealed?.edges ?? null}
            currentEdgeId={currentEvent?.edgeId ?? null}
            currentEntityId={currentEvent?.entityId ?? null}
            links={links}
            targets={targets}
            onSelectEntity={selectEntity}
            onSelectEdge={selectEdge}
          />
        </section>
        <section className="h-[64vh] min-h-[400px] overflow-hidden rounded-lg border border-ops-line bg-ops-card/40 lg:h-[76vh] xl:col-start-1 xl:row-start-2 xl:h-auto xl:min-h-0" aria-label="Tactical map">
          <TacticalMap c={c} geos={visibleGeos} selection={selection} onSelectGeo={selectGeo} onOpenDoc={openDoc} now={now} />
        </section>
        <section className="h-[85vh] min-h-[480px] overflow-hidden rounded-lg border border-ops-line bg-ops-card/40 lg:h-[76vh] xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:h-auto xl:min-h-0" aria-label="Forensic inspector">
          <InspectorPanel
            c={c}
            taint={taint}
            taintAlt={taintAlt}
            method={method}
            selection={selection}
            risk={risk}
            links={links}
            targets={targets}
            now={now}
            tab={tab}
            onTabChange={setTab}
            onSelectEntity={selectEntity}
            onSelectGeo={selectGeo}
            onSelectEdge={selectEdge}
            onOpenDoc={openDoc}
            onOpenCase={(id, ent) => openCase(id, ent)}
            chain={chain}
            onChainLookup={(q) => void runChainLookup(q)}
          />
        </section>
      </main>

      <TimelineStrip
        c={c}
        events={events}
        revealedCount={revealedCount}
        inPlayback={playhead !== null}
        isPlaying={isPlaying}
        selectedEventId={selection.eventId}
        onSelectEvent={selectEvent}
        onJumpLive={jumpLive}
        now={now}
      />

      {doc && (
        <ActionDocumentModal
          key={`${c.id}-${doc.type}-${doc.entityId}`}
          c={c}
          initialType={doc.type}
          initialEntityId={doc.entityId}
          taint={fullTaint}
          method={method}
          links={links}
          onClose={() => setDoc(null)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} onFocusAlert={focusAlert} />
      {historyOpen && <AlertHistory alerts={alerts} onClose={() => setHistoryOpen(false)} onFocusAlert={focusAlert} />}
    </div>
  );
}
