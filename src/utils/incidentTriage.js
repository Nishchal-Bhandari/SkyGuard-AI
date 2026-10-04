const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };
const CLOSED_STATUSES = ['resolved', 'closed', 'rejected'];

export const PRIORITY_BADGE = {
  P1: 'badge-critical',
  P2: 'badge-suspect',
  P3: 'badge-extreme',
};

export const ACTION_LABELS = {
  ACKNOWLEDGE: 'Acknowledge',
  GENUINE: 'Confirm Genuine Extreme',
  REJECT: 'Flag Defect / Invalidate',
};

export const isClosedIncident = (incident) =>
  CLOSED_STATUSES.includes(String(incident?.status || '').toLowerCase());

export const formatRisk = (risk) => {
  const value = Number(risk);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'N/A';
};

// Work the queue in order: open items first, then urgency, then fault risk, then recency.
export const compareIncidents = (a, b) => {
  const closed = Number(isClosedIncident(a)) - Number(isClosedIncident(b));
  if (closed) return closed;
  const rankA = PRIORITY_RANK[a.reasoning?.priority] ?? 3;
  const rankB = PRIORITY_RANK[b.reasoning?.priority] ?? 3;
  if (rankA !== rankB) return rankA - rankB;
  const risk = (Number(b.fault_risk) || 0) - (Number(a.fault_risk) || 0);
  if (risk) return risk;
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
};
