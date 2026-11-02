import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "white" | "warm" | "skyblue" | "violet";

const THEME_KEY = "jegz-theme";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "dark", setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "theme-white", "theme-warm", "theme-skyblue", "theme-violet");
    if (theme === "dark") root.classList.add("dark");
    else root.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
