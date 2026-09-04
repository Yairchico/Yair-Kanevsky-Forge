import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

function SearchInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-muted-foreground/70" />
      <input
        type="search"
        className={cn(
          "h-11 w-full rounded-full border border-input bg-card ps-10 pe-4 text-sm shadow-xs outline-none transition-all placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export { SearchInput };
