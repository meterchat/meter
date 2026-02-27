import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CornerMarkersProps {
  children: ReactNode;
  className?: string;
  showLines?: boolean;
}

export function CornerMarkers({ children, className, showLines = true }: CornerMarkersProps) {
  const markerStyle =
    "absolute text-muted-foreground/30 text-xl font-light select-none pointer-events-none z-10";
  const offset = "-0.75rem";

  return (
    <div className={cn("relative", className)}>
      {showLines && (
        <div
          className="absolute inset-0 border border-dashed border-muted-foreground/20 pointer-events-none"
          style={{ margin: offset }}
        />
      )}
      <span className={markerStyle} style={{ top: offset, left: offset, transform: "translate(-50%, -50%)" }}>+</span>
      <span className={markerStyle} style={{ top: offset, right: offset, transform: "translate(50%, -50%)" }}>+</span>
      <span className={markerStyle} style={{ bottom: offset, left: offset, transform: "translate(-50%, 50%)" }}>+</span>
      <span className={markerStyle} style={{ bottom: offset, right: offset, transform: "translate(50%, 50%)" }}>+</span>
      {children}
    </div>
  );
}
