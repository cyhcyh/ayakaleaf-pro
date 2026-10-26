import { useMemo } from 'react'
import Markdown from '../chat/markdown'

export default function MathText({ text }: { text: string }) {
  const source = useMemo(() => text.replace(/\\begin\{(equation\*?|align\*?|gather\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g,
    (_all, environment, body) => `\n\n$$\n${environment.startsWith('align') ? `\\begin{aligned}${body}\\end{aligned}` : environment.startsWith('gather') ? `\\begin{gathered}${body}\\end{gathered}` : body}\n$$\n\n`), [text])
  return <div className="pa-math-text"><Markdown text={source} /></div>
}
