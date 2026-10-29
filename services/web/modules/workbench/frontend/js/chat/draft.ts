import type { FileUIPart } from 'ai'

export type ReferenceAttachment = { id: string; name: string; mediaType: string }
export type DraftContext = {
  path: string
  selection: { fromLine: number; toLine: number; content: string }[]
}
export type Draft = {
  text: string
  files: FileUIPart[]
  references?: ReferenceAttachment[]
  context?: DraftContext
}
export type QueuedMessage = Draft & { id: string; context: DraftContext }
