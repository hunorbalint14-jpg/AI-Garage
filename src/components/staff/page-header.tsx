export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    // The support launcher + notifications bell are fixed to the top-right of
    // the viewport (staff/layout.tsx), so a right-aligned action needs to keep
    // clear of them — otherwise it sits underneath on any page that has no
    // banner pushing the header down.
    <div className={`mb-6 flex items-start justify-between gap-4 ${action ? "pr-24" : ""}`}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
