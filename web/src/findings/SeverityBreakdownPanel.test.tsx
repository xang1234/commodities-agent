import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from "../evidence/evidenceInspectorContext.ts";
import { SeverityBreakdownPanel } from "./SeverityBreakdownPanel.tsx";
import type { SeverityBreakdown } from "./severityBreakdown.ts";

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

const BREAKDOWN: SeverityBreakdown = {
  score: 0.85,
  components: { evidence: 0.34, impact: 0.38, thesis_relevance: 0.28 },
  explanation: "Severity high: evidence 0.34, impact 0.38, thesis relevance 0.28.",
  input: {
    evidence: { trust_tier: "primary", corroborating_source_count: 3, confidence: 0.86 },
    impact: { direction: "negative", channel: "supply", horizon: "1d", confidence: 0.82 },
    thesis_relevance: 0.76,
  },
};

function buttonByText(doc: Document, text: string): HTMLButtonElement {
  const button = [...doc.querySelectorAll("button")].find((el) => (el.textContent ?? "").includes(text));
  assert.ok(button, `expected a button containing "${text}"`);
  return button as HTMLButtonElement;
}

test("SeverityBreakdownPanel reveals the scoring inputs only after expanding, and opens sources in the inspector", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window);
  const opened: Array<{ snapshotId: string; ref: { kind: string; id: string } }> = [];
  const inspector: EvidenceInspectorContextValue = {
    openInspection: (input) => opened.push(input),
    openBlockInspection: () => {},
    closeInspection: () => {},
  };

  try {
    const doc = dom.window.document;
    const root = createRoot(doc.getElementById("root")!);
    await act(async () => {
      root.render(
        <EvidenceInspectorContext.Provider value={inspector}>
          <SeverityBreakdownPanel breakdown={BREAKDOWN} snapshotId={SNAPSHOT_ID} sourceRefs={[SOURCE_ID]} />
        </EvidenceInspectorContext.Provider>,
      );
    });

    // Collapsed by default: the inputs are not in the DOM yet.
    assert.doesNotMatch(doc.body.textContent ?? "", /primary/);
    assert.doesNotMatch(doc.body.textContent ?? "", /supply/);

    // Expand → the real drivers (trust tier, corroboration, channel) appear.
    await act(async () => {
      buttonByText(doc, "Why this severity").click();
    });
    const text = doc.body.textContent ?? "";
    assert.match(text, /primary/);
    assert.match(text, /3 corroborating/);
    assert.match(text, /supply \/ negative \/ 1d/);
    assert.match(text, /85%/); // overall score

    // Clicking a contributing source opens the evidence inspector.
    await act(async () => {
      buttonByText(doc, "Source 1").click();
    });
    assert.deepEqual(opened, [{ snapshotId: SNAPSHOT_ID, ref: { kind: "source", id: SOURCE_ID } }]);
  } finally {
    restoreGlobals();
  }
});

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    document?: Document;
    window?: Window;
  };
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, "IS_REACT_ACT_ENVIRONMENT");
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, "document");
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, "window");
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT;
  const previousDocument = globals.document;
  const previousWindow = globals.window;

  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.document = domWindow.document;
  globals.window = domWindow;

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
    if (hadDocument) globals.document = previousDocument;
    else delete globals.document;
    if (hadWindow) globals.window = previousWindow;
    else delete globals.window;
  };
}
