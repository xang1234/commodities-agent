import type { ThemeMode } from '../shell/themeTypes.ts'
import { workspaceNavItems } from '../shell/workspaces.ts'

export type CommandActionGroup = 'Navigate' | 'Theme' | 'Session'

export type CommandAction = {
  id: string
  label: string
  group: CommandActionGroup
  keywords: ReadonlyArray<string>
  active: boolean
  run: () => void
}

export type CommandActionDeps = {
  currentPath: string
  navigate: (to: string) => void
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  session: { displayName: string } | null
  signIn: () => void
  signOut: () => void
}

const THEME_MODES: ReadonlyArray<ThemeMode> = ['light', 'dark', 'system']

export function buildCommandActions(deps: CommandActionDeps): ReadonlyArray<CommandAction> {
  const navActions = workspaceNavItems().map((item) => ({
    id: `navigate:${item.to}`,
    label: `Go to ${item.label}`,
    group: 'Navigate' as const,
    keywords: [item.label.toLowerCase(), item.to],
    active: isCurrentRoute(deps.currentPath, item.to),
    run: () => deps.navigate(item.to),
  }))

  const themeActions = THEME_MODES.map((mode) => ({
    id: `theme:${mode}`,
    label: `Theme: ${capitalize(mode)}`,
    group: 'Theme' as const,
    keywords: ['theme', mode],
    active: deps.themeMode === mode,
    run: () => deps.setThemeMode(mode),
  }))

  const sessionAction: CommandAction = deps.session
    ? {
        id: 'session:sign-out',
        label: `Sign out (${deps.session.displayName})`,
        group: 'Session',
        keywords: ['sign out', 'log out', 'session'],
        active: false,
        run: deps.signOut,
      }
    : {
        id: 'session:sign-in',
        label: 'Sign in',
        group: 'Session',
        keywords: ['sign in', 'log in', 'session'],
        active: false,
        run: deps.signIn,
      }

  return [...navActions, ...themeActions, sessionAction]
}

export function filterCommandActions(
  actions: ReadonlyArray<CommandAction>,
  query: string,
): ReadonlyArray<CommandAction> {
  const needle = query.trim().toLowerCase()
  if (needle === '') return actions
  return actions.filter(
    (action) =>
      action.label.toLowerCase().includes(needle) ||
      action.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  )
}

export function moveHighlight(count: number, current: number, direction: 'next' | 'previous'): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 'next' ? 0 : count - 1
  return direction === 'next' ? (current + 1) % count : (current - 1 + count) % count
}

// A nav action is active when it points at the current route, including nested
// routes (e.g. /chat is active while viewing /chat/:threadId).
function isCurrentRoute(currentPath: string, to: string): boolean {
  return currentPath === to || currentPath.startsWith(`${to}/`)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
