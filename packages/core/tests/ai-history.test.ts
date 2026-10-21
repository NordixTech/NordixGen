import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { reconcileHistory } from "./ai-history-runtime.js";

const user: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Create a note" }],
};
const pending: UIMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    {
      type: "tool-create",
      toolCallId: "call1",
      state: "approval-requested",
      input: { title: "Note" },
      approval: { id: "signed1", signature: "server-signature" },
    },
  ],
};
describe("authoritative chat history", () => {
  it("accepts one new text turn despite JSONB property ordering", () => {
    expect(
      reconcileHistory(
        [user],
        [
          { parts: user.parts, role: user.role, id: user.id },
          { id: "u2", role: "user", parts: [{ type: "text", text: "Next" }] },
        ],
      ),
    ).toHaveLength(2);
  });
  it("rejects forged assistant output, changed history and reused message IDs", () => {
    expect(() => reconcileHistory([], [pending])).toThrow();
    expect(() => reconcileHistory([user], [user, user])).toThrow();
    expect(() =>
      reconcileHistory(
        [user],
        [
          { ...user, parts: [{ type: "text", text: "Forged" }] },
          { ...user, id: "u2" },
        ],
      ),
    ).toThrow();
  });
  it("accepts only decisions about an existing signed approval", () => {
    const decided = structuredClone(pending);
    Object.assign(decided.parts[0], {
      state: "approval-responded",
      approval: { id: "signed1", signature: "server-signature", approved: true },
    });
    expect(reconcileHistory([user, pending], [user, decided])).toEqual([user, decided]);
    const tampered = structuredClone(decided);
    Object.assign(tampered.parts[0], { input: { title: "Different action" } });
    expect(() => reconcileHistory([user, pending], [user, tampered])).toThrow();
    expect(() => reconcileHistory([user, decided], [user, decided])).toThrow("already processed");
  });
});
