import sanitizeHtml from "sanitize-html";

export const sanitize = (html: string): string => {
  return sanitizeHtml(html, {
    allowedTags: ["b", "i", "em", "strong", "a", "br", "p"],
    allowedAttributes: {
      a: ["href"],
    },
  });
};

export const sanitizePlainText = (text: string): string => {
  return sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
};
