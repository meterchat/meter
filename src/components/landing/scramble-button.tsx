"use client";

import { useState, memo, useRef, useLayoutEffect, ReactNode, ComponentProps } from "react";
import { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrambleButtonText } from "./scramble-text";

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

interface ScrambleButtonProps extends ButtonProps {
  scrambleDuration?: number;
  children: string;
  icon?: ReactNode;
}

export const ScrambleButton = memo(function ScrambleButton({
  scrambleDuration = 0.4,
  children,
  className,
  icon,
  ...buttonProps
}: ScrambleButtonProps) {
  const [hoverKey, setHoverKey] = useState(0);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (measureRef.current) {
      setTextWidth(measureRef.current.offsetWidth);
    }
  }, [children]);

  return (
    <Button
      {...buttonProps}
      className={className}
      onMouseEnter={(e) => {
        setHoverKey((prev) => prev + 1);
        buttonProps.onMouseEnter?.(e);
      }}
    >
      {icon}
      <span
        ref={measureRef}
        className="absolute invisible whitespace-nowrap"
        style={{ fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit" }}
        aria-hidden="true"
      >
        {children}
      </span>
      <span
        className="inline-block whitespace-nowrap overflow-hidden"
        style={{ width: textWidth ? `${textWidth}px` : "auto" }}
      >
        <ScrambleButtonText
          key={hoverKey}
          text={children}
          duration={scrambleDuration}
          scrambleOnChange={true}
          skipInitialAnimation={hoverKey === 0}
        />
      </span>
    </Button>
  );
});
