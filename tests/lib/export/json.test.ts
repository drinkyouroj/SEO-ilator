import { describe, it, expect } from "vitest";
import { serializeJson, jsonContentDisposition } from "@/lib/export/json";

describe("serializeJson", () => {
  it("serializes_rows_to_pretty_json", () => {
    const rows = [{ id: "1", title: "Test" }];
    const result = serializeJson(rows);
    expect(JSON.parse(result)).toEqual(rows);
    // Pretty-printed with 2-space indent
    expect(result).toContain("\n");
  });

  it("returns_empty_array_for_no_rows", () => {
    expect(serializeJson([])).toBe("[]");
  });
});

describe("jsonContentDisposition", () => {
  it("returns_attachment_header_with_filename", () => {
    const result = jsonContentDisposition("report.json");
    expect(result).toBe('attachment; filename="report.json"');
  });

  it("escapes_quotes_in_filename", () => {
    const result = jsonContentDisposition('file"name.json');
    expect(result).toBe('attachment; filename="file\\"name.json"');
  });

  it("strips_newlines_from_filename", () => {
    const result = jsonContentDisposition("file\r\nname.json");
    expect(result).toBe('attachment; filename="filename.json"');
  });
});
