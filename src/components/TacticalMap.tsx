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

function MapController({ caseId, geos, focus, fitNonce }: { caseId: string; geos: GeoEvent[]; focus: GeoEvent | null; fitNonce: number }) {
  const map = useMap();
  const geosRef = useRef(geos);
  geosRef.current = geos;

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    const g = geosRef.current;
    if (!g.length) return;
    if (g.length === 1) map.flyTo([g[0].lat, g[0].lng], 15, { duration: 0.8 });
    else map.flyToBounds(L.latLngBounds(g.map((x) => [x.lat, x.lng] as [number, number])).pad(0.3), { duration: 0.9, maxZoom: 15 });
  }, [caseId, fitNonce, map]);

  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.85 });
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
      <PaneHeader icon={Radar} title="พิกัดยุทธวิธี & เส้นทางเคลื่อนที่" badge="LIVE TACTICAL GEOLOCATION" accent="#ef4444">
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
                  <div className="text-[10.5px] text-slate-400">{g.locationName}</div>
                  <div className="num text-[10px] text-slate-400">
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
            <div className="rounded-lg border border-ops-line bg-ops-bar/90 px-4 py-3 text-center text-[12px] text-slate-400">
              ยังไม่มีพิกัด ณ เวลานี้ของไทม์ไลน์
              <div className="num text-[10px] text-slate-600">NO GEO FIX IN PLAYBACK WINDOW</div>
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

        <div className="pointer-events-none absolute bottom-2 left-2 z-[800] flex flex-wrap gap-1.5 rounded-lg border border-ops-line bg-ops-bar/85 px-2 py-1.5 backdrop-blur">
          {(['ip_login', 'atm_withdrawal', 'cell_ping', 'device_telemetry'] as const).map((t) => (
            <span key={t} className="num flex items-center gap-1 text-[9.5px] text-slate-400">
              <span className={cx('inline-block size-2 border border-slate-400', t === 'atm_withdrawal' ? 'rounded-[2px]' : 'rounded-full')} />
              {GEO_TYPE_LABEL[t].en}
            </span>
          ))}
          <span className="num flex items-center gap-1 text-[9.5px] text-red-300">
            <span className="inline-block size-2.5 rounded-full border border-dashed border-red-400" /> SEARCH RADIUS
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
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerHeight < 950);
  return (
    <div className="thin-scroll absolute right-2 top-2 z-[1000] max-h-[calc(100%-16px)] w-[min(300px,calc(100%-16px))] overflow-y-auto rounded-lg border border-ops-line2 bg-ops-bar/92 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-ops-line px-2.5 py-1.5">
        <Crosshair className="size-3.5" style={{ color }} />
        <span className="num shrink-0 whitespace-nowrap text-[10px] font-semibold tracking-wider text-slate-300">
          {isLatest ? 'LATEST' : 'SELECTED'} #{seq}
        </span>
        <Tag color={color}>{GEO_TYPE_LABEL[g.type].en}</Tag>
        {g.isLive && <Tag color="#ef4444" solid>LIVE</Tag>}
        <span className="ml-auto truncate whitespace-nowrap text-[10px] text-slate-500">{fmtAgo(g.timestamp, now)}</span>
        <button type="button" onClick={() => setCollapsed((v) => !v)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-white" aria-label={collapsed ? 'ขยาย HUD' : 'ย่อ HUD'} aria-expanded={!collapsed}>
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </div>
      {collapsed ? (
        <div className="num truncate px-2.5 py-1.5 text-[11px] text-slate-300">
          {g.terminalId ?? g.ip ?? entity?.identifier} · <span className="text-sky-200">{fmtCoord(g.lat, g.lng)}</span>
          {seg && <span className="text-slate-500"> · Δ {fmtDistance(seg.distanceM)} / {fmtDuration(seg.dtMs)}</span>}
        </div>
      ) : (
      <div className="space-y-1.5 px-2.5 py-2">
        <div>
          <div className="num truncate text-[12.5px] font-semibold text-slate-50">{g.terminalId ?? g.ip ?? entity?.identifier}</div>
          <div className="truncate text-[11px] text-slate-400" title={g.locationName}>
            {g.locationName}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="num flex-1 rounded border border-ops-line bg-ops-bg px-1.5 py-0.5 text-[11px] text-sky-200">GPS {fmtCoord(g.lat, g.lng)}</span>
          <CopyButton text={`${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`} title="คัดลอกพิกัด GPS" />
          <a
            href={`https://www.google.com/maps?q=${g.lat},${g.lng}`}
            target="_blank"
            rel="noreferrer noopener"
            title="เปิดใน Google Maps"
            className="inline-flex items-center rounded-md border border-ops-line px-1.5 py-0.5 text-slate-400 hover:text-slate-100"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="num grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10.5px]">
          {g.ip && (
            <>
              <span className="text-slate-500">IP / ASN</span>
              <span className="truncate text-right text-slate-200">{g.ip} · {g.asn?.split(' ')[0]}</span>
            </>
          )}
          {g.cellId && (
            <>
              <span className="text-slate-500">CELL</span>
              <span className="truncate text-right text-slate-200">{g.cellId}</span>
            </>
          )}
          {g.amount !== undefined && (
            <>
              <span className="text-slate-500">ถอน</span>
              <span className="text-right text-red-300">{fmtMoney(g.amount, g.currency ?? 'THB')}</span>
            </>
          )}
          <span className="text-slate-500">เวลา</span>
          <span className="text-right text-slate-200">{fmtTime(g.timestamp)} ICT</span>
          {g.accuracyM && (
            <>
              <span className="text-slate-500">ความแม่นยำ</span>
              <span className="text-right text-slate-200">±{g.accuracyM} m</span>
            </>
          )}
        </div>
        {seg && (
          <div className="grid grid-cols-3 gap-1 rounded-md border border-ops-line bg-ops-bg/70 p-1.5">
            <div>
              <div className="flex items-center gap-1 text-[9.5px] text-slate-500"><Navigation className="size-2.5" />Δd</div>
              <div className="num text-[11.5px] font-semibold text-slate-100">{fmtDistance(seg.distanceM)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[9.5px] text-slate-500"><Clock className="size-2.5" />Δt</div>
              <div className="num text-[11.5px] font-semibold text-slate-100">{fmtDuration(seg.dtMs)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[9.5px] text-slate-500"><Gauge className="size-2.5" />v̄</div>
              <div className="num text-[11.5px] font-semibold text-slate-100">{seg.speedKmh.toFixed(1)} km/h</div>
            </div>
            <div className="col-span-3 text-[10px] text-slate-500">
              จาก #{seq - 1} · ทิศ{dir?.th} <span className="num">({dir?.en} {Math.round(seg.bearing)}°)</span>
            </div>
          </div>
        )}
        {isLatest && (
          <div className="flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1">
            <span className="text-[10.5px] text-red-200">รัศมีค้นหา / ลาดตระเวน</span>
            <span className="num text-[11px] font-semibold text-red-100">
              {radius.toLocaleString('en-US')} m · {circleAreaKm2(radius).toFixed(2)} km²
            </span>
          </div>
        )}
        {props.atmEntityId && (
          <button
            type="button"
            onClick={() => props.onOpenDoc('atm_cctv_request', props.atmEntityId!)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/15 py-1 text-[11px] font-semibold text-red-100 hover:bg-red-500/25"
          >
            <Cctv className="size-3.5" /> ขอภาพ CCTV ตู้ ATM นี้
          </button>
        )}
      </div>
      )}
    </div>
  );
}
