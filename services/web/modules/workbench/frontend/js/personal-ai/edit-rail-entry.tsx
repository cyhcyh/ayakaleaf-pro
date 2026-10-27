import type { RailElement } from '@/features/ide-react/util/rail-types'
import AiEditsPanel from './edits-panel'

export default {
  key: 'ai-modifications',
  icon: 'edit_square',
  title: 'AI 修改',
  component: <AiEditsPanel />,
} satisfies RailElement
