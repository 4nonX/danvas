// @vitest-environment jsdom

// Editing a profile's settings from its list: the dialog shows the fields
// the format carries, with the stored values, and saves what was changed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ExportProfile } from "@hc/sdk";

vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/print/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listProfileOptions: async () => [
    { id: "ws-pso", name: "PSO Coated v3", builtIn: false, owner: "workspace", isDefault: true },
    { id: "builtin:pso-uncoated-fogra47", name: "PSO Uncoated", builtIn: true, owner: "builtin", isDefault: false },
  ],
}));

const { ProfileSettingsEditor } = await import("./ProfileSettingsEditor");

// The print shop's label profile, as stored.
const label = {
  v: 1, format: "pdf", pdfMode: "vector", scale: 1, transparent: false, quality: 92, zip: true, tiffDpi: 300,
  color: "cmyk", iccProfileId: "ws-pso", intent: "relative", blackOnly: true, overprintBlack: true, pdfx: true, registration: true,
  dieLine: { on: true, name: "Stanze", radiusMm: 0.5 }, tacLimit: null, roundMm: true, extendBleed: true,
  print: { source: "fixed", override: { bleed: true, bleedMm: 1.5, marks: false, style: "solid", weightPt: 0.25, lengthMm: 5, offsetMm: 3 } },
};
const profile = (settings: unknown) => ({ id: "p1", name: "Etikett 50x100", description: "", settings, isDefault: false, scope: "workspace" } as unknown as ExportProfile);
const checkbox = (label: string) => screen.getByText(label).closest("label")!.querySelector("input") as HTMLInputElement;

afterEach(cleanup);

describe("editing an export profile", () => {
  it("shows the stored print settings and saves a change", async () => {
    const onSave = vi.fn(async () => {});
    render(<ProfileSettingsEditor profile={profile(label)} print={false} workspaceId="ws" onSave={onSave} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("PSO Coated v3")).toBeTruthy());

    expect((screen.getByDisplayValue("Stanze") as HTMLInputElement).value).toBe("Stanze");
    expect(screen.getByDisplayValue("1.5")).toBeTruthy();
    expect(checkbox("editor.die_line").checked).toBe(true);
    expect(checkbox("editor.extend_into_bleed").checked).toBe(true);
    expect(checkbox("editor.pdfx4").checked).toBe(true);
    // Raster-only fields are not offered for a vector PDF.
    expect(screen.queryByText("editor.transparent_background")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("Stanze"), { target: { value: "CutContour" } });
    fireEvent.click(checkbox("editor.round_to_mm"));
    fireEvent.click(screen.getByText("editor.export_profile_save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = (onSave.mock.calls[0] as unknown[])[0] as typeof label;
    expect(saved.dieLine).toEqual({ on: true, name: "CutContour", radiusMm: 0.5 });
    expect(saved.roundMm).toBe(false);
    expect(saved.print).toEqual(label.print);
    expect(saved.iccProfileId).toBe("ws-pso");
  });

  it("offers the raster fields for PNG", async () => {
    render(<ProfileSettingsEditor profile={profile({ ...label, format: "png" })} print={false} workspaceId="ws" onSave={async () => {}} onClose={() => {}} />);
    expect(screen.getByText("editor.transparent_background")).toBeTruthy();
    expect(screen.queryByText("editor.die_line")).toBeNull();
  });

  it("keeps the dialog open when saving fails", async () => {
    const onClose = vi.fn();
    render(<ProfileSettingsEditor profile={profile(label)} print={false} workspaceId="ws" onSave={async () => { throw new Error("no"); }} onClose={onClose} />);
    fireEvent.click(screen.getByText("editor.export_profile_save"));
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("editing a print preset", () => {
  it("shows paper, size and resolution and saves them", async () => {
    const onSave = vi.fn(async () => {});
    render(<ProfileSettingsEditor profile={profile({ v: 1, pages: "all", size: "actual", paper: "design", dpi: 300, print: { source: "page", bleed: false, marks: false } })} print workspaceId={null} onSave={onSave} onClose={() => {}} />);
    // The resolution picker: the select holding 300.
    const dpi = screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "300")!;
    fireEvent.change(dpi, { target: { value: "600" } });
    fireEvent.click(screen.getByText("editor.export_profile_save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(((onSave.mock.calls[0] as unknown[])[0] as { dpi: number; paper: string }).dpi).toBe(600);
    expect(((onSave.mock.calls[0] as unknown[])[0] as { paper: string }).paper).toBe("design");
  });
});
