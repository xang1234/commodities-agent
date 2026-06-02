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

function optionByText(doc: Document, text: string): HTMLElement {
  const option = [...doc.querySelectorAll('[role="option"]')].find((el) => (el.textContent ?? '').includes(text))
  assert.ok(option, `expected an option containing "${text}"`)
  return option as HTMLElement
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
      optionByText(doc, 'Go to Agents').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    assert.equal(doc.querySelector('[data-testid="loc"]')?.textContent, '/agents')
    assert.equal(doc.querySelector('[data-testid="command-palette"]'), null)

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('the input is the only tab stop, and Tab is trapped on it', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const { root, mount } = renderPalette(dom)
    await mount()
    await pressCmdK(dom)

    // aria-activedescendant pattern: options are non-focusable role="option" rows,
    // so the input is the sole focusable element in the dialog.
    const dialog = doc.querySelector('[role="dialog"]')!
    assert.deepEqual(
      [...dialog.querySelectorAll('input, button, a[href], [tabindex]')].map((el) => el.tagName),
      ['INPUT'],
    )

    const input = doc.querySelector('input')!
    for (const shiftKey of [false, true]) {
      await act(async () => {
        input.focus()
        const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
        input.dispatchEvent(event)
        assert.equal(event.defaultPrevented, true, `Tab (shift=${shiftKey}) is trapped on the input`)
      })
      assert.equal(doc.activeElement, input, 'focus never leaves the input')
    }

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('closing restores focus to the element that was focused before opening', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const sentinel = doc.createElement('button')
    sentinel.textContent = 'opener'
    doc.body.appendChild(sentinel)

    const { root, mount } = renderPalette(dom)
    await mount()

    sentinel.focus()
    assert.equal(doc.activeElement, sentinel)

    await pressCmdK(dom)
    assert.equal(doc.activeElement, doc.querySelector('input'), 'opening moves focus into the dialog')

    await act(async () => {
      fire(doc.querySelector('input'), new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(doc.activeElement, sentinel, 'closing restores focus to the opener')

    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('with results, the combobox points aria-controls at a listbox that is actually rendered', async () => {
  // The empty-results inverse (no listbox -> aria-controls/aria-expanded dropped)
  // is a pure derivation from results.length, but it requires simulating typing in
  // a controlled input, which React 19's value tracker does not pick up under this
  // node:test + JSDOM harness (verified four ways; the repo only ever drives
  // <select> elements). This guards the dangling-reference invariant in the
  // reachable populated state: aria-controls must reference an element in the DOM.
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const doc = dom.window.document
    const { root, mount } = renderPalette(dom)
    await mount()
    await pressCmdK(dom)

    const input = doc.querySelector('input')!
    const controls = input.getAttribute('aria-controls')
    assert.equal(controls, 'command-palette-listbox')
    assert.equal(input.getAttribute('aria-expanded'), 'true')
    assert.ok(doc.getElementById(controls!), 'aria-controls must reference a listbox present in the DOM')
    assert.equal(doc.getElementById(controls!)?.getAttribute('role'), 'listbox')

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
