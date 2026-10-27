import i18n from 'i18next'
import getMeta from '@/utils/meta'
import { localize } from '../../shared/localize.mjs'

// Keep extension copy together, rather than editing upstream locale files for
// every extension release. A language change reloads the page after saving.
export function ui(source: string, values: unknown[] = []) {
  const language = i18n.language || getMeta('ol-i18n')?.currentLangCode || 'zh-CN'
  return localize(source, language, values)
}
