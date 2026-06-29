import React, { useEffect, useReducer } from "react";
import { EN } from "./i18n.dict";

export type Lang = "ar" | "en";

const KEY = "mcc.lang";

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "ar";
}

let _lang: Lang = readInitial();
const listeners = new Set<() => void>();

function applyDir(): void {
  try {
    document.documentElement.dir = _lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = _lang;
  } catch {
    /* ignore (non-DOM env) */
  }
}
applyDir();

export function getLang(): Lang {
  return _lang;
}

export function setLang(l: Lang): void {
  if (l === _lang) return;
  _lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  applyDir();
  listeners.forEach((fn) => fn());
}

/**
 * Translate using the Arabic source string as the key. Returns the Arabic when
 * lang="ar", or the English from the dictionary (fallback: the Arabic) when "en".
 * Supports `{name}` placeholders: t("نجح {ok}/{total}", { ok, total }).
 * Plain function (not a hook) — usable anywhere, including helpers and constants.
 */
export function t(ar: string, vars?: Record<string, string | number>): string {
  let s = _lang === "en" ? (EN[ar] ?? ar) : ar;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

/** Subscribe a component to language changes (re-render on switch). */
export function useLang(): { lang: Lang; setLang: typeof setLang } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { lang: _lang, setLang };
}

/** Wrap the whole app so the entire tree re-renders when the language changes. */
export function LangProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  useLang();
  return <>{children}</>;
}
