import { describe, it, expect } from "vitest";
import { classifyHttpError } from "@/lib/ingestion/types";

describe("classifyHttpError", () => {
  it("classifies_429_as_transient", () => {
    expect(classifyHttpError(429)).toBe("transient");
  });

  it("classifies_502_as_transient", () => {
    expect(classifyHttpError(502)).toBe("transient");
  });

  it("classifies_503_as_transient", () => {
    expect(classifyHttpError(503)).toBe("transient");
  });

  it("classifies_504_as_transient", () => {
    expect(classifyHttpError(504)).toBe("transient");
  });

  it("classifies_400_as_permanent", () => {
    expect(classifyHttpError(400)).toBe("permanent");
  });

  it("classifies_403_as_permanent", () => {
    expect(classifyHttpError(403)).toBe("permanent");
  });

  it("classifies_404_as_permanent", () => {
    expect(classifyHttpError(404)).toBe("permanent");
  });

  it("classifies_500_as_permanent", () => {
    expect(classifyHttpError(500)).toBe("permanent");
  });

  it("classifies_418_as_permanent", () => {
    expect(classifyHttpError(418)).toBe("permanent");
  });
});
