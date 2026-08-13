import { effect, signal } from "domily";

type ThemeObject = {
  light: string;
  dark: string;
  auto: string;
};

type ThemeType = keyof ThemeObject;

const THEME_KEY = "theme";
const BODY_THEME_ATTR = "theme";

const useThemeStore = () => {
  const previousTheme = (localStorage.getItem(THEME_KEY) ||
    "auto") as ThemeType;
  const theme = signal<ThemeType>(previousTheme);

  return {
    get theme() {
      const storeTheme = localStorage.getItem(THEME_KEY);
      const currentTheme = theme();
      if (storeTheme !== currentTheme) {
        localStorage.setItem(THEME_KEY, currentTheme);
      }
      return currentTheme;
    },
    set theme(nextTheme) {
      localStorage.setItem(THEME_KEY, nextTheme);
      theme(nextTheme);
    },
  };
};

const GLThemeRef = {
  matchMedia: window.matchMedia("(prefers-color-scheme: light)"),
  onThemeChanges: [] as ((
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void)[],
};

const dark = () => {
  document.body.setAttribute(BODY_THEME_ATTR, "dark");
};

const light = () => {
  document.body.removeAttribute(BODY_THEME_ATTR);
};

const checkTheme = (e: MediaQueryListEvent | { matches: boolean }) => {
  if (e.matches) {
    light();
  } else {
    dark();
  }
  if (GLThemeRef.onThemeChanges.length) {
    GLThemeRef.onThemeChanges.forEach((handleChange) =>
      handleChange("auto", e.matches ? "light" : "dark")
    );
  }
};

const removeAutoChangeThemeEvent = () => {
  GLThemeRef.matchMedia.removeEventListener("change", checkTheme);
};

const addAutoChangeThemeEvent = () => {
  removeAutoChangeThemeEvent();
  GLThemeRef.matchMedia.addEventListener("change", checkTheme);
};

function handleLight(
  onThemeChange?: (
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void
) {
  removeAutoChangeThemeEvent();
  light();
  if (typeof onThemeChange === "function") {
    onThemeChange("light", "light");
  }
}

function handleDark(
  onThemeChange?: (
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void
) {
  removeAutoChangeThemeEvent();
  dark();
  if (typeof onThemeChange === "function") {
    onThemeChange("dark", "dark");
  }
}

function handleAuto(
  onThemeChange?: (
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void
) {
  if (
    typeof onThemeChange === "function" &&
    !GLThemeRef.onThemeChanges.includes(onThemeChange)
  ) {
    GLThemeRef.onThemeChanges.push(onThemeChange);
  }
  checkTheme(GLThemeRef.matchMedia);
  addAutoChangeThemeEvent();
}

const switchTheme = (
  e: any,
  onThemeChange?: (
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void
) => {
  switch (e as ThemeType) {
    case "light":
      handleLight(onThemeChange);
      break;
    case "dark":
      handleDark(onThemeChange);
      break;
    case "auto":
      handleAuto(onThemeChange);
      break;
  }
};

const store = useThemeStore();
export default function useTheme(
  onThemeChange?: (
    e: ThemeType,
    details: keyof Omit<ThemeObject, "auto">
  ) => void
) {
  effect(() => {
    switchTheme(store.theme, onThemeChange);
  });
  return store;
}
