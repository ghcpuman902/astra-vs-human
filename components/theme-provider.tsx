"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

/**
 * Follow the device until a click disagrees with it.
 * A later click that lands back on the device preference clears the override,
 * so the next system change is followed again.
 */
function useThemeChoice() {
  const { resolvedTheme, systemTheme, setTheme } = useTheme()
  const chooseOpposite = React.useCallback(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return
    const next = resolvedTheme === "dark" ? "light" : "dark"
    setTheme(systemTheme && next === systemTheme ? "system" : next)
  }, [resolvedTheme, systemTheme, setTheme])
  return chooseOpposite
}

function ThemeHotkey() {
  const chooseOpposite = useThemeChoice()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      chooseOpposite()
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [chooseOpposite])

  return null
}

/** Icons follow `.dark`. The `d` hotkey uses the same choice. */
function ThemeToggle() {
  const chooseOpposite = useThemeChoice()

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label="Toggle color theme"
      onClick={chooseOpposite}
    >
      <Sun className="theme-icon theme-icon-sun" aria-hidden="true" />
      <Moon className="theme-icon theme-icon-moon" aria-hidden="true" />
    </button>
  )
}

export { ThemeProvider, ThemeToggle }
