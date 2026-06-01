import { ANALYZE_PATH } from '../analyze/analyzeEntry'
import { webDevFlags } from '../devFlags'

export type WorkspaceNavItem = { to: string; label: string }

// Single source of truth for the primary workspace destinations, shared by the
// top tabs (PrimaryTabs) and the command palette so the two never drift.
export function workspaceNavItems(): ReadonlyArray<WorkspaceNavItem> {
  return [
    { to: '/home', label: 'Home' },
    { to: '/agents', label: 'Agents' },
    { to: '/review', label: 'Review' },
    { to: '/chat', label: 'Chat' },
    { to: '/screener', label: 'Screener' },
    { to: ANALYZE_PATH, label: 'Analyze' },
    ...(webDevFlags.llmSettingsEnabled ? [{ to: '/settings', label: 'Settings' }] : []),
  ]
}
