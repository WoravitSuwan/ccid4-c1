import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cctv, Check, Copy, FileSearch, Printer, ShieldAlert, Snowflake, X, type LucideIcon } from 'lucide-react';
import type { CaseTaintResult, CrossCaseLink, DocSigner, DocumentType, InvestigationCase, TaintMethod } from '../types/investigation';
import { DOC_TYPE_META, buildOfficialDocument, defaultSigner, eligibleEntities } from '../utils/documents';
import { copyText } from '../utils/browser';
import { METHOD_LABEL, shortId, toThaiDigits } from '../utils/format';
import { ENTITY_META, cx } from './ui';

interface Props {
  c: InvestigationCase;
  initialType: DocumentType;
  initialEntityId: string;
  taint: CaseTaintResult;
  method: TaintMethod;
  links: CrossCaseLink[];
  onClose: () => void;
}

const TYPE_ICON: Record<DocumentType, LucideIcon> = {
  freeze_request: Snowflake,
  kyc_ip_request: FileSearch,
  atm_cctv_request: Cctv,
};

const SIGNER_KEY = 'ccib.doc.signer.v1';
function loadSigner(c: InvestigationCase): DocSigner {
  const d = defaultSigner(c);
  try {
    const raw = localStorage.getItem(SIGNER_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<DocSigner> & { caseId?: string };
      return { ...d, rank: s.rank || d.rank, name: s.name || d.name, position: s.position || d.position };
    }
  } catch {
    /* storage unavailable */
  }
  return d;
}

export default function ActionDocumentModal({ c, initialType, initialEntityId, taint, method, links, onClose }: Props) {
  const [type, setType] = useState<DocumentType>(initialType);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [signer, setSigner] = useState<DocSigner>(() => loadSigner(c));
  const [thaiDigits, setThaiDigits] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const now = useMemo(() => Date.now(), []);

  const eligible = useMemo(() => eligibleEntities(type, c), [type, c]);
  useEffect(() => {
    if (!eligible.some((e) => e.id === entityId) && eligible[0]) setEntityId(eligible[0].id);
  }, [eligible, entityId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    try {
      localStorage.setItem(SIGNER_KEY, JSON.stringify({ rank: signer.rank, name: signer.name, position: signer.position }));
    } catch {
      /* ignore */
    }
  }, [signer.rank, signer.name, signer.position]);

  const entity = c.entities.find((e) => e.id === entityId) ?? eligible[0];
  const nodeTaint = entity ? taint.nodes[entity.id] : undefined;
  const doc = useMemo(
    () =>
      entity && nodeTaint
        ? buildOfficialDocument(type, { c, entity, taint: nodeTaint, edgeTaint: taint.edges, method, signer, links, now, thaiDigits })
        : null,
    [type, c, entity, nodeTaint, taint.edges, method, signer, links, now, thaiDigits],
  );

  const field = (k: keyof DocSigner, label: string) => (
    <label className="block">
      <span className="text-[11.5px] text-slate-300">{label}</span>
      <input
        value={signer[k]}
        onChange={(e) => setSigner((s) => ({ ...s, [k]: e.target.value }))}
        className="mt-0.5 w-full rounded-md border border-ops-line2 bg-ops-bg px-2 py-1.5 text-[12px] text-slate-100 focus:border-sky-400/70 focus:outline-none"
      />
    </label>
  );

  return createPortal(
    <div className="print-reset fixed inset-0 z-[3000] flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label="บันทึกข้อความด่วน บช.สอท.">
      <div className="print-reset flex h-full max-h-[94vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-ops-line2 bg-ops-bar shadow-2xl shadow-black/70 lg:flex-row">
        {/* Controls */}
        <aside className="no-print thin-scroll flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-ops-line p-3 lg:w-[310px] lg:border-r lg:border-b-0">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-5 text-fuchsia-300" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-slate-50">บันทึกข้อความด่วน บช.สอท.</h2>
              <p className="num text-[10px] tracking-wider text-slate-400">OFFICIAL POLICE DOCUMENT GENERATOR</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-md border border-ops-line p-1 text-slate-400 hover:text-white" aria-label="ปิด">
              <X className="size-4" />
            </button>
          </div>

          <div>
            <div className="mb-1 text-[11.5px] text-slate-300">ประเภทเอกสาร</div>
            <div className="grid gap-1.5">
              {(Object.keys(DOC_TYPE_META) as DocumentType[]).map((k) => {
                const Icon = TYPE_ICON[k];
                const n = eligibleEntities(k, c).length;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={n === 0}
                    onClick={() => setType(k)}
                    className={cx(
                      'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35',
                      type === k ? 'border-fuchsia-400/60 bg-fuchsia-500/10' : 'border-ops-line hover:border-ops-line2',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-fuchsia-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-slate-100">{DOC_TYPE_META[k].th}</span>
                      <span className="num block text-[10.5px] tracking-wider text-slate-300">{DOC_TYPE_META[k].en} · {n} เป้าหมาย</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="text-[11.5px] text-slate-300">เป้าหมาย (Entity)</span>
            <select
              value={entity?.id ?? ''}
              onChange={(e) => setEntityId(e.target.value)}
              className="num mt-0.5 w-full rounded-md border border-ops-line2 bg-ops-bg px-2 py-1.5 text-[11.5px] text-slate-100 focus:border-sky-400/70 focus:outline-none"
            >
              {eligible.map((e) => (
                <option key={e.id} value={e.id}>
                  {ENTITY_META[e.type].en} · {e.institution} · {shortId(e.identifier, 10, 5)}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5 rounded-lg border border-ops-line p-2.5">
            <div className="text-[10.5px] font-semibold text-slate-300">ผู้ลงนาม / เลขที่หนังสือ</div>
            {field('rank', 'ยศ')}
            {field('name', 'ชื่อ-สกุล')}
            {field('position', 'ตำแหน่ง')}
            {field('docNo', 'ที่ (เลขที่หนังสือ)')}
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-ops-line px-2.5 py-2">
            <span>
              <span className="block text-[12px] text-slate-200">ใช้เลขไทย (๑๒๓)</span>
              <span className="block text-[10px] text-slate-400">ตัวเลขในเนื้อความ — เลขบัญชี/TxID คงเลขอารบิก</span>
            </span>
            <input type="checkbox" checked={thaiDigits} onChange={(e) => setThaiDigits(e.target.checked)} className="size-4 accent-fuchsia-500" />
          </label>

          <div className="rounded-lg border border-ops-line bg-ops-bg/60 p-2.5 text-[10.5px] leading-relaxed text-slate-400">
            ข้อมูลเติมอัตโนมัติจากคดี <span className="num text-slate-200">{c.id}</span> · เอนทิตี · Taint ({METHOD_LABEL[method]}) · ATM/IP/GPS · Cross-case
          </div>

          <div className="mt-auto grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={async () => {
                if (doc && (await copyText(doc.plainText))) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }
              }}
              className={cx('flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[12px] font-semibold', copied ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-ops-line2 bg-ops-card text-slate-100 hover:bg-ops-raised')}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}
            </button>
            <button type="button" onClick={() => window.print()} className="flex items-center justify-center gap-1.5 rounded-md bg-sky-500 px-2 py-2 text-[12px] font-semibold text-ops-bg hover:bg-sky-400">
              <Printer className="size-4" /> พิมพ์ / PDF
            </button>
          </div>
        </aside>

        {/* A4 preview */}
        <div className="print-reset thin-scroll min-h-0 flex-1 overflow-auto bg-[#1a2234] p-3 sm:p-6">
          {doc ? (
            <article id="print-sheet" className="mx-auto w-full max-w-[794px] bg-white px-[7%] py-[6%] font-doc text-[15.5px] leading-[1.75] text-black shadow-2xl shadow-black/50">
              <div className="flex justify-end">
                <span className="rounded border-2 border-red-700 px-3 py-0.5 text-[17px] font-bold text-red-700">{doc.urgency}</span>
              </div>
              <h1 className="mt-1 text-center text-[27px] font-bold tracking-wide">บันทึกข้อความ</h1>
              <div className="mt-3 space-y-1">
                <p><b>ส่วนราชการ</b>&nbsp; {doc.agency}</p>
                <div className="flex flex-wrap justify-between gap-x-6">
                  <p><b>ที่</b>&nbsp; {doc.docNo}</p>
                  <p><b>วันที่</b>&nbsp; {doc.dateText}</p>
                </div>
                <p><b>เรื่อง</b>&nbsp; {doc.subject}</p>
              </div>
              <hr className="my-3 border-black/60" />
              <p><b>เรียน</b>&nbsp; {doc.recipient}</p>
              <p><b>อ้างถึง</b>&nbsp; <span className="font-sans text-[13px]">{doc.reference}</span></p>
              <p>
                <b>สิ่งที่ส่งมาด้วย</b>&nbsp; {doc.attachments.map((a, i) => (
                  <span key={a} className="block pl-[2.5em]">{`${thaiDigits ? toThaiDigits(String(i + 1)) : i + 1}. ${a}`}</span>
                ))}
              </p>
              <div className="mt-3 space-y-2.5">
                {doc.blocks.map((b, i) => {
                  if (b.kind === 'para')
                    return (
                      <div key={i}>
                        {b.heading && <p className="font-bold">{b.heading}</p>}
                        <p className="indent-[2.5em] text-justify">{b.text}</p>
                      </div>
                    );
                  if (b.kind === 'math')
                    return (
                      <p key={i} className="rounded border border-black/20 bg-black/[0.035] px-3 py-1.5 font-mono text-[11.5px] leading-relaxed">
                        [การคำนวณ] {b.text}
                      </p>
                    );
                  if (b.kind === 'bullets')
                    return (
                      <div key={i}>
                        {b.heading && <p className="font-bold">{b.heading}</p>}
                        <ol className="space-y-0.5 pl-[2.5em]">
                          {b.items.map((it, j) => (
                            <li key={j} className="text-justify">
                              ({thaiDigits ? toThaiDigits(String(j + 1)) : j + 1}) {it}
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  return (
                    <div key={i} className="overflow-x-auto">
                      <p className="mb-1 text-[13.5px] font-semibold">{b.caption}</p>
                      <table className="w-full border-collapse text-[11.5px] leading-snug">
                        <thead>
                          <tr>
                            {b.headers.map((h) => (
                              <th key={h} className="border border-black/50 bg-black/[0.06] px-1.5 py-1 text-left font-semibold">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {b.rows.map((r, j) => (
                            <tr key={j}>
                              {r.map((cell, k) => (
                                <td key={k} className={cx('border border-black/40 px-1.5 py-1 align-top', k === 4 && 'break-all font-mono text-[10px]')}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 indent-[2.5em] text-justify">{doc.closing}</p>
              <div className="mt-10 ml-auto w-fit min-w-[55%] text-center">
                <p>(ลงชื่อ) ...........................................</p>
                <p>({doc.signer.rank} {doc.signer.name})</p>
                <p>{doc.signer.position}</p>
              </div>
              <p className="mt-8 border-t border-black/20 pt-2 font-sans text-[10.5px] leading-snug text-black/55">หมายเหตุ: {doc.disclaimer}</p>
            </article>
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-slate-400">ไม่มีเป้าหมายที่เหมาะสมสำหรับเอกสารประเภทนี้ในคดีนี้</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
