import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  icon: LucideIcon;
  variant?: "default" | "primary" | "accent";
}

const iconVariants = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/10 text-accent",
};

const MetricCard = ({ label, value, change, icon: Icon, variant = "default" }: MetricCardProps) => (
  <div className="bg-card border border-border rounded-lg p-5 hover:border-primary/20 transition-colors">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        {change && <p className="text-xs text-terminal mt-1 font-mono">{change}</p>}
      </div>
      <div className={cn("w-10 h-10 rounded-md flex items-center justify-center", iconVariants[variant])}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  </div>
);

export default MetricCard;
