import { useEffect, useState } from 'react'
import { copyTextToClipboard } from '@/utils/clipboard'
import { createRoot } from 'react-dom/client'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import MaterialIcon from '@/shared/components/material-icon'
import { ui } from '../ui'
import AdminNav from '../admin-nav'
import '../site-settings.scss'
import getMeta from '@/utils/meta'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import useThemedPage from '@/shared/hooks/use-themed-page'
import AdminPageHeader from '../admin-page-header'
import GithubLogo from '@/shared/svgs/github-logo'
import GitlabLogo from '@/shared/svgs/gitlab-logo'
import GiteaLogo from '@/shared/svgs/gitea-logo'
import DropboxLogo from '@/shared/svgs/dropbox-logo'
import ZoteroLogo from '@/shared/svgs/zotero-logo'
import MendeleyLogo from '@/shared/svgs/mendeley-logo'

type Provider = { enabled: boolean; clientId: string; clientSecret?: string; hasSecret: boolean; clearSecret?: boolean; url?: string; callback: string; active: boolean }
type Config = { revision: string; pending: boolean; siteURL: string; providers: Record<string, Provider> }
const names: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea', dropbox: 'Dropbox', zotero: 'Zotero', mendeley: 'Mendeley' }
const apps: Record<string, string> = { github: 'https://github.com/settings/developers', gitlab: 'https://gitlab.com/-/user_settings/applications', gitea: 'https://gitea.com/user/settings/applications', dropbox: 'https://www.dropbox.com/developers/apps', zotero: 'https://www.zotero.org/oauth/apps', mendeley: 'https://dev.mendeley.com/myapps.html' }
const logos: Record<string, React.ReactNode> = { github: <GithubLogo />, gitlab: <GitlabLogo />, gitea: <GiteaLogo />, dropbox: <DropboxLogo />, zotero: <ZoteroLogo />, mendeley: <MendeleyLogo /> }

function Integrations() {
  useThemedPage()
  const { isReady } = useWaitForI18n()
  const [config, setConfig] = useState<Config | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>(['github'])
  const toggle = (name: string) => setExpanded(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])
  useEffect(() => { getJSON<Config>('/admin/integrations/config').then(setConfig).catch(() => setError(ui('无法读取集成配置，请刷新重试。'))) }, [])
  const update = (name: string, values: Partial<Provider>) => {
    setNotice(''); setDirty(previous => previous.includes(name) ? previous : [...previous, name])
    setConfig(current => current && ({ ...current, providers: { ...current.providers, [name]: { ...current.providers[name], ...values } } }))
  }
  const save = async (name: string) => {
    if (!config) return
    setBusy(name); setError(''); setNotice('')
    try {
      const saved = await postJSON<Config>('/admin/integrations/config', { body: { revision: config.revision, providers: { [name]: config.providers[name] } } })
      setConfig(current => current && ({ ...saved, providers: { ...current.providers, [name]: saved.providers[name] } }))
      setDirty(previous => previous.filter(value => value !== name))
      setNotice(ui('已保存。重启应用后生效。'))
    } catch (error) { setError(ui((error as Error).message)) } finally { setBusy('') }
  }
  const copyCallback = async (provider: Provider) => {
    if (!config) return
    setError(''); setNotice('')
    if (await copyTextToClipboard(config.siteURL.replace(/\/+$/, '') + provider.callback)) {
      setNotice(ui('回调地址已复制。'))
    } else {
      setError(ui('无法复制，请手动复制回调地址。'))
    }
  }
  if (!isReady) return null
  return <div className="rogerleaf-admin-page rogerleaf-admin-integrations">
    <DefaultNavbar {...getMeta('ol-navbar')} showCloseIcon showThemeToggle />
    <div className="rogerleaf-admin-layout"><AdminNav active="integrations" />
    <main className="rogerleaf-admin-main" id="main-content"><section className="ayaka-admin rogerleaf-admin-content">
      <AdminPageHeader title={ui('集成配置')} description={ui('配置站点应用，用户再关联自己的账户。保存后重启应用生效。')} />
      {error && <div role="alert" className="alert alert-danger">{error}</div>}
      {notice && <div role="status" className="alert alert-success">{notice}</div>}
      {config?.pending && <div className="ayaka-admin-pending" role="status"><MaterialIcon type="restart_alt" /><span>{ui('配置待重启生效。重启 sharelatex 服务后，刷新此页查看状态。')}</span></div>}
      {!config && !error && <p role="status">{ui('正在读取…')}</p>}
      {config && Object.entries(config.providers).map(([name, provider]) => <section className="ayaka-admin-provider" key={name} aria-labelledby={`provider-${name}`}>
        <header><span className="ayaka-admin-provider-icon">{logos[name]}</span><h2 id={`provider-${name}`}>{names[name]}</h2><span className={`ayaka-integration-status ${provider.active ? 'ready' : ''}`}>{provider.active ? ui('已启用') : ui('未启用')}</span><label className="ayaka-admin-toggle"><input type="checkbox" checked={provider.enabled} disabled={Boolean(busy)} onChange={event => update(name, { enabled: event.target.checked })} />{ui('启用')}</label><button type="button" className="ayaka-admin-expand" aria-label={`${names[name]} ${ui(expanded.includes(name) ? '收起配置' : '展开配置')}`} aria-expanded={expanded.includes(name)} aria-controls={`provider-config-${name}`} onClick={() => toggle(name)}><span>{ui(expanded.includes(name) ? '收起配置' : '展开配置')}</span><MaterialIcon type={expanded.includes(name) ? 'expand_less' : 'expand_more'} /></button></header>
        <div id={`provider-config-${name}`} hidden={!expanded.includes(name)}><div className="ayaka-admin-fields">
          {provider.url !== undefined && <label><span>{ui('服务地址')}</span><input className="form-control" type="url" value={provider.url} onChange={event => update(name, { url: event.target.value })} /></label>}
          <label><span>{ui('应用 ID / Key')}</span><input className="form-control" value={provider.clientId} autoComplete="off" onChange={event => update(name, { clientId: event.target.value })} /></label>
          <label><span>{ui('应用密钥')}</span><input className="form-control" type="password" value={provider.clientSecret || ''} autoComplete="new-password" placeholder={provider.hasSecret && !provider.clearSecret ? ui('已设置，留空保留') : ui('填写应用密钥')} onChange={event => update(name, { clientSecret: event.target.value, clearSecret: false })} />{provider.hasSecret && <span className="ayaka-admin-clear"><input type="checkbox" checked={Boolean(provider.clearSecret)} onChange={event => update(name, { clearSecret: event.target.checked, clientSecret: '' })} />{ui('清除已保存的密钥')}</span>}</label>
          <label><span>{ui('授权回调地址')}</span><div className="ayaka-admin-copy"><input className="form-control" readOnly value={config.siteURL.replace(/\/+$/, '') + provider.callback} /><button type="button" className="btn btn-secondary" onClick={() => copyCallback(provider)} aria-label={ui('复制回调地址')}><MaterialIcon type="content_copy" /></button></div></label>
        </div>
        <footer><a href={apps[name]} target="_blank" rel="noopener noreferrer">{ui('注册应用')}<MaterialIcon type="open_in_new" /></a><button type="button" className="btn btn-primary" disabled={Boolean(busy) || !dirty.includes(name)} onClick={() => save(name)}>{busy === name ? ui('正在保存…') : ui('保存配置')}</button></footer></div>
      </section>)}
      <p className="ayaka-admin-intro">{ui('Git 与 MCP 需要部署 Git Bridge 服务。它们的连接信息在项目的集成面板中查看。')}</p>
    </section><Footer {...getMeta('ol-footer')} /></main></div>
  </div>
}
const root = document.getElementById('site-integrations-root')
if (root) createRoot(root).render(<SplitTestProvider><UserSettingsProvider><Integrations /></UserSettingsProvider></SplitTestProvider>)
