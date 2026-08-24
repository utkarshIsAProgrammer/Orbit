import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderLinkifiedText, containsUrl } from "../linkify";

describe("renderLinkifiedText", () => {
  it("turns http(s) URLs into clickable links", () => {
    render(
      <div>{renderLinkifiedText("Check https://example.com/page")}</div>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/page");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("handles www. links by prepending https://", () => {
    render(<div>{renderLinkifiedText("see www.example.com now")}</div>);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://www.example.com");
  });

  it("strips trailing punctuation that is not part of the URL", () => {
    const { container } = render(
      <div>{renderLinkifiedText("Go to https://example.com, ok?")}</div>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    // The trailing comma + rest of the sentence remain as plain text
    expect(container.textContent).toContain(", ok?");
  });

  it("renders multiple URLs in one string", () => {
    render(
      <div>
        {renderLinkifiedText(
          "A https://a.com and B https://b.com end",
        )}
      </div>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("leaves plain text untouched", () => {
    render(<div>{renderLinkifiedText("just some words")}</div>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("just some words")).toBeTruthy();
  });

  it("passes non-URL segments through the renderText callback", () => {
    render(
      <div>
        {renderLinkifiedText("hi @user https://x.com", (seg) => (
          <strong>{seg}</strong>
        ))}
      </div>,
    );
    // Plain segment is wrapped by the callback
    expect(screen.getByText("hi @user").tagName).toBe("STRONG");
    expect(screen.getByRole("link")).toBeTruthy();
  });
});

describe("containsUrl", () => {
  it("detects URLs and ignores plain text", () => {
    expect(containsUrl("see https://x.com")).toBe(true);
    expect(containsUrl("see www.example.com")).toBe(true);
    expect(containsUrl("no links here")).toBe(false);
    expect(containsUrl("")).toBe(false);
  });
});
