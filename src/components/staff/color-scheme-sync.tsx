"use client";

import { useEffect } from "react";

export function ColorSchemeSync({ dark }: { dark: boolean }) {
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [dark]);

  return null;
}
