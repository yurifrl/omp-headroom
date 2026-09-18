import { describe, expect, test } from "bun:test";

import headroomExtension, { cacheUsageLine, localCompressionLine } from "../src/index.ts";

describe("widget savings formatting", () => {
  test("keeps archive count beside abbreviated archive savings", () => {
    expect(
      localCompressionLine({
        sessionId: "session-1",
        stats: {
          savings: {
            per_project: {
              "session-1": {
                tokens_saved: 11_214_666,
                savings_percent: 2.9,
              },
            },
          },
        },
        tokensSaved: 0,
        tokensBefore: 0,
        sessionArchiveCharsBefore: 301_489,
        sessionArchiveCharsSaved: 283_400,
        sessionArchiveCompactions: 3,
      }),
    ).toBe("saved 11.2M · proxy 2.9% · arch 283.4kch ×3");
  });

  test("uses billions instead of expanding to thousands of millions", () => {
    expect(
      localCompressionLine({
        sessionId: "",
        stats: undefined,
        tokensSaved: 1_234_567_890,
        tokensBefore: 2_000_000_000,
        sessionArchiveCharsSaved: 0,
      }),
    ).toBe("saved 1.2B · 62%");
  });
});

describe("provider prompt cache formatting", () => {
  test("reports a token-weighted session hit rate and cache traffic", () => {
    expect(
      cacheUsageLine({
        cacheInputTokens: 16,
        cacheReadTokens: 72,
        cacheWriteTokens: 12,
      }),
    ).toBe("cache 72% · read 72 · write 12");
  });

  test("renders finalized provider cache usage on its own widget row", async () => {
    const fakeZod = new Proxy(function z() {}, {
      get: () => fakeZod,
      apply: () => fakeZod,
    });
    const handlers = new Map();
    let widgetLines = [];
    headroomExtension({
      zod: fakeZod,
      setLabel() {},
      logger: { warn() {} },
      on(event, handler) {
        handlers.set(event, handler);
      },
      registerTool() {},
      registerCommand() {},
      registerFlag() {},
    });
    const ctx = {
      hasUI: true,
      ui: {
        setWidget(_key, lines) {
          widgetLines = lines;
        },
        setStatus() {},
      },
    };

    await handlers.get("message_end")(
      {
        message: {
          role: "assistant",
          usage: { input: 16, cacheRead: 72, cacheWrite: 12 },
        },
      },
      ctx,
    );

    const cacheRows = widgetLines.filter((line) => line.includes("cache "));
    expect(cacheRows).toHaveLength(1);
    expect(cacheRows[0]).toContain("cache 72% · read 72 · write 12");
  });
});

describe("widget visibility toggle", () => {
  function harness() {
    const fakeZod = new Proxy(function z() {}, {
      get: () => fakeZod,
      apply: () => fakeZod,
    });
    const handlers = new Map();
    const commands = new Map();
    const notifications = [];
    let lastWidget;
    let cleared = false;
    headroomExtension({
      zod: fakeZod,
      setLabel() {},
      logger: { warn() {} },
      on(event, handler) {
        handlers.set(event, handler);
      },
      registerTool() {},
      registerCommand(name, spec) {
        commands.set(name, spec);
      },
      registerFlag() {},
    });
    const command = commands.get("headroom");
    const ctx = {
      hasUI: true,
      ui: {
        setWidget(_key, lines) {
          if (lines === undefined) cleared = true;
          lastWidget = lines;
        },
        setStatus() {},
        notify(message) {
          notifications.push(message);
        },
      },
    };
    return { command, ctx, notifications, lastWidget: () => lastWidget, cleared: () => cleared };
  }

  test("hides and clears the widget for the session", async () => {
    const h = harness();
    await h.command.handler("widget off", h.ctx);
    expect(h.cleared()).toBe(true);
    expect(h.lastWidget()).toBeUndefined();
    expect(h.notifications.join(" ")).toContain("hidden");
  });

  test("shows the widget again and renders rows", async () => {
    const h = harness();
    await h.command.handler("widget off", h.ctx);
    await h.command.handler("widget on", h.ctx);
    expect(Array.isArray(h.lastWidget())).toBe(true);
    expect(h.notifications.join(" ")).toContain("shown");
  });

  test("bare command toggles the current session state", async () => {
    const h = harness();
    await h.command.handler("widget", h.ctx);
    expect(h.cleared()).toBe(true);
    await h.command.handler("widget", h.ctx);
    expect(Array.isArray(h.lastWidget())).toBe(true);
  });

  test("rejects unknown arguments without touching the widget", async () => {
    const h = harness();
    await h.command.handler("widget maybe", h.ctx);
    expect(h.notifications.join(" ")).toContain("Usage: /headroom widget [on|off]");
    expect(h.lastWidget()).toBeUndefined();
    expect(h.cleared()).toBe(false);
  });
});
