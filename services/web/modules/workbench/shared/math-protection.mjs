// Preserve recognizable TeX math while a translation service handles prose.
const MATH = /\\begin\{(equation\*?|align\*?|gather\*?|displaymath)\}[\s\S]*?\\end\{\1\}|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$(?!\$)(?=\S)[^\n$]*?\S\$(?![\d$])/g;

export function protectMath(text, nonce) {
  const formulas = [];
  const prefix = `ZXQMATHTOKEN${nonce.replace(/[^a-z0-9]/gi, '')}`;
  const protectedText = text.replace(MATH, formula => {
    const token = `${prefix}${formulas.length}QXZ`;
    formulas.push({ token, formula });
    return token;
  });
  return { text: protectedText, restorePartial(translated) {
    let result = translated;
    for (const { token, formula } of formulas) result = result.replaceAll(token, () => formula);
    if (!formulas.length) return result;
    // A network chunk may end anywhere inside a formula token. Hold that tail
    // until the complete token can be replaced with its original formula.
    const marker = 'ZXQMATHTOKEN';
    const pending = result.indexOf(marker);
    if (pending !== -1) return result.slice(0, pending);
    for (let length = Math.min(marker.length - 1, result.length); length > 0; length--) {
      if (result.endsWith(marker.slice(0, length))) return result.slice(0, -length);
    }
    return result;
  }, restore(translated) {
    let result = translated;
    for (const { token, formula } of formulas) {
      if (!result.includes(token)) throw new Error('翻译服务改动了数学公式标记，请切换翻译服务重试');
      result = result.replaceAll(token, () => formula);
    }
    return result;
  } };
}
