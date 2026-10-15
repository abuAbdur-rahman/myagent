import { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { cn } from "../lib/utils";

function useEffectiveTheme(): "dark" | "light" {
  const { theme } = useApp();
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);
  return theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
}

export function Logo({
  size,
  className,
  alt = "MyAgent logo",
}: {
  size: number;
  className?: string;
  alt?: string;
}) {
  const effective = useEffectiveTheme();
  return (
    <img
      src={effective === "dark" ? "/logo.svg" : "/logo-light.svg"}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={cn("flex-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
