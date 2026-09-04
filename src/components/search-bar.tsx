"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

/**
 * Debounced search box that pushes `?<paramName>=...` into the URL,
 * preserving any other query params already there (e.g. a muscle-group
 * filter chip). Client-side because a plain GET <form> with no visible
 * submit button turned out to be an unreliable/unclear way to trigger a
 * search (relying on the user knowing to press Enter).
 */
export function SearchBar({
  paramName = "q",
  placeholder,
}: {
  paramName?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      const current = new URLSearchParams(searchParams.toString());
      if (value) {
        current.set(paramName, value);
      } else {
        current.delete(paramName);
      }
      const qs = current.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 300);
    return () => clearTimeout(handle);
    // Only re-run when the typed value changes — re-running on every
    // searchParams/router identity change would fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
    />
  );
}
