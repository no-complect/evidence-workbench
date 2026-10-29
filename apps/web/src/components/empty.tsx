import type { FileText } from "lucide-react";

export function Empty({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: typeof FileText;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
