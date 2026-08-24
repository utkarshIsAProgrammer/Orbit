import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHashtagTags } from "../mentions";

describe("renderHashtagTags", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders #tags as clickable spans", () => {
    render(<div>{renderHashtagTags("hello #world")}</div>);
    const tag = screen.getByText("#world");
    expect(tag).toBeTruthy();
    expect(tag.className).toContain("cursor-pointer");
  });

  it("dispatches the searchHashtag event on click", () => {
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation(() => true);
    render(<div>{renderHashtagTags("#design")}</div>);
    fireEvent.click(screen.getByText("#design"));
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("searchHashtag");
    expect(event.detail.hashtag).toBe("design");
  });

  it("calls onHashtagClick instead of dispatching when provided", () => {
    const handler = vi.fn();
    render(<div>{renderHashtagTags("#tech", handler)}</div>);
    fireEvent.click(screen.getByText("#tech"));
    expect(handler).toHaveBeenCalledWith("tech");
  });

  it("ignores word-chars before the # (C#sharp is not a tag)", () => {
    render(<div>{renderHashtagTags("C#sharp")}</div>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("passes non-tag segments through renderText", () => {
    const { container } = render(
      <div>
        {renderHashtagTags("hi #tag", undefined, (seg) => (
          <strong>{seg}</strong>
        ))}
      </div>,
    );
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toContain("hi");
    expect(screen.getByText("#tag")).toBeTruthy();
  });
});
