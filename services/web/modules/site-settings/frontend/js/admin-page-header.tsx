import type { ReactNode } from 'react'

export default function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="rogerleaf-admin-page-header">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="rogerleaf-admin-heading-actions">{actions}</div>}
  </header>
}
