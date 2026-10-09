import { createLink } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ButtonAnchor = ({
  children,
  className,
  variant,
  size,
  disabled: _disabled,
  ...props
}: ComponentProps<"a"> &
  VariantProps<typeof buttonVariants> & {
    disabled?: boolean;
  }) => (
  <a
    {...props}
    className={cn(
      buttonVariants({ variant, size }),
      "aria-disabled:pointer-events-none aria-disabled:opacity-50",
      className,
    )}
  >
    {children}
  </a>
);
export const ButtonLink = createLink(ButtonAnchor);
