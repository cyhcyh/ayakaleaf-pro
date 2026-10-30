// Comments keep their original text. Only explicitly delimited formulae are
// typeset; prose, prices, escaped dollars and code examples stay literal.
/**
 * @typedef {{ type: 'text', value: string, start: number, end: number } |
 * { type: 'math', value: string, source: string, start: number, end: number, display: boolean }} CommentToken
 */
/** @param {string} text @returns {CommentToken[]} */
export function commentMath(text) {
  /** @type {CommentToken[]} */
  const tokens = [];
  let plain = 0;
  const add = (start, end, opening, closing, display) => {
    if (start > plain)
      tokens.push({
        type: "text",
        value: text.slice(plain, start),
        start: plain,
        end: start,
      });
    tokens.push({
      type: "math",
      value: text.slice(start + opening, end - closing),
      source: text.slice(start, end),
      start,
      end,
      display,
    });
    plain = end;
    return end;
  };
  for (let at = 0; at < text.length; ) {
    if (text[at] === "`") {
      let end = at + 1;
      while (text[end] === "`") end++;
      const close = text.indexOf(text.slice(at, end), end);
      at = close === -1 ? text.length : close + end - at;
      continue;
    }
    if (text[at] === "\\") {
      const next = text[at + 1];
      if (next === "(" || next === "[") {
        const close = text.indexOf(next === "(" ? "\\)" : "\\]", at + 2);
        if (close > at + 2) {
          at = add(at, close + 2, 2, 2, next === "[");
          continue;
        }
      }
      at += 2;
      continue;
    }
    if (text[at] === "$") {
      const display = text[at + 1] === "$",
        size = display ? 2 : 1;
      let close = at + size;
      for (; close < text.length; close++) {
        if (text[close] === "\\") {
          close++;
          continue;
        }
        if (text[close] === "`") break;
        if (!display && text[close] === "\n" && text[close + 1] === "\n") break;
        if (text[close] === "$" && (!display || text[close + 1] === "$")) break;
      }
      const valid =
        close < text.length &&
        text[close] === "$" &&
        close > at + size &&
        (display ||
          (/\S/.test(text[at + 1]) &&
            /\S/.test(text[close - 1]) &&
            !/\d/.test(text[close + 1] || "") &&
            text[close + 1] !== "$"));
      if (valid) {
        at = add(at, close + size, size, size, display);
        continue;
      }
      at += size;
      continue;
    }
    at++;
  }
  if (plain < text.length)
    tokens.push({
      type: "text",
      value: text.slice(plain),
      start: plain,
      end: text.length,
    });
  return tokens;
}

// Extend a collapsed preview to the closing delimiter instead of saving or
// displaying a fragment of a formula. The original comment is never changed.
export function commentMathLimit(text, limit) {
  const formula = commentMath(text).find(
    (token) =>
      token.type === "math" && token.start < limit && token.end > limit,
  );
  return formula ? formula.end : limit;
}
