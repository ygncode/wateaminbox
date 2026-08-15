import type { ComponentPropsWithoutRef } from "react";

type BrandMarkProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src"> & {
  alt?: string;
};

/** The product mark shared by branded application surfaces. */
export function BrandMark({ alt = "", ...props }: BrandMarkProps) {
  return <img src="/favicon.svg" alt={alt} {...props} />;
}
