import assert from "node:assert/strict";
import test from "node:test";
import { commentMath, commentMathLimit } from "../shared/comment-math.mjs";

test("comment formulae support inline and display delimiters without changing the stored text", () => {
  const text =
    "中文 $L=D-A$ and \\(x_i\\), then $$\\sum_i x_i$$ and \\[\\frac{1}{2}\\].";
  const tokens = commentMath(text),
    formulae = tokens.filter((row) => row.type === "math");
  assert.deepEqual(
    formulae.map((row) => row.display),
    [false, false, true, true],
  );
  assert.deepEqual(
    formulae.map((row) => row.value),
    ["L=D-A", "x_i", "\\sum_i x_i", "\\frac{1}{2}"],
  );
  assert.equal(tokens.map((row) => row.source || row.value).join(""), text);
});

test("prices, escaped dollars, code examples and incomplete math stay literal", () => {
  for (const text of [
    "Cost $5 and $10.",
    "Cost $5 and $10. `$x$`",
    "\\$x\\$",
    "`$x$`",
    "```tex\n$$x$$\n```",
    "Unclosed $x",
    "Unclosed \\[x",
    "$ x $",
    "$x\n\ny$",
  ])
    assert.equal(
      commentMath(text).some((row) => row.type === "math"),
      false,
      text,
    );
  assert.equal(
    commentMath("`$x$` then $y$").filter((row) => row.type === "math")[0].value,
    "y",
  );
});

test("collapsed comments keep a formula whole, including multiline display math", () => {
  const formula = "$$\n\\sum_{i=1}^{n} x_i = 0\n$$";
  const text = "说明\n" + formula + "\n后续说明";
  assert.equal(commentMathLimit(text, 12), text.indexOf("\n后续说明"));
  assert.equal(commentMathLimit(text, 2), 2);
  assert.equal(commentMathLimit(text, text.length), text.length);
  assert.equal(commentMathLimit("plain text only", 5), 5);
});
