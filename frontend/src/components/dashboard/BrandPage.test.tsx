// @vitest-environment jsdom

// The Brand page (F50): the whole brand on tabs (colours, fonts, logos,
// graphics, settings), full CRUD for the roles that may change each part,
// read-only for everyone else, and one kit update per change.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandKit, UploadedAsset } from "@hc/sdk";

vi.mock("@/lib/i18n", () => ({ tr: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k) }));
// Stable, like the real provider's memoized api.
const toastApi = { success: vi.fn(), error: vi.fn(), toast: vi.fn() };
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastApi }));

// Dialogs answer what each test sets.
const answers = { prompt: [] as (string | null)[], confirm: true, choose: null as string | null };
vi.mock("@/lib/fontProvider", () => ({ fonts: { ensure: () => {}, onChange: () => () => {} } }));
vi.mock("@/lib/workspaceFonts", () => ({ useWorkspaceFontFamilies: () => [], loadWorkspaceFonts: async () => {} }));
vi.mock("@/lib/promptDialog", () => ({
  promptText: async () => answers.prompt.shift() ?? null,
  confirmAction: async () => answers.confirm,
  chooseAction: async () => answers.choose,
}));

let kit: BrandKit;
const asset = (id: string, filename: string): UploadedAsset =>
  ({ id, workspaceId: "ws", kind: "image", filename, mimeType: filename.endsWith(".svg") ? "image/svg+xml" : "image/png", byteSize: 1, folderId: null, tags: [], url: `/f/${id}`, thumbnail: null, createdAt: "" });
const files = [asset("a-klee", "Klee - Silhouette schwarz.svg"), asset("a-mohn", "Mohn - Silhouette schwarz.svg"), asset("a-icon", "Magen.svg")];
const updates: unknown[] = [];
const created: string[] = [];
const deleted: string[] = [];
let uploads = 0;

vi.mock("@/lib/sdk", () => ({
  resolveAssetUrl: (u: string) => u,
  directUploadWithProgress: async (_ws: string, f: File) => { uploads++; return asset(`a-new-${uploads}`, f.name); },
  oc: {
    listBrandKits: async () => (deleted.includes(kit.id) ? [] : [kit]),
    listAssets: async () => files,
    createBrandKit: async (_ws: string, input: { name?: string }) => { created.push(input.name ?? ""); return { ...kit, id: "k2", name: input.name ?? "", isDefault: false, palettes: [], collections: [] }; },
    deleteBrandKit: async (id: string) => { deleted.push(id); },
    setDefaultBrandKit: async (id: string) => ({ ...kit, id }),
    listWorkspaceFonts: async () => [],
    updateBrandKit: async (_id: string, patch: Partial<BrandKit>) => { updates.push(patch); kit = { ...kit, ...patch, version: kit.version + 1 }; return kit; },
    updateAsset: async (id: string, patch: { filename: string }) => ({ ...files.find((f) => f.id === id)!, filename: patch.filename }),
  },
}));

const { BrandPage } = await import("./BrandPage");

beforeEach(() => {
  kit = {
    id: "k1", workspaceId: "ws", name: "Acme", version: 1, isDefault: true, voice: null,
    palettes: [{ id: "p1", name: "Hausfarben", colors: [{ id: "s1", role: "primary", value: { srgb: { r: 0, g: 0.4, b: 0.2, a: 1 } } }] }],
    fonts: [{ id: "f1", role: "heading", fontFamily: "Inter" }],
    logos: [{ id: "l1", label: "Wortmarke", assetId: "a-icon" }],
    collections: [
      { id: "c-old", kind: "icons", assetIds: ["a-icon"] },
      { id: "c-sil", kind: "graphics", name: "Silhouetten", assetIds: ["a-klee", "a-mohn"] },
    ],
    controls: { lockColors: false, lockFonts: false, restrictTemplates: false, lintPolicy: "off" },
    createdAt: "", updatedAt: "",
  };
  updates.length = 0;
  created.length = 0;
  deleted.length = 0;
  window.location.hash = "#graphics";
  uploads = 0;
  answers.prompt = [];
  answers.confirm = true;
  answers.choose = null;
});
afterEach(cleanup);

// The category entry in the list (its name is also the heading when shown).
const category = (name: string) => screen.getAllByText(name).find((el) => el.closest("li"))!;
const lastCollections = () => (updates.at(-1) as { collections: BrandKit["collections"] }).collections;

describe("brand page (F50)", () => {
  it("shows categories, older collections under their kind, and the graphics by name", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("brand.kind_icons")).toBeTruthy());
    fireEvent.click(category("Silhouetten"));
    expect(screen.getByText("Klee - Silhouette schwarz")).toBeTruthy();
    expect(screen.getByText("Mohn - Silhouette schwarz")).toBeTruthy();
  });

  it("uploads many files into a category as one kit update", async () => {
    const { container } = render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    fireEvent.click(category("Silhouetten"));
    const input = container.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    const picked = [new File(["<svg/>"], "Akelei.svg", { type: "image/svg+xml" }), new File(["x"], "Notiz.pdf", { type: "application/pdf" }), new File(["p"], "Baldrian.png", { type: "image/png" })];
    fireEvent.change(input, { target: { files: picked } });
    await waitFor(() => expect(updates.length).toBe(1));
    expect(uploads).toBe(2); // the PDF is skipped
    expect(lastCollections().find((c) => c.id === "c-sil")?.assetIds).toEqual(["a-klee", "a-mohn", "a-new-1", "a-new-2"]);
    await waitFor(() => expect(screen.getByText("Akelei")).toBeTruthy());
  });

  it("creates, renames and deletes a category", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    answers.prompt = ["Zeichnungen"];
    fireEvent.click(screen.getByText("brand.new_category"));
    await waitFor(() => expect(lastCollections().at(-1)).toMatchObject({ kind: "graphics", name: "Zeichnungen", assetIds: [] }));
    answers.prompt = ["Pflanzen"];
    fireEvent.click(screen.getAllByLabelText("brand.rename_category")[1]);
    await waitFor(() => expect(lastCollections().find((c) => c.id === "c-sil")?.name).toBe("Pflanzen"));
    fireEvent.click(screen.getAllByLabelText("brand.delete_category")[0]);
    await waitFor(() => expect(lastCollections().map((c) => c.id)).not.toContain("c-old"));
  });

  it("renames, moves and removes a graphic", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    fireEvent.click(category("Silhouetten"));
    answers.prompt = ["Rotklee"];
    fireEvent.click(screen.getAllByLabelText("brand.rename_graphic")[0]);
    await waitFor(() => expect(screen.getByText("Rotklee")).toBeTruthy()); // the upload renamed, no kit update
    expect(updates.length).toBe(0);
    answers.choose = "c-old";
    fireEvent.click(screen.getAllByLabelText("brand.move_graphic")[1]);
    await waitFor(() => expect(lastCollections().find((c) => c.id === "c-old")?.assetIds).toEqual(["a-icon", "a-mohn"]));
    fireEvent.click(screen.getAllByLabelText("brand.remove_graphic")[0]);
    await waitFor(() => expect(lastCollections().find((c) => c.id === "c-sil")?.assetIds).toEqual([]));
  });

  it("finds graphics across categories", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("brand.search"), { target: { value: "magen" } });
    expect(screen.getByText("Magen")).toBeTruthy();
    expect(screen.queryByText("Klee - Silhouette schwarz")).toBeNull();
  });

  it("is read-only without the rights to change the brand", async () => {
    render(<BrandPage workspaceId="ws" canEditKit={false} />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    expect(screen.queryByText("brand.new_category")).toBeNull();
    expect(screen.queryByText("brand.upload")).toBeNull();
    expect(screen.queryByLabelText("brand.remove_graphic")).toBeNull();
  });

  it("lets brand.library maintain the graphics but not the brand itself", async () => {
    render(<BrandPage workspaceId="ws" canEditKit={false} canEditLibrary />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    expect(screen.getByText("brand.new_category")).toBeTruthy();
    expect(screen.queryByText("brand.new_brand")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /editor.colors/ }));
    expect(screen.getByText("#006633")).toBeTruthy();
    expect(screen.queryByLabelText(/brand.remove_color/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /editor.logos/ }));
    expect(screen.getByText("Wortmarke")).toBeTruthy();
    expect(screen.queryByLabelText("editor.remove_logo")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /brand.settings/ }));
    expect(screen.queryByText("brand.delete_brand")).toBeNull();
  });

  it("changes colours, fonts and logos with brand.kits, one kit update each", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /editor.colors/ }));
    fireEvent.change(screen.getByLabelText("editor.hex"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: /editor.add_color/ }));
    await waitFor(() => expect((updates.at(-1) as BrandKit).palettes[0].colors.map((c) => c.role)).toEqual(["primary", "accent"]));
    fireEvent.click(screen.getByLabelText(/brand.remove_color.*#006633/));
    await waitFor(() => expect((updates.at(-1) as BrandKit).palettes[0].colors).toHaveLength(1));
    fireEvent.click(screen.getByRole("tab", { name: /editor.fonts/ }));
    fireEvent.click(screen.getByLabelText("editor.remove_font_role"));
    await waitFor(() => expect((updates.at(-1) as BrandKit).fonts).toEqual([]));
    fireEvent.click(screen.getByRole("tab", { name: /editor.logos/ }));
    answers.prompt = ["Bildmarke"];
    fireEvent.click(screen.getByLabelText("brand.rename_logo"));
    await waitFor(() => expect((updates.at(-1) as BrandKit).logos[0].label).toBe("Bildmarke"));
    fireEvent.click(screen.getByLabelText("editor.remove_logo"));
    await waitFor(() => expect((updates.at(-1) as BrandKit).logos).toEqual([]));
  });

  it("creates a new brand and deletes one", async () => {
    render(<BrandPage workspaceId="ws" canEditKit />);
    await waitFor(() => expect(category("Silhouetten")).toBeTruthy());
    fireEvent.click(screen.getByText("brand.new_brand"));
    answers.prompt = ["Zweitmarke"];
    fireEvent.click(screen.getByText("brand.create_empty"));
    await waitFor(() => expect(created).toEqual(["Zweitmarke"]));
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("k2"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "k1" } });
    fireEvent.click(screen.getByRole("tab", { name: /brand.settings/ }));
    fireEvent.click(screen.getByRole("button", { name: /brand.delete_brand/ }));
    await waitFor(() => expect(deleted).toEqual(["k1"]));
  });
});
