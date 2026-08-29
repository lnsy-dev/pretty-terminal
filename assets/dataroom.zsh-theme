# dataroom.zsh-theme
#
# An Oh My Zsh theme matching the dataroom color scheme used by the
# pretty-terminal app (styles/dataroom-theme.css in the pretty-terminal repo).
#
# Every color is a named ANSI slot (%F{red}, %F{yellow}, ...) rather than a
# hard-coded hex or 256-color code, so the terminal emulator's own palette
# decides the actual hues. pretty-terminal maps the ANSI slots to the
# dataroom palette in both light and dark mode (see buildTerminalTheme in
# src/terminal-component.js), so this theme works in both color schemes
# unchanged.
#
# The git segment is self-contained (no git plugin dependency) and
# synchronous, so the branch and dirty/clean marker always render on the
# first prompt inside a repository.
#
# Install: copy this file to ${ZSH_CUSTOM:-$ZSH/custom}/themes/ and set
#   ZSH_THEME="dataroom"
# in ~/.zshrc.

# user@host, shown only for SSH sessions, in the muted black slot.
_dataroom_host() {
  if [[ -n "$SSH_CONNECTION" || -n "$SSH_CLIENT" ]]; then
    print -n "%F{black}%n@%m%f "
  fi
}

# Git segment: branch in the dataroom signature red, framed by blue
# guillemets; a yellow ✱ marks a dirty tree (including untracked files),
# a green ✓ a clean one. Prints nothing outside a repository.
_dataroom_git() {
  command git rev-parse --git-dir &>/dev/null || return 0

  local branch
  branch=$(command git symbolic-ref --short HEAD 2>/dev/null) \
    || branch=$(command git rev-parse --short HEAD 2>/dev/null) \
    || return 0

  if [[ -n $(command git status --porcelain 2>/dev/null) ]]; then
    print -n " %F{blue}‹%F{red}${branch} %F{yellow}✱%F{blue}›%f"
  else
    print -n " %F{blue}‹%F{red}${branch} %F{green}✓%F{blue}›%f"
  fi
}

# Single-line prompt:
#   [user@host ] path ‹branch ✓/✱› [exit code when non-zero] ❯
# The ❯ is green after success, red after failure.
PROMPT='$(_dataroom_host)%F{red}%~%f$(_dataroom_git)%(?.. %F{yellow}%?↵%f) %(?.%F{green}.%F{red})❯%f '
