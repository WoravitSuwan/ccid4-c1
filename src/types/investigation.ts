/**
 * CCIB Command Center — strict domain model
 * ศูนย์บัญชาการสืบสวนเส้นทางการเงินดิจิทัลและพิกัดจุดดักจับแบบเรียลไทม์
 */

// ───────────────────────── Primitive unions ─────────────────────────

export type EntityType = 'victim' | 'mule_bank' | 'crypto_wallet' | 'exchange' | 'cash_out';
export type Currency = 'THB' | 'USDT' | 'BTC';
export type Chain = 'TRC-20' | 'ERC-20' | 'BEP-20' | 'BTC';
export type ThaiBank = 'KBANK' | 'SCB' | 'KTB' | 'BBL' | 'TTB' | 'BAY' | 'GSB';
/** fiat = bank→bank, crypto = on-chain, cash = ATM/physical, cross_rail = fiat↔crypto (OTC/P2P) */
export type Rail = 'fiat' | 'crypto' | 'cash' | 'cross_rail';
export type TaintMethod = 'proportional' | 'fifo';
export type InputType = 'bank_account' | 'crypto_wallet' | 'txid' | 'case_id' | 'unknown';
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ChokepointType = 'EXCHANGE_KYC' | 'ATM_CASHOUT' | 'HIGH_TAINT_POOL' | 'BANK_FREEZE';
export type EntityStatus = 'origin' | 'flagged' | 'frozen' | 'cashed_out' | 'monitoring' | 'active';
export type GeoEventType = 'ip_login' | 'atm_withdrawal' | 'cell_ping' | 'device_telemetry';
export type TimelineKind = 'transfer' | 'login' | 'withdrawal' | 'swap' | 'deposit' | 'ping' | 'alert';
export type Severity = 'info' | 'warning' | 'critical';
export type DocumentType = 'freeze_request' | 'kyc_ip_request' | 'atm_cctv_request';
export type CaseTypology = 'investment_scam' | 'call_center' | 'mule_cashout' | 'synthesized';

// ───────────────────────── Graph entities ─────────────────────────

/** Non-victim money that entered a pool without being drawn as a graph edge. */
export interface ExternalInflow {
  amount: number;
  /** ISO timestamp; omitted = balance that pre-dates the case (always counted). */
  at?: string;
  source: string;
}

export interface MixedFundPool {
  /** FIFO ordering: did the victim's money arrive before the other funds? */
  fifoVictimFirst: boolean;
  externalOther?: ExternalInflow;
  note?: string;
}

export interface FlowEntity {
  id: string;
  type: EntityType;
  /** Short English role badge, e.g. "MULE TIER-1" */
  role: string;
  /** Thai label */
  label: string;
  /** Bank account no. / wallet address / ATM terminal ID */
  identifier: string;
  institution: string;
  holderName?: string;
  chain?: Chain;
  currency: Currency;
  status: EntityStatus;
  chokepoint?: ChokepointType;
  pool?: MixedFundPool;
  ip?: string;
  asn?: string;
  isp?: string;
  device?: string;
  /** Cross-case correlation keys: DEV-xxxx (device), EXUID:xxxx (exchange UID) … */
  fingerprints?: string[];
  accountOpened?: string;
  terminalId?: string;
  locationName?: string;
  notes?: string;
  tags?: string[];
  isLive?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Amount debited from the source, in the source's currency */
  amount: number;
  currency: Currency;
  /** Amount credited to the target when the rail converts currency (OTC / swap) */
  receivedAmount?: number;
  receivedCurrency?: Currency;
  fxRate?: number;
  timestamp: string;
  /** Bank reference or on-chain TxID */
  txRef: string;
  channel: string;
  rail: Rail;
  txCount?: number;
  isLive?: boolean;
}

export interface GeoEvent {
  id: string;
  entityId: string;
  type: GeoEventType;
  timestamp: string;
  lat: number;
  lng: number;
  locationName: string;
  terminalId?: string;
  ip?: string;
  asn?: string;
  device?: string;
  cellId?: string;
  accuracyM?: number;
  amount?: number;
  currency?: Currency;
  searchRadiusM?: number;
  isLive?: boolean;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: TimelineKind;
  severity: Severity;
  title: string;
  detail: string;
  entityId: string;
  edgeId?: string;
  geoEventId?: string;
  amount?: number;
  currency?: Currency;
  isLive?: boolean;
}

export interface CaseOfficer {
  rank: string;
  name: string;
  position: string;
  unit: string;
  unitShort: string;
  phone: string;
}

export interface VictimProfile {
  name: string;
  age: number;
  province: string;
  channel: string;
}

/** Scripted next-step for the real-time simulation engine. */
export interface LiveScriptStep {
  kind: 'atm_withdrawal' | 'crypto_transfer' | 'cell_ping' | 'ip_login';
  fromEntityId: string;
  /** Existing target, or a new entity to append to the graph */
  targetEntityId?: string;
  newEntity?: Omit<FlowEntity, 'id' | 'status'> & { status?: EntityStatus };
  amount?: number;
  channel?: string;
  txCount?: number;
  geo?: Omit<GeoEvent, 'id' | 'entityId' | 'timestamp'> & { entityKey?: 'source' | 'target' };
  title: string;
  detail: string;
  severity: Severity;
}

export interface InvestigationCase {
  id: string;
  primaryKey: string;
  primaryEntityId: string;
  title: string;
  titleEn: string;
  typology: CaseTypology;
  lossAmount: number;
  reportNo: string;
  openedAt: string;
  victimProfile: VictimProfile;
  modusOperandi: string;
  summary: string;
  usdtThbRate: number;
  btcThbRate: number;
  searchRadiusM: number;
  analystAdjustment: { points: number; reason: string };
  officer: CaseOfficer;
  entities: FlowEntity[];
  edges: FlowEdge[];
  geoEvents: GeoEvent[];
  timeline: TimelineEvent[];
  liveScript: LiveScriptStep[];
  liveAlertCount: number;
  synthesized?: boolean;
}

// ───────────────────────── Engine results ─────────────────────────

export interface NodeTaint {
  entityId: string;
  currency: Currency;
  method: TaintMethod;
  isOrigin: boolean;
  fifoVictimFirst: boolean;
  /** Victim-attributed inflow */
  victimIn: number;
  /** Non-victim inflow (clean share of upstream edges + external funds) */
  otherIn: number;
  totalIn: number;
  outflow: number;
  taintedOut: number;
  cleanOut: number;
  /** Outflow not covered by any known inflow (data gap) */
  unattributedOut: number;
  /** taintedOut / outflow */
  taintPctOut: number;
  /** victimIn / totalIn */
  poolTaintPct: number;
  remainingTainted: number;
  remainingClean: number;
  remainingTotal: number;
  /** One-line transparent math explanation (Thai + formula) */
  explanation: string;
}

export interface EdgeTaint {
  edgeId: string;
  amount: number;
  currency: Currency;
  tainted: number;
  taintPct: number;
  received: number;
  receivedCurrency: Currency;
  taintedReceived: number;
}

export interface FundDisposition {
  key: 'cash_out' | 'exchange' | 'mule_bank' | 'crypto_wallet' | 'unattributed';
  label: string;
  thb: number;
  pct: number;
}

export interface CaseTaintResult {
  method: TaintMethod;
  asOf: number;
  nodes: Record<string, NodeTaint>;
  edges: Record<string, EdgeTaint>;
  totals: {
    victimLossTHB: number;
    cashedOutTHB: number;
    atExchangeTHB: number;
    recoverableTHB: number;
    disposition: FundDisposition[];
  };
}

export interface RiskFactor {
  key: string;
  label: string;
  labelEn: string;
  points: number;
  max: number;
  detail: string;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  label: string;
  factors: RiskFactor[];
}

export interface InterceptionTarget {
  entityId: string;
  chokepoint: ChokepointType;
  priority: number;
  remainingTainted: number;
  currency: Currency;
  thbEquivalent: number;
  reason: string;
  action: DocumentType;
}

export type CrossCaseMatchType =
  | 'shared_account'
  | 'shared_wallet'
  | 'shared_terminal'
  | 'shared_device'
  | 'shared_exchange_uid'
  | 'shared_ip'
  | 'atm_corridor'
  | 'pattern';

export interface MatchEvidence {
  type: CrossCaseMatchType;
  value: string;
  label: string;
}

export interface CrossCaseLink {
  key: string;
  localEntityId: string;
  remoteCaseId: string;
  remoteCaseTitle: string;
  remoteEntityId: string;
  remoteEntityLabel: string;
  remoteIdentifier: string;
  remoteRiskHint: number;
  evidence: MatchEvidence[];
  strength: 'strong' | 'medium' | 'weak';
}

export interface IdentifierHit {
  caseId: string;
  entityId?: string;
  edgeId?: string;
  field: 'case_id' | 'primary_key' | 'identifier' | 'tx_ref' | 'ip';
}

export interface InputDetection {
  type: InputType;
  label: string;
  hint: string;
  chain?: Chain;
  normalized: string;
}

// ───────────────────────── Live chain lookup ─────────────────────────

export type ChainSource = 'mempool.space' | 'blockstream.info' | 'simulated';
export type ChainFailReason = 'NETWORK_ERROR' | 'CORS_OR_OFFLINE' | 'TIMEOUT' | 'NOT_FOUND' | 'NOT_BTC' | 'HTTP_ERROR';

export interface ChainTxInfo {
  txid: string;
  confirmed: boolean;
  blockHeight?: number;
  blockTime?: number;
  confirmations?: number;
  feeSats: number;
  vsize: number;
  inputs: number;
  outputs: number;
  totalOutSats: number;
  topOutputs: { address: string; valueSats: number }[];
  inputAddresses: string[];
}

export interface ChainAddressInfo {
  address: string;
  txCount: number;
  fundedSats: number;
  spentSats: number;
  balanceSats: number;
  mempoolTxCount: number;
  mempoolDeltaSats: number;
}

export interface LiveChainResult {
  source: ChainSource;
  live: boolean;
  kind: 'tx' | 'address';
  query: string;
  fetchedAt: string;
  latencyMs?: number;
  tipHeight?: number;
  reason?: ChainFailReason;
  tx?: ChainTxInfo;
  address?: ChainAddressInfo;
}

// ───────────────────────── UI state ─────────────────────────

export interface Selection {
  entityId: string | null;
  geoId: string | null;
  eventId: string | null;
  edgeId: string | null;
}

export interface LiveAlert {
  id: string;
  caseId: string;
  title: string;
  detail: string;
  severity: Severity;
  timestamp: string;
  entityId: string;
  geoId?: string;
  eventId: string;
}

export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  detail?: string;
  alert?: LiveAlert;
}

export interface DocSigner {
  rank: string;
  name: string;
  position: string;
  docNo: string;
}
