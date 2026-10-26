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
  return { text: protectedText, restore(translated) {
    let result = translated;
    for (const { token, formula } of formulas) {
      if (!result.includes(token)) throw new Error('翻译服务改动了数学公式标记，请切换翻译服务重试');
      result = result.replaceAll(token, () => formula);
    }
    return result;
  } };
}
