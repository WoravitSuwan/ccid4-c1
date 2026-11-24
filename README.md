# CCIB Cyber-Financial & Geo-Interception Command Center

**ศูนย์บัญชาการสืบสวนเส้นทางการเงินดิจิทัลและพิกัดจุดดักจับแบบเรียลไทม์** — a multi-pane cyber-forensics workspace for Thai Cybercrime Police (บช.สอท.).

An officer types a Thai bank account, crypto wallet, TxID or case ID, or picks a preset case. The workspace then shows the money trail, who the victim's money belongs to at each hop, where the suspect is moving, and the official request documents. No paid API keys are needed.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check (tsc -b) + production build → dist/
npm run preview    # serve the production build
```

Requires Node 20+.

## Workspace layout

- **Command bar, row 1:** the `CCIB COMMAND` brand; the active case pill (case ID, loss, `CRITICAL 92/100`); the `Proportional` / `FIFO` toggle; Play / Pause / Step / Reset; `+ จำลองเหตุการณ์สด`; and one **เครื่องมือ / ส่งออก** menu holding JSON/MD export, Chain API status, the sound toggle and the live-alert history.
- **Command bar, row 2:** a wide smart search with an input-type pill, and single-line presets (`#1 892-4-10928-3`, `#2 0x9f8c…71a4`, `#3 554-2-90184-7`).
- **Main area:** the money-flow graph (with a one-line fund strip on top) above the tactical map. The forensic inspector sits on the right with a sticky action bar: freeze/KYC request, ATM CCTV request, and copy evidence summary.
- **Bottom:** a chronological timeline of 235px cards. The selected card gets a cyan ring.

## What's inside

| Capability | Where |
|---|---|
| **Cross-rail money flow graph** (victim → mule tiers → OTC/bridge → crypto pool → exchange → ATM). Custom entity cards, animated gradient edges with amount, time and taint badges, minimap, auto-arrange/reset layout. Semantic zoom swaps to large-type cards when zoomed out, and the flow switches to top-to-bottom on portrait screens. | `components/MoneyFlowGraph.tsx`, `components/FlowEntityNode.tsx` |
| **Dynamic taint & mixed-fund engine**: `Proportional (Haircut %)` vs `FIFO (First-In, First-Out)`, propagated hop by hop across currencies (THB→USDT at the OTC rate), with a 1-line math explanation per node, a side-by-side method comparison, and a breakdown of where the victim's money is now | `utils/taintEngine.ts` |
| **Tactical map** (Leaflet + CARTO Dark Matter, no key): numbered `L.divIcon` pulse markers, trajectory polyline with distance / Δt / speed labels and bearing arrows, search-radius circle, telemetry HUD | `components/TacticalMap.tsx` |
| **Cross-case linker & risk score**: shared accounts, wallets, device IDs, exchange UIDs, IPs, ATM corridors and laundering patterns. The 0–100 interception-priority score is built from listed factors, and chokepoints are ranked (`Exchange KYC`, `ATM Cash-Out`, `High Taint Pool`, `Bank Freeze`) | `data/mockCases.ts`, `utils/taintEngine.ts` |
| **Live blockchain lookup**: `mempool.space` → `blockstream.info` for BTC TxIDs and addresses. If the network is offline, CORS-blocked or the item isn't found, it falls back to a clearly labelled simulated snapshot | `fetchPublicBitcoinInfo` in `utils/taintEngine.ts` |
| **Real-time simulation**: chronological Play / Pause / Step / Reset (balances are recomputed *as of* the playhead); `+ จำลองความเคลื่อนไหวสด` injects scripted, then balance-aware, live transactions, ATM withdrawals and pings with a sound alert and toast; any unknown query triggers Dynamic Case Synthesis | `utils/liveSimulator.ts` |
| **Synchronized selection**: clicking a graph node, edge, map marker or timeline event selects the same item in every pane | `App.tsx` |
| **Official documents** (*บันทึกข้อความด่วน บช.สอท.*): freeze request, exchange KYC/IP request, ATM CCTV request; auto-filled with case, taint math, ATM/IP/GPS and cross-case evidence. Copy, or Print / Save as PDF (A4) | `components/ActionDocumentModal.tsx`, `utils/documents.ts` |
| **Evidence export**: full JSON bundle and a Markdown case report, both with a SHA-256 integrity hash | `utils/exporters.ts` |

### Preset cases

| Case | Primary key | Loss | Risk |
|---|---|---|---|
| `CCIB-2026-0892` หลอกลงทุนสินทรัพย์ดิจิทัลข้ามแพลตฟอร์ม | `892-4-10928-3` | ฿500,000 | 92 CRITICAL |
| `CCIB-2026-1044` แก๊งคอลเซ็นเตอร์แอบอ้างเจ้าหน้าที่ & ฟอกเงินข้ามชั้น | `0x9f8c44b2…a8c771a4` | ฿850,000 | 88 HIGH |
| `CCIB-2026-1109` บัญชีม้าตระเวนกดเงินสดต่อเนื่อง โซนเชียงใหม่ | `554-2-90184-7` | ฿125,000 | 85 HIGH - ACTIVE CASH-OUT |

Timestamps are anchored to the moment the app opens, so the workspace always reads as a live incident. Try searching `401-9-77210-5`, an account reused in two cases.

### Keyboard

`Space` play/pause · `→` step · `L` inject a live alert · `Esc` close dialogs and menus.

## Notes

- All names and identifiers are masked or synthetic. Generated documents are **drafts**: the inquiry officer must verify the facts, the legal basis and the official format before signing.
- Fonts (IBM Plex Sans Thai, JetBrains Mono, Sarabun) are bundled with `@fontsource`, so the UI and printed memos render the same on restricted or offline networks.
- External services are optional and keyless: CARTO map tiles, mempool.space / blockstream.info, and explorer links (Tronscan / Etherscan / mempool).

**Stack:** React 19 · Vite 7 · TypeScript (strict) · Tailwind CSS v4 · `@xyflow/react` 12 · Leaflet 1.9 + `react-leaflet` 5 · `lucide-react`.
