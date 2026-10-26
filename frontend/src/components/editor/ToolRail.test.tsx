// @vitest-environment jsdom

// The editor's tool rail: a click on a button opens its panel and a second
// click closes it (1.5.0 shipped without the click, so only the panel open on
// load could be seen), the buttons follow the order kept for the person, and
// the arrow keys with Alt move a button.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));
const saved: Record<string, unknown> = {};
vi.mock("@/lib/sdk", () => ({
  oc: {
    uiPrefs: async () => ({ ...saved }),
    setUiPref: async (k: string, v: unknown) => { saved[k] = v; },
  },
}));
function Panel({ name }: { name: string }) {
  return <div data-testid="panel">{name}</div>;
}
vi.mock("./EditorPanels", () => ({
  ElementsPanel: () => <Panel name="elements" />, TextPanel: () => <Panel name="text" />, UploadsPanel: () => <Panel name="uploads" />, StockPanel: () => <Panel name="stock" />,
  AppsPanel: () => <Panel name="apps" />, AiPanel: () => <Panel name="ai" />, TemplatesPanel: () => <Panel name="templates" />,
  PanelShell: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
}));
vi.mock("./BrandPanel", () => ({ BrandPanel: () => <Panel name="brand" /> }));
vi.mock("./LayerPanel", () => ({ LayerPanel: () => <div>layers</div> }));
vi.mock("./ReadingOrderPane", () => ({ ReadingOrderPane: () => null }));
vi.mock("./PositionPanel", () => ({ PositionPanel: () => null }));
vi.mock("./SelectionPanels", () => ({ AnimationPanel: () => null, EffectsPanel: () => null, ImageEditPanel: () => null, VectorizePanel: () => null }));

const { ToolRail } = await import("./ToolRail");

const buttons = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);
const shown = () => screen.queryByTestId("panel")?.textContent ?? null;

beforeEach(() => {
  cleanup();
  for (const k of Object.keys(saved)) delete saved[k];
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe("the tool rail", () => {
  it("opens a panel on click and closes it on a second click", () => {
    render(<ToolRail workspaceId="w" />);
    expect(shown()).toBe("elements");
    fireEvent.click(screen.getByLabelText("Open editor.text"));
    expect(shown()).toBe("text");
    fireEvent.click(screen.getByLabelText("Open editor.brand"));
    expect(shown()).toBe("brand");
    fireEvent.click(screen.getByLabelText("Hide editor.brand"));
    expect(shown()).toBeNull();
  });

  it("moves a button with Alt and the arrow keys", () => {
    render(<ToolRail workspaceId="w" />);
    const before = buttons().map((b) => b.textContent);
    expect(before.slice(0, 3)).toEqual(["editor.templates", "editor.elements", "editor.text"]);
    fireEvent.keyDown(screen.getByLabelText("Open editor.text"), { key: "ArrowUp", altKey: true });
    expect(buttons().map((b) => b.textContent).slice(0, 3)).toEqual(["editor.templates", "editor.text", "editor.elements"]);
    // Without Alt the arrow keys do nothing to the order.
    fireEvent.keyDown(screen.getByLabelText("Open editor.text"), { key: "ArrowUp" });
    expect(buttons().map((b) => b.textContent).slice(0, 3)).toEqual(["editor.templates", "editor.text", "editor.elements"]);
  });
});
