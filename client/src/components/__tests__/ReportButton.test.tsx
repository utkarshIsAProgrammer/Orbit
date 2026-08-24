import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReportButton from "../ReportButton";

describe("ReportButton", () => {
  it("opens the modal and keeps it open after selecting a reason", () => {
    render(<ReportButton contentType="post" contentId="abc" />);
    fireEvent.click(screen.getByTitle("Report this content"));

    // Modal is open with the reason list
    expect(screen.getByText("Report Content")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Spam"));

    // Still open, reason selected — the outside-click handler must not have
    // closed it (the reason is inside the modal ref).
    expect(screen.getByText("Report Content")).toBeInTheDocument();
    expect(screen.getByText("Submit Report")).toBeEnabled();
  });

  it("regression: report from a menu opens the modal even when the menu closes", () => {
    // Mirrors the fixed CommentNode: the menu item only records WHICH comment
    // to report (closing the menu), while the ReportButton renders OUTSIDE the
    // menu's conditional with initialOpen. Previously the ReportButton lived
    // inside the menu (wrapped in an onClickCapture that closed the menu) —
    // React runs capture handlers before the button's onClick, so the menu
    // and the ReportButton unmounted before the modal could open ("click
    // Report and the container disappears").
    function CommentMenu() {
      const [menuOpen, setMenuOpen] = useState(false);
      const [reportId, setReportId] = useState<string | null>(null);
      return (
        <div>
          <button onClick={() => setMenuOpen(true)}>open menu</button>
          {menuOpen && (
            <div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setReportId("abc");
                }}
              >
                Report
              </button>
            </div>
          )}
          {reportId && (
            <ReportButton
              contentType="comment"
              contentId={reportId}
              initialOpen
              onClose={() => setReportId(null)}
            />
          )}
        </div>
      );
    }

    render(<CommentMenu />);
    fireEvent.click(screen.getByText("open menu"));
    fireEvent.click(screen.getByText("Report"));

    // The modal must be open with reasons to pick from — the menu closed, but
    // the modal (rendered outside it) survives.
    expect(screen.getByText("Report Content")).toBeInTheDocument();
    expect(screen.getByText("Spam")).toBeInTheDocument();
  });
});
