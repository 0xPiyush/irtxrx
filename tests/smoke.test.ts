import { describe, expect, it } from "bun:test";

describe("irtx", () => {
  it("should export from index", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeDefined();
  });
});
