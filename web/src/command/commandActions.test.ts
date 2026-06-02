import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCommandActions,
  filterCommandActions,
  moveHighlight,
  type CommandActionDeps,
} from './commandActions.ts'

function deps(overrides: Partial<CommandActionDeps> = {}): CommandActionDeps {
  return {
    currentPath: '/home',
    navigate: () => {},
    themeMode: 'system',
    setThemeMode: () => {},
    session: null,
    signIn: () => {},
    signOut: () => {},
    ...overrides,
  }
}

test('buildCommandActions exposes a navigate action per workspace, theme actions, and sign-in when signed out', () => {
  const actions = buildCommandActions(deps())
  const labels = actions.map((a) => a.label)

  assert.ok(labels.includes('Go to Home'))
  assert.ok(labels.includes('Go to Chat'))
  assert.ok(labels.includes('Go to Screener'))
  assert.ok(labels.includes('Theme: Light'))
  assert.ok(labels.includes('Theme: Dark'))
  assert.ok(labels.includes('Theme: System'))
  assert.ok(labels.includes('Sign in'))
  assert.ok(!labels.some((l) => l.startsWith('Sign out')))
})

test('buildCommandActions offers sign out (with display name) when signed in', () => {
  const actions = buildCommandActions(deps({ session: { displayName: 'Dana' } }))
  const labels = actions.map((a) => a.label)
  assert.ok(labels.some((l) => l.startsWith('Sign out') && l.includes('Dana')))
  assert.ok(!labels.includes('Sign in'))
})

test('buildCommandActions marks the current route and current theme active', () => {
  const actions = buildCommandActions(deps({ currentPath: '/chat/abc', themeMode: 'dark' }))
  const chat = actions.find((a) => a.label === 'Go to Chat')
  const home = actions.find((a) => a.label === 'Go to Home')
  const dark = actions.find((a) => a.label === 'Theme: Dark')
  assert.equal(chat?.active, true) // nested route still marks parent active
  assert.equal(home?.active, false)
  assert.equal(dark?.active, true)
})

test('navigate / setThemeMode / signOut actions invoke their dependency callbacks', () => {
  const calls: string[] = []
  const actions = buildCommandActions(
    deps({
      session: { displayName: 'Dana' },
      navigate: (to) => calls.push(`nav:${to}`),
      setThemeMode: (mode) => calls.push(`theme:${mode}`),
      signOut: () => calls.push('signout'),
    }),
  )
  actions.find((a) => a.label === 'Go to Agents')?.run()
  actions.find((a) => a.label === 'Theme: Light')?.run()
  actions.find((a) => a.label.startsWith('Sign out'))?.run()
  assert.deepEqual(calls, ['nav:/agents', 'theme:light', 'signout'])
})

test('filterCommandActions matches label and keywords case-insensitively; empty query returns all', () => {
  const actions = buildCommandActions(deps())
  assert.equal(filterCommandActions(actions, '').length, actions.length)

  const chatOnly = filterCommandActions(actions, 'CHAT')
  assert.ok(chatOnly.length >= 1)
  assert.ok(chatOnly.every((a) => a.label.toLowerCase().includes('chat') || a.keywords.some((k) => k.includes('chat'))))

  // keyword match: "dark" hits the theme action even though label says "Theme: Dark"
  assert.ok(filterCommandActions(actions, 'dark').some((a) => a.label === 'Theme: Dark'))
})

test('moveHighlight wraps around and handles the no-selection and empty cases', () => {
  assert.equal(moveHighlight(3, -1, 'next'), 0)
  assert.equal(moveHighlight(3, -1, 'previous'), 2)
  assert.equal(moveHighlight(3, 2, 'next'), 0)
  assert.equal(moveHighlight(3, 0, 'previous'), 2)
  assert.equal(moveHighlight(0, -1, 'next'), -1)
})
