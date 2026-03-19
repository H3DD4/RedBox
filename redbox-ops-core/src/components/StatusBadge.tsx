import { cn } from "@/lib/utils";

type StatusVariant = "online" | "offline" | "warning" | "critical" | "info";

const variants: Record<StatusVariant, string> = {
  online: "bg-accent/10 text-accent border-accent/20",
  offline: "bg-muted text-muted-foreground border-border",
  warning: "bg-warning/10 text-warning border-warning/20",
  critical: "bg-primary/10 text-primary border-primary/20",
  info: "bg-info/10 text-info border-info/20",
};

const dotVariants: Record<StatusVariant, string> = {
  online: "bg-accent",
  offline: "bg-muted-foreground",
  warning: "bg-warning",
  critical: "bg-primary",
  info: "bg-info",
};

interface StatusBadgeProps {
  variant: StatusVariant;
  label: string;
  className?: string;
  pulse?: boolean;
}

const StatusBadge = ({ variant, label, className, pulse = false }: StatusBadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider border",
      variants[variant],
      className
    )}
  >
    <span className={cn("w-1.5 h-1.5 rounded-full", dotVariants[variant], pulse && "animate-pulse-glow")} />
    {label}
  </span>
);

export default StatusBadge;
