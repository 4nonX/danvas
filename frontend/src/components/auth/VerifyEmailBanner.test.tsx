// @vitest-environment jsdom

// The "verify your email" banner appears only when the instance can send email
// (without SMTP the link never reaches anyone), and a dismissal is remembered.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const authConfig = vi.fn();
vi.mock("@/lib/sdk", () => ({ oc: { authConfig: () => authConfig(), requestEmailVerification: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const user = { id: "u1", email: "dan@example.org", emailVerified: false };
vi.mock("@/store/auth", () => ({ useAuth: (sel: (s: { user: typeof user }) => unknown) => sel({ user }) }));

const { VerifyEmailBanner } = await import("./VerifyEmailBanner");

beforeEach(() => {
  cleanup();
  // An own store: newer Node versions put their own localStorage in the way of
  // jsdom's, undefined unless Node is given a file for it.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  authConfig.mockReset();
});

describe("verify email banner", () => {
  it("stays away when the instance cannot send email", async () => {
    authConfig.mockResolvedValue({ providers: [], policy: {}, captcha: null, emailDelivery: false });
    const { container } = render(<VerifyEmailBanner />);
    await waitFor(() => expect(authConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("shows when the instance can send email, and remembers being dismissed", async () => {
    authConfig.mockResolvedValue({ providers: [], policy: {}, captcha: null, emailDelivery: true });
    render(<VerifyEmailBanner />);
    expect(await screen.findByText("dan@example.org")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("auth.dismiss"));
    expect(screen.queryByText("dan@example.org")).toBeNull();

    cleanup();
    const { container } = render(<VerifyEmailBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("keeps the old behavior with a server that does not say (before 0.2.0)", async () => {
    authConfig.mockResolvedValue({ providers: [], policy: {}, captcha: null });
    render(<VerifyEmailBanner />);
    expect(await screen.findByText("dan@example.org")).toBeTruthy();
  });
});
