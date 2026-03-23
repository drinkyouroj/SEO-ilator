// tests/components/data/DataTable.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type ColumnDef } from "@/components/data/DataTable";

interface TestRow {
  id: string;
  name: string;
  score: number;
}

const columns: ColumnDef<TestRow>[] = [
  { key: "id", header: "ID" },
  { key: "name", header: "Name" },
  { key: "score", header: "Score" },
];

const rows: TestRow[] = [
  { id: "1", name: "Article A", score: 85 },
  { id: "2", name: "Article B", score: 72 },
];

describe("DataTable", () => {
  it("renders_column_headers_and_rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => (
          <div data-testid={`mobile-card-${row.id}`}>{row.name}</div>
        )}
      />
    );

    // Headers
    expect(screen.getByText("ID")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Score")).toBeDefined();

    // Row data (appears in both desktop table and mobile cards)
    expect(screen.getAllByText("Article A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Article B").length).toBeGreaterThan(0);
    expect(screen.getByText("85")).toBeDefined();
    expect(screen.getByText("72")).toBeDefined();
  });

  it("shows_skeleton_during_loading", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={[]}
        loading={true}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => <div>{row.name}</div>}
      />
    );

    const skeletons = container.querySelectorAll('[data-testid="skeleton-row"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows_empty_state_when_no_rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        loading={false}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => <div>{row.name}</div>}
        emptyMessage="No data available"
      />
    );

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
