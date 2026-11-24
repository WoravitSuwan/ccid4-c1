import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import { Cctv, ChevronDown, ChevronUp, Clock, Crosshair, ExternalLink, Gauge, LocateFixed, Maximize, Navigation, Radar, Route } from 'lucide-react';
import type { DocumentType, FlowEntity, GeoEvent, InvestigationCase, Selection } from '../types/investigation';
import { GEO_TYPE_LABEL, circleAreaKm2, compass, movementSegments, sortGeo, type MovementSegment } from '../utils/geo';
import { fmtAgo, fmtCoord, fmtDistance, fmtDuration, fmtMoney, fmtTime } from '../utils/format';
import { CopyButton, ENTITY_META, IconButton, PaneHeader, Tag, cx } from './ui';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const iconCache = new Map<string, L.DivIcon>();
function markerIcon(seq: number, color: string, type: GeoEvent['type'], latest: boolean, selected: boolean): L.DivIcon {
  const key = `${seq}|${color}|${type}|${latest}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const cls = ['geo-marker', latest && 'is-latest', selected && 'is-selected', type === 'atm_withdrawal' && 'is-atm'].filter(Boolean).join(' ');
    icon = L.divIcon({
      className: '',
      html: `<div class="${cls}" style="--mc:${color}"><span class="ring"></span><span class="ring r2"></span><span class="core">#${seq}</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      tooltipAnchor: [0, -16],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

const segIcon = (text: string) =>
  L.divIcon({ className: '', html: `<span class="seg-label">${text}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] });
const arrowIcon = (bearing: number, color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%) rotate(${bearing - 90}deg);color:${color};font-size:15px;line-height:1;text-shadow:0 0 6px ${color}">➤</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const HUD_W = 330;
/** Right-hand space taken by the telemetry card, so fits and fly-tos keep points visible beside it. */
const hudReserve = (map: L.Map) => (map.getSize().x >= 680 ? HUD_W + 16 : 0);

function MapController({ caseId, geos, focus, fitNonce }: { caseId: string; geos: GeoEvent[]; focus: GeoEvent | null; fitNonce: number }) {
  const map = useMap();
  const geosRef = useRef(geos);
  geosRef.current = geos;

  // Leaflet needs a size recalculation whenever its container changes (grid resize, first paint, tab switch)
  useEffect(() => {
    const el = map.getContainer();
    const timers = [0, 120, 400].map((ms) => setTimeout(() => map.invalidateSize({ pan: false }), ms));
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });
    ro.observe(el);
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [map]);

  useEffect(() => {
    const g = geosRef.current;
    if (!g.length) return;
    const right = hudReserve(map);
    if (g.length === 1) {
      const z = 15;
      map.flyTo(map.unproject(map.project([g[0].lat, g[0].lng], z).add([right / 2, 0]), z), z, { duration: 0.8 });
    } else {
      map.flyToBounds(L.latLngBounds(g.map((x) => [x.lat, x.lng] as [number, number])), {
        duration: 0.9,
        maxZoom: 15,
        paddingTopLeft: [48, 48],
        paddingBottomRight: [right + 32, 56],
      });
    }
  }, [caseId, fitNonce, map]);

  useEffect(() => {
    if (!focus) return;
    const z = Math.max(map.getZoom(), 15);
    const shift = hudReserve(map) / 2; // keep the point left of the telemetry card
    map.flyTo(map.unproject(map.project([focus.lat, focus.lng], z).add([shift, 0]), z), z, { duration: 0.85 });
  }, [focus?.id, focus?.lat, focus?.lng, map]);
  return null;
}

interface Props {
  c: InvestigationCase;
  geos: GeoEvent[];
  selection: Selection;
  onSelectGeo: (geoId: string) => void;
  onOpenDoc: (type: DocumentType, entityId: string) => void;
  now: number;
}

export default function TacticalMap({ c, geos, selection, onSelectGeo, onOpenDoc, now }: Props) {
  const [fitNonce, setFitNonce] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const sorted = useMemo(() => sortGeo(geos), [geos]);
  const seqOf = useMemo(() => {
    const all = sortGeo(c.geoEvents);
    return new Map(all.map((g, i) => [g.id, i + 1]));
  }, [c.geoEvents]);
  const entityOf = useMemo(() => new Map<string, FlowEntity>(c.entities.map((e) => [e.id, e])), [c.entities]);
  const segments = useMemo(() => movementSegments(sorted), [sorted]);
  const latest = sorted.at(-1) ?? null;
  const selected = selection.geoId ? sorted.find((g) => g.id === selection.geoId) ?? null : null;
  const focusGeo = selected;
  const hudGeo = selected ?? latest;
  const hudSeg: MovementSegment | undefined = hudGeo ? segments.find((s) => s.to.id === hudGeo.id) : undefined;
  const radius = latest?.searchRadiusM ?? c.searchRadiusM;
  const colorOf = (g: GeoEvent) => ENTITY_META[entityOf.get(g.entityId)?.type ?? 'mule_bank'].color;
  const center: [number, number] = latest ? [latest.lat, latest.lng] : [13.7563, 100.5018];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader icon={Radar} title="พิกัดจุดเกิดเหตุ & เส้นทางเคลื่อนที่" badge="LIVE TACTICAL GEO" accent="#ef4444">
        <IconButton title={showLabels ? 'ซ่อนป้ายระยะทาง' : 'แสดงป้ายระยะทาง'} onClick={() => setShowLabels((v) => !v)} active={showLabels}>
          <Route className="size-3.5" />
        </IconButton>
        <IconButton title="แสดงทุกจุด (Fit all)" onClick={() => setFitNonce((n) => n + 1)}>
          <Maximize className="size-3.5" />
        </IconButton>
        {latest && (
          <IconButton title="ไปยังจุดล่าสุด" onClick={() => onSelectGeo(latest.id)}>
            <LocateFixed className="size-3.5" />
          </IconButton>
        )}
      </PaneHeader>

      <div className="relative min-h-0 flex-1">
        <MapContainer center={center} zoom={14} zoomControl={false} className="absolute inset-0" worldCopyJump={false}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" maxZoom={20} detectRetina={false} />
          <ZoomControl position="bottomright" />
          <MapController caseId={c.id} geos={sorted} focus={focusGeo} fitNonce={fitNonce} />

          {sorted.length > 1 && (
            <>
              <Polyline positions={sorted.map((g) => [g.lat, g.lng])} pathOptions={{ color: '#38bdf8', weight: 9, opacity: 0.12, lineCap: 'round' }} interactive={false} />
              <Polyline positions={sorted.map((g) => [g.lat, g.lng])} pathOptions={{ color: '#7dd3fc', weight: 2.5, opacity: 0.95, className: 'trajectory-dash' }} interactive={false} />
            </>
          )}

          {showLabels &&
            segments.map((s) => {
              const mid: [number, number] = [(s.from.lat + s.to.lat) / 2, (s.from.lng + s.to.lng) / 2];
              const at70: [number, number] = [s.from.lat + (s.to.lat - s.from.lat) * 0.78, s.from.lng + (s.to.lng - s.from.lng) * 0.78];
              return (
                <Fragment key={`${s.from.id}-${s.to.id}`}>
                  <Marker position={at70} icon={arrowIcon(s.bearing, '#7dd3fc')} interactive={false} keyboard={false} />
                  <Marker
                    position={mid}
                    icon={segIcon(`${fmtDistance(s.distanceM)} · ${fmtDuration(s.dtMs)} · ${s.speedKmh.toFixed(1)} km/h`)}
                    interactive={false}
                    keyboard={false}
                  />
                </Fragment>
              );
            })}

          {latest && (
            <Circle
              center={[latest.lat, latest.lng]}
              radius={radius}
              pathOptions={{ color: '#ef4444', weight: 1.5, dashArray: '6 6', fillColor: '#ef4444', fillOpacity: 0.07 }}
              interactive={false}
            />
          )}
          {!!hudGeo?.accuracyM && (
            <Circle center={[hudGeo.lat, hudGeo.lng]} radius={hudGeo.accuracyM} pathOptions={{ color: '#e2e8f0', weight: 1, opacity: 0.6, fillOpacity: 0.04 }} interactive={false} />
          )}

          {sorted.map((g) => {
            const seq = seqOf.get(g.id) ?? 0;
            const ent = entityOf.get(g.entityId);
            return (
              <Marker
                key={g.id}
                position={[g.lat, g.lng]}
                icon={markerIcon(seq, colorOf(g), g.type, g.id === latest?.id, g.id === selection.geoId)}
                eventHandlers={{ click: () => onSelectGeo(g.id) }}
                zIndexOffset={g.id === latest?.id ? 1000 : g.id === selection.geoId ? 900 : seq * 10}
                keyboard
                title={`#${seq} ${GEO_TYPE_LABEL[g.type].en}`}
              >
                <Tooltip direction="top" className="ops-tip" opacity={1}>
                  <div className="num text-[10px] tracking-wide" style={{ color: colorOf(g) }}>
                    #{seq} · {GEO_TYPE_LABEL[g.type].en}
                    {g.isLive ? ' · LIVE' : ''}
                  </div>
                  <div className="font-sans text-[11.5px] font-semibold text-slate-100">{g.terminalId ?? g.ip ?? ent?.identifier}</div>
                  <div className="text-[11px] text-slate-300">{g.locationName}</div>
                  <div className="num text-[10.5px] text-slate-300">
                    {fmtTime(g.timestamp)} · {fmtCoord(g.lat, g.lng)}
                    {g.amount ? ` · ${fmtMoney(g.amount, g.currency ?? 'THB')}` : ''}
                  </div>
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>

        {/* scanline sheen */}
        <div className="pointer-events-none absolute inset-0 z-[401] overflow-hidden opacity-[0.07]">
          <div className="h-1/3 w-full bg-gradient-to-b from-transparent via-sky-300 to-transparent" style={{ animation: 'scan 6s linear infinite' }} />
        </div>

        {!sorted.length && (
          <div className="absolute inset-0 z-[500] grid place-items-center">
            <div className="rounded-lg border border-ops-line2 bg-ops-bar/95 px-4 py-3 text-center text-[13px] text-slate-200">
              ยังไม่มีพิกัด ณ เวลานี้ของไทม์ไลน์
              <div className="num text-[11px] text-slate-400">NO GEO FIX IN PLAYBACK WINDOW</div>
            </div>
          </div>
        )}

        {hudGeo && (
          <TelemetryHUD
            g={hudGeo}
            seq={seqOf.get(hudGeo.id) ?? 0}
            seg={hudSeg}
            isLatest={hudGeo.id === latest?.id}
            entity={entityOf.get(hudGeo.entityId)}
            radius={radius}
            latestId={latest?.id}
            now={now}
            color={colorOf(hudGeo)}
            onOpenDoc={onOpenDoc}
            atmEntityId={hudGeo.type === 'atm_withdrawal' ? hudGeo.entityId : undefined}
          />
        )}

        <div className="pointer-events-none absolute bottom-2 left-2 z-[800] flex max-w-[calc(100%-70px)] flex-wrap gap-x-3 gap-y-1 rounded-full border border-ops-line2 bg-ops-bar/95 px-3 py-1.5 backdrop-blur">
          {(['ip_login', 'atm_withdrawal', 'cell_ping', 'device_telemetry'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-200">
              <span className={cx('inline-block size-2.5 border border-slate-300', t === 'atm_withdrawal' ? 'rounded-[2px]' : 'rounded-full')} />
              {GEO_TYPE_LABEL[t].th}
            </span>
          ))}
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-red-200">
            <span className="inline-block size-2.5 rounded-full border border-dashed border-red-400" /> รัศมีค้นหา
          </span>
        </div>
      </div>
    </div>
  );
}

function TelemetryHUD(props: {
  g: GeoEvent;
  seq: number;
  seg?: MovementSegment;
  isLatest: boolean;
  entity?: FlowEntity;
  radius: number;
  latestId?: string;
  now: number;
  color: string;
  atmEntityId?: string;
  onOpenDoc: (type: DocumentType, entityId: string) => void;
}) {
  const { g, seq, seg, isLatest, entity, radius, now, color } = props;
  const dir = seg ? compass(seg.bearing) : null;
  const [showDetails, setShowDetails] = useState(() => typeof window === 'undefined' || window.innerHeight >= 950);
  const headline = g.terminalId ?? g.ip ?? entity?.identifier ?? '—';
  const details: [string, string][] = [
    ...(g.ip ? ([['IP / ASN', `${g.ip} · ${g.asn ?? ''}`]] as [string, string][]) : []),
    ...(g.cellId ? ([['Cell', g.cellId]] as [string, string][]) : []),
    ...(g.device ? ([['อุปกรณ์', g.device]] as [string, string][]) : []),
    ...(g.amount !== undefined ? ([['ยอดถอน', fmtMoney(g.amount, g.currency ?? 'THB')]] as [string, string][]) : []),
    ['เวลา', `${fmtTime(g.timestamp)} ICT`],
    ...(g.accuracyM ? ([['ความแม่นยำ', `±${g.accuracyM} m`]] as [string, string][]) : []),
  ];
  return (
    <div
      className="thin-scroll absolute right-2 top-2 z-[1000] max-h-[calc(100%-16px)] overflow-y-auto rounded-lg border border-ops-line2 bg-ops-bar/95 shadow-2xl shadow-black/60 backdrop-blur"
      style={{ width: `min(${HUD_W}px, calc(100% - 16px))` }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-ops-line2 px-3 py-2">
        <Crosshair className="size-4 shrink-0" style={{ color }} />
        <span className="num whitespace-nowrap text-[11.5px] font-bold tracking-wider text-slate-50">
          {isLatest ? 'LATEST' : 'SELECTED'} #{seq}
        </span>
        <Tag color={color}>{GEO_TYPE_LABEL[g.type].en}</Tag>
        {g.isLive && <Tag color="#ef4444" solid>LIVE</Tag>}
        <span className="ml-auto whitespace-nowrap text-[11px] text-slate-300">{fmtAgo(g.timestamp, now)}</span>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div>
          <div className="num text-[13.5px] font-bold text-slate-50 [overflow-wrap:anywhere]">{headline}</div>
          <div className="text-[12px] leading-snug text-slate-300">{g.locationName}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="num flex-1 whitespace-nowrap rounded-md border border-ops-line2 bg-ops-bg px-2 py-1 text-[12px] text-sky-200">GPS {fmtCoord(g.lat, g.lng)}</span>
          <CopyButton text={`${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`} title="คัดลอกพิกัด GPS" />
          <a
            href={`https://www.google.com/maps?q=${g.lat},${g.lng}`}
            target="_blank"
            rel="noreferrer noopener"
            title="เปิดใน Google Maps"
            className="inline-flex items-center rounded-md border border-ops-line2 px-1.5 py-1 text-slate-300 hover:text-white"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        {seg ? (
          <div className="rounded-md border border-ops-line2 bg-ops-bg/80 px-2 py-1.5">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  [Navigation, 'ระยะทาง', fmtDistance(seg.distanceM)],
                  [Clock, 'เวลา', fmtDuration(seg.dtMs)],
                  [Gauge, 'ความเร็ว', `${seg.speedKmh.toFixed(1)} km/h`],
                ] as const
              ).map(([Icon, label, value]) => (
                <div key={label}>
                  <div className="flex items-center gap-1 whitespace-nowrap text-[10.5px] text-slate-300">
                    <Icon className="size-3" />
                    {label}
                  </div>
                  <div className="num whitespace-nowrap text-[13px] font-bold text-slate-50">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-300">
              จาก #{seq - 1} · ทิศ{dir?.th} <span className="num">({dir?.en} {Math.round(seg.bearing)}°)</span>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-ops-line2 bg-ops-bg/80 px-2 py-1.5 text-[11px] text-slate-300">จุดแรกของเส้นทาง — ยังไม่มีข้อมูลการเคลื่อนที่</div>
        )}
        {isLatest && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-red-400/50 bg-red-500/15 px-2 py-1.5">
            <span className="whitespace-nowrap text-[11.5px] text-red-100">รัศมีค้นหา / ลาดตระเวน</span>
            <span className="num whitespace-nowrap text-[12px] font-bold text-white">
              {radius.toLocaleString('en-US')} m · {circleAreaKm2(radius).toFixed(2)} km²
            </span>
          </div>
        )}
        {props.atmEntityId && (
          <button
            type="button"
            onClick={() => props.onOpenDoc('atm_cctv_request', props.atmEntityId!)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-red-600 py-1.5 text-[12px] font-bold text-white hover:bg-red-500"
          >
            <Cctv className="size-4" /> ขอภาพ CCTV ตู้ ATM นี้
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-[11.5px] text-slate-300 hover:text-white"
        >
          รายละเอียด IP / Cell / อุปกรณ์
          {showDetails ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {showDetails && (
          <dl className="divide-y divide-white/[0.06] rounded-md border border-ops-line2">
            {details.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 px-2 py-1.5">
                <dt className="shrink-0 text-[11px] text-slate-300">{k}</dt>
                <dd className="num text-right text-[11.5px] text-slate-50 [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
