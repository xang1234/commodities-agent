import { useState, type ReactElement } from 'react'

import { useEvidenceInspector } from '../evidence/useEvidenceInspector.ts'
import { percent, type SeverityBreakdown } from './severityBreakdown.ts'

type SeverityBreakdownPanelProps = {
  breakdown: SeverityBreakdown
  snapshotId: string
  sourceRefs: ReadonlyArray<string>
}

// Collapsible "Why this severity" disclosure. Surfaces the scorer's inputs (the
// real drivers — trust tier, corroboration, impact channel/direction/horizon)
// alongside the weighted components, and lets each contributing source open the
// shared evidence inspector. Reuses the chevron/aria-expanded pattern from
// blocks/Section.tsx.
export function SeverityBreakdownPanel({
  breakdown,
  snapshotId,
  sourceRefs,
}: SeverityBreakdownPanelProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const inspector = useEvidenceInspector()
  const { input, components } = breakdown

  return (
    <div
      data-testid="severity-breakdown"
      className="rounded-md border border-neutral-200 bg-neutral-50 text-xs dark:border-neutral-800 dark:bg-neutral-950"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-200"
      >
        <span>Why this severity</span>
        <span aria-hidden className="text-neutral-400">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen ? (
        <dl className="flex flex-col gap-1 px-3 pb-3 text-neutral-600 dark:text-neutral-300">
          <Driver
            label="Evidence"
            detail={`${input.evidence.trust_tier} source · ${input.evidence.corroborating_source_count} corroborating`}
            weight={components.evidence}
          />
          <Driver
            label="Impact"
            detail={`${input.impact.channel} / ${input.impact.direction} / ${input.impact.horizon}`}
            weight={components.impact}
          />
          <Driver label="Thesis relevance" detail="" weight={components.thesis_relevance} />
          <div className="flex justify-between border-t border-neutral-200 pt-1 font-medium dark:border-neutral-800">
            <dt>Overall score</dt>
            <dd>{percent(breakdown.score)}</dd>
          </div>
          {sourceRefs.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <dt className="text-neutral-500 dark:text-neutral-400">Sources:</dt>
              <dd className="flex flex-wrap gap-1">
                {sourceRefs.map((id, index) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => inspector?.openInspection({ snapshotId, ref: { kind: 'source', id } })}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
                  >
                    Source {index + 1}
                  </button>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

function Driver({ label, detail, weight }: { label: string; detail: string; weight: number }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>
        {label}
        {detail ? <span className="text-neutral-500 dark:text-neutral-400"> · {detail}</span> : null}
      </dt>
      <dd className="tabular-nums">{percent(weight)}</dd>
    </div>
  )
}
