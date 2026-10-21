import { describe, expect, it, vi } from "vitest";
import { composeExampleBackend } from "../../../docs/configuration/module-communication.js";

const customerId = "123e4567-e89b-12d3-a456-426614174000";
const customer = { id: customerId, name: "Example Customer" };

function fixture() {
  const findById = vi.fn(async (_id: string) => customer as typeof customer | undefined);
  // Controlled session verifier at the trusted entry; cookies are never principals.
  const verifySession = vi.fn(async (cookie: string | null) => {
    const role = new Map([
      ["valid-admin-session", "admin"],
      ["valid-viewer-session", "viewer"],
      ["valid-accountant-session", "accountant"],
    ]).get(cookie ?? "");
    const permissions: Record<string, string[]> = {
      admin: ["*"],
      viewer: ["customers:read"],
      accountant: ["invoices:read"],
    };
    return role ? { id: "verified-user", role, permissions: permissions[role] } : null;
  });
  return { ...composeExampleBackend(verifySession, { findById }), findById, verifySession };
}

describe("typed in-process communication design example", () => {
  it("performs an authored consumer call through the producer's public contract", async () => {
    const backend = fixture();
    expect(await backend.previewFromSession({ customerId }, "valid-admin-session")).toEqual({
      ok: true,
      value: { customer },
    });
    expect(backend.verifySession).toHaveBeenCalledWith("valid-admin-session");
    expect(backend.findById).toHaveBeenCalledExactlyOnceWith(customerId);
  });

  it.each([null, "fabricated-cookie", "expired-session"])(
    "rejects an unverified session: %s",
    async (cookie) => {
      const backend = fixture();
      expect(await backend.previewFromSession({ customerId }, cookie)).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      expect(backend.findById).not.toHaveBeenCalled();
    },
  );

  it.each(["valid-viewer-session", "valid-accountant-session"])(
    "checks both caller and callee policy: %s",
    async (cookie) => {
      const backend = fixture();
      // Viewer cannot enter Billing; Accountant enters Billing but cannot read Customers.
      expect(await backend.previewFromSession({ customerId }, cookie)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(backend.findById).not.toHaveBeenCalled();
    },
  );

  it("rejects fabricated principal objects at direct application entries", async () => {
    const backend = fixture();
    const forged = { principal: { id: "attacker", role: "admin" } };
    expect(await backend.customers.getCustomer({ customerId }, forged)).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(await backend.billing.previewForCustomer({ customerId }, forged)).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(backend.findById).not.toHaveBeenCalled();
  });

  it("validates application input on internal calls before persistence", async () => {
    const backend = fixture();
    expect(
      await backend.previewFromSession({ customerId: "invalid" }, "valid-admin-session"),
    ).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    expect(backend.findById).not.toHaveBeenCalled();
  });

  it("propagates an explicit authored application failure and contains private errors", async () => {
    const backend = fixture();
    backend.findById.mockResolvedValueOnce(undefined);
    expect(await backend.previewFromSession({ customerId }, "valid-admin-session")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    backend.findById.mockRejectedValueOnce(new Error("private database credentials"));
    const failedLookup = await backend.previewFromSession({ customerId }, "valid-admin-session");
    expect(failedLookup).toEqual({
      ok: false,
      error: { code: "unexpected", message: "Customer lookup failed." },
    });
    backend.verifySession.mockRejectedValueOnce(new Error("private session secret"));
    expect(await backend.previewFromSession({ customerId }, "valid-admin-session")).toEqual({
      ok: false,
      error: { code: "unexpected", message: "Session or application is unavailable." },
    });
  });
});
