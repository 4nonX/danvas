// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@hc/sdk";
import type { PrintPolicy } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { clearanceOf, usePrintClearance } from "./printApproval";

vi.mock("@/lib/sdk", () => ({ oc: { getPrintPolicy: vi.fn() } }));
const get = vi.mocked(oc.getPrintPolicy);

const policy = (p: Partial<PrintPolicy>): PrintPolicy => ({ requireApproval: true, canChange: false, canBypass: false, approved: [], ...p });

describe("clearanceOf (F47)", () => {
  it("lets everything through when the rule is off or there is none", () => {
    expect(clearanceOf(null, ["a"]).held).toBe(false);
    expect(clearanceOf(policy({ requireApproval: false }), ["a"]).held).toBe(false);
  });

  it("does not hold up those who decide approvals", () => {
    expect(clearanceOf(policy({ canBypass: true }), ["a", "b"])).toMatchObject({ blocked: false, held: false, waiting: 0 });
  });

  it("counts the designs that still wait", () => {
    expect(clearanceOf(policy({ approved: ["a"] }), ["a", "b", "c"])).toMatchObject({ blocked: true, held: true, waiting: 2 });
    expect(clearanceOf(policy({ approved: ["a", "b"] }), ["a", "b"])).toMatchObject({ blocked: false, held: false, waiting: 0 });
  });

  it("holds back a design that is not saved yet", () => {
    expect(clearanceOf(policy({}), [])).toMatchObject({ blocked: true, waiting: 1 });
  });
});

describe("usePrintClearance", () => {
  afterEach(() => { cleanup(); get.mockReset(); });

  it("holds print files back while the rule loads", async () => {
    let answer!: (p: PrintPolicy) => void;
    get.mockReturnValue(new Promise((res) => { answer = res; }));
    const { result } = renderHook(() => usePrintClearance(true, "w", ["a"]));
    expect(result.current).toMatchObject({ state: "loading", held: true, blocked: false });
    await act(async () => { answer(policy({ requireApproval: false })); });
    expect(result.current).toMatchObject({ state: "known", held: false });
  });

  it("does not treat a failed request as no rule, and can retry", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => usePrintClearance(true, "w", ["a"]));
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.held).toBe(true);
    get.mockResolvedValueOnce(policy({ approved: ["a"] }));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current).toMatchObject({ state: "known", held: false }));
  });

  it("takes a server error as unknown, but no access as no rule to read", async () => {
    get.mockRejectedValueOnce(new ApiError(500, "/x", null));
    const a = renderHook(() => usePrintClearance(true, "w", ["a"]));
    await waitFor(() => expect(a.result.current.state).toBe("unavailable"));
    a.unmount();
    get.mockRejectedValueOnce(new ApiError(403, "/x", null));
    const b = renderHook(() => usePrintClearance(true, "w", ["a"]));
    await waitFor(() => expect(b.result.current).toMatchObject({ state: "known", held: false }));
  });

  it("needs no answer without a workspace or while closed", () => {
    expect(renderHook(() => usePrintClearance(true, null, ["a"])).result.current.held).toBe(false);
    expect(renderHook(() => usePrintClearance(false, "w", ["a"])).result.current.held).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("recheck sees an approval reopened while the dialog was open", async () => {
    get.mockResolvedValueOnce(policy({ approved: ["a"] }));
    const { result } = renderHook(() => usePrintClearance(true, "w", ["a"]));
    await waitFor(() => expect(result.current).toMatchObject({ state: "known", held: false }));
    get.mockResolvedValueOnce(policy({ approved: [] }));
    let fresh;
    await act(async () => { fresh = await result.current.recheck(); });
    expect(fresh).toMatchObject({ blocked: true, held: true });
    expect(result.current.blocked).toBe(true);
  });

  it("recheck that fails holds print files back", async () => {
    get.mockResolvedValueOnce(policy({ requireApproval: false }));
    const { result } = renderHook(() => usePrintClearance(true, "w", ["a"]));
    await waitFor(() => expect(result.current.state).toBe("known"));
    get.mockRejectedValueOnce(new Error("offline"));
    let fresh;
    await act(async () => { fresh = await result.current.recheck(); });
    expect(fresh).toMatchObject({ state: "unavailable", held: true });
  });

  it("forgets the answer when closed, so reopening asks again", async () => {
    get.mockResolvedValue(policy({ requireApproval: false }));
    const { result, rerender } = renderHook(({ open }) => usePrintClearance(open, "w", ["a"]), { initialProps: { open: true } });
    await waitFor(() => expect(result.current.state).toBe("known"));
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("known"));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
