// Mirror of the backend FindingSeverityBreakdown payload (agents severity-scorer).
// Kept structural so the web app stays decoupled from the service types.
export type SeverityBreakdownInput = {
  evidence: { trust_tier: string; corroborating_source_count: number; confidence: number }
  impact: { direction: string; channel: string; horizon: string; confidence: number }
  thesis_relevance: number
}

export type SeverityBreakdown = {
  score: number
  components: { evidence: number; impact: number; thesis_relevance: number }
  explanation: string
  input: SeverityBreakdownInput
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
