import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { AuthProvider } from '../shell/AuthContext.tsx'
import { ThemeProvider } from '../shell/ThemeProvider.tsx'
import { CommandPalette } from './CommandPalette.tsx'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

function renderPalette(dom: JSDOM) {
  const root = createRoot(dom.window.document.getElementById('root')!)
  return {
    root,
    async mount() {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/home']}>
            <ThemeProvider>
              <AuthProvider>
                <LocationProbe />
                <CommandPalette />
              </AuthProvider>
            </ThemeProvider>
          </MemoryRouter>,
        )
      })
    },
  }
}

async function pressCmdK(dom: JSDOM) {
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
  })
}

function fire(el: Element | null, event: Event) {
  assert.ok(el, 'expected target element to exist')
  el!.dispatchEvent(event)
}

function buttonByText(doc: Document, text: string): HTMLButtonElement {
  const button = [...doc.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text))
  assert.ok(button, `expected a button containing "${text}"`)
  return button as HTMLButtonElement
}

test('Cmd+K toggles the palette; Escape closes it', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const { root, mount } = renderPalette(dom)
    await mount()

    assert.equal(doc.querySelector('[data-testid="command-palette"]'), null)

    await pressCmdK(dom)
    assert.ok(doc.querySelector('[data-testid="command-palette"]'))
    assert.match(doc.body.textContent ?? '', /Go to Home/)
    assert.match(doc.body.textContent ?? '', /Theme: Dark/)
    assert.match(doc.body.textContent ?? '', /Sign in/)

    await act(async () => {
      fire(doc.querySelector('input'), new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(doc.querySelector('[data-testid="command-palette"]'), null)

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('ArrowDown advances the highlighted option', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const { root, mount } = renderPalette(dom)
    await mount()
    await pressCmdK(dom)

    const optionsBefore = [...doc.querySelectorAll('[role="option"]')]
    assert.equal(optionsBefore[0]?.getAttribute('aria-selected'), 'true')

    await act(async () => {
      fire(doc.querySelector('input'), new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    const optionsAfter = [...doc.querySelectorAll('[role="option"]')]
    assert.equal(optionsAfter[0]?.getAttribute('aria-selected'), 'false')
    assert.equal(optionsAfter[1]?.getAttribute('aria-selected'), 'true')

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('selecting a navigate command routes and closes the palette', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const { root, mount } = renderPalette(dom)
    await mount()
    await pressCmdK(dom)

    assert.equal(doc.querySelector('[data-testid="loc"]')?.textContent, '/home')

    await act(async () => {
      buttonByText(doc, 'Go to Agents').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    assert.equal(doc.querySelector('[data-testid="loc"]')?.textContent, '/agents')
    assert.equal(doc.querySelector('[data-testid="command-palette"]'), null)

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window

  // JSDOM lacks matchMedia, which ThemeProvider reads for the 'system' theme.
  const windowWithMedia = domWindow as unknown as { matchMedia?: (q: string) => unknown }
  if (typeof windowWithMedia.matchMedia !== 'function') {
    windowWithMedia.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false
      },
    })
  }

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
  }
}
