export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1 className="page-title">{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
