import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../shell/useAuth'
import { useTheme } from '../shell/useTheme'
import { buildCommandActions, filterCommandActions, moveHighlight, type CommandAction } from './commandActions.ts'

const LISTBOX_ID = 'command-palette-listbox'

// Global command palette. Cmd/Ctrl+K toggles it from anywhere; Escape or a
// backdrop click closes it. Overlay structure mirrors AuthInterrupt. The action
// list is built from the same workspace nav source as PrimaryTabs.
export function CommandPalette(): ReactElement | null {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { mode, setMode } = useTheme()
  const { session, signIn, signOut } = useAuth()

  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+K is the sole opener, so resetting query/highlight here guarantees
  // every open starts blank — no other close path needs to repeat it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        setOpen((open) => !open)
        setQuery('')
        setHighlight(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // On open, remember what had focus and pull focus into the dialog; on close,
  // restore it so keyboard users aren't stranded at <body>.
  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [isOpen])

  if (!isOpen) return null

  const actions = buildCommandActions({
    currentPath: pathname,
    navigate,
    themeMode: mode,
    setThemeMode: setMode,
    session: session ? { displayName: session.displayName } : null,
    signIn,
    signOut,
  })
  const results = filterCommandActions(actions, query)
  const hasResults = results.length > 0
  const activeIndex = hasResults ? Math.min(highlight, results.length - 1) : -1

  const close = () => setOpen(false)
  const runAction = (action: CommandAction) => {
    close()
    action.run()
  }

  // The input is the only focusable element (options are non-focusable
  // role="option" rows driven by aria-activedescendant), so it owns all keyboard
  // handling and DOM focus never leaves it.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => moveHighlight(results.length, current, 'next'))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => moveHighlight(results.length, current, 'previous'))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const action = results[activeIndex]
      if (action) runAction(action)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      // The input is the sole tab stop, so trap Tab on it to keep focus from
      // falling through to the (non-inert) background. Keeps aria-modal honest.
      event.preventDefault()
    }
  }

  return (
    <div
      role="presentation"
      data-testid="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/40 p-4 pt-[12vh] dark:bg-neutral-950/70"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg dark:bg-neutral-900 dark:shadow-neutral-950"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={hasResults}
          aria-controls={hasResults ? LISTBOX_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label="Search commands"
          placeholder="Search commands…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          className="w-full border-b border-neutral-200 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-400 dark:border-neutral-800"
        />
        {results.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">No matching commands</p>
        ) : (
          <ul id={LISTBOX_ID} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto py-1">
            {results.map((action, index) => (
              <li
                key={action.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => runAction(action)}
                className={[
                  'flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-sm',
                  index === activeIndex
                    ? 'bg-neutral-100 dark:bg-neutral-800'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                ].join(' ')}
              >
                <span className="text-neutral-900 dark:text-neutral-100">{action.label}</span>
                <span className="flex items-center gap-2 text-xs text-neutral-400">
                  {action.active ? <span aria-hidden>●</span> : null}
                  <span className="uppercase tracking-wide">{action.group}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function optionId(index: number): string {
  return `command-palette-option-${index}`
}
