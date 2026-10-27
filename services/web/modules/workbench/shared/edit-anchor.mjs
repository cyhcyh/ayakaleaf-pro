export function locateEdit(content, before, startLine) {
  if (!before) {
    const lines = content.split('\n');
    if (startLine < 1 || startLine > lines.length) throw new Error('插入位置已变化，请重新生成修改建议');
    return lines.slice(0, startLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
  }
  const at = content.indexOf(before);
  if (at < 0) throw new Error('正文已变化，请重新生成修改建议');
  if (content.indexOf(before, at + 1) !== -1) throw new Error('原文出现多次，请提供更完整的上下文以准确定位');
  return at;
}

export function makeAnchor(content, at, before, after) {
  return { before, after, prefix: content.slice(Math.max(0, at - 60), at), suffix: content.slice(at + before.length, at + before.length + 60),
    atStart: at === 0, atEnd: at + before.length === content.length };
}

export function anchorMatches(content, anchor, which) {
  const target = anchor.prefix + anchor[which] + anchor.suffix;
  if (!target) return content === '';
  const at = content.indexOf(target);
  if (at < 0 || content.indexOf(target, at + 1) !== -1) return false;
  return (!anchor.atStart || at === 0) && (!anchor.atEnd || at + target.length === content.length);
}

export function locateAnchoredEdit(content, before, startLine, anchor) {
  if (anchor) {
    const value = { ...anchor, target: before };
    if (anchorMatches(content, value, 'target')) return content.indexOf(anchor.prefix + before + anchor.suffix) + anchor.prefix.length;
  }
  if (!before) throw new Error('插入或删除位置的上下文已变化，请重新生成修改建议');
  return locateEdit(content, before, startLine);
}
