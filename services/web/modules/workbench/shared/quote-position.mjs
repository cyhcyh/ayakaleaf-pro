// Shared by native comment tools and their focused regression tests.
export function findUniqueQuote(content, quote) {
  if (!quote?.trim()) throw new Error("评论必须包含原文引用");
  const position = content.indexOf(quote);
  if (position < 0) throw new Error("原文已变化，请重新阅读后定位评论");
  if (content.indexOf(quote, position + 1) >= 0)
    throw new Error("引用出现多次，请提供更多上下文");
  return position;
}
