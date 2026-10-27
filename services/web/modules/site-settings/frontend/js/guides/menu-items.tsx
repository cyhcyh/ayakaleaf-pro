import getMeta from '@/utils/meta'
import { useRailContext, type RailModalKey } from '@/features/ide-react/context/rail-context'
import { MenuBarOption } from '@/shared/components/menu-bar/menu-bar-option'
import { OLDropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import { guides } from '../../../shared/guides.mjs'

export default function GuideMenuItems({ toolbar = false }: { toolbar?: boolean }) {
  const { setActiveModal } = useRailContext()
  const language = getMeta('ol-i18n').currentLangCode === 'en' ? 1 : 0
  return <>{Object.entries(guides).map(([id, guide]) => {
    const key = `rogerleaf-guide-${id}` as RailModalKey
    const open = () => setActiveModal(key)
    return toolbar ? <MenuBarOption key={id} eventKey={key} title={guide.title[language]} onClick={open} /> : <OLDropdownItem key={id} onClick={open}>{guide.title[language]}</OLDropdownItem>
  })}</>
}
