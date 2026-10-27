/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DesignFolder } from "@hc/sdk";
import { FolderPicker } from "./Folders";

afterEach(cleanup);

const folder = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId }) as DesignFolder;
const folders = [folder("a", "Labels"), folder("b", "Bags")];

describe("FolderPicker", () => {
  it("creates a subfolder in the folder its row belongs to", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async (name: string, parentId: string | null) => folder("n", name, parentId));
    render(<FolderPicker folders={folders} value="a" onChange={onChange} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "New folder in “Labels”" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Spring" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Spring", "a"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("n"));
  });

  it("makes New folder below the tree create in the picked folder", async () => {
    const onCreate = vi.fn(async (name: string, parentId: string | null) => folder("n", name, parentId));
    render(<FolderPicker folders={folders} value="b" onChange={() => {}} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: /^New folder$/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Winter" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Winter", "b"));
  });

  it("offers no creating without onCreate, and excluded folders cannot be picked", () => {
    const onChange = vi.fn();
    render(<FolderPicker folders={folders} value={null} onChange={onChange} exclude={new Set(["a"])} />);
    expect(screen.queryByRole("button", { name: /^New folder/ })).toBeNull();
    fireEvent.click(screen.getByText("Labels"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Bags"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
