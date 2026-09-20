# Script syntax

A NilVN script is a plain-text file (`.nvn` by convention), read line by line.
Four kinds of line exist: dialogue, narration, commands and comments. Everything
else — actors, plugins, aliases — can be declared either in the script or in the
[config file](config.md).

```
; a comment

[bg assets/bg/street.svg fade=1.5]          ; a command
|An evening street. Shadows stretch long.   ; narration (the | is optional)

[char yuki happy]                           ; show a character
yuki: You came! {wave:I've been waiting~}   ; dialogue with an inline text effect
yuki(angry): You're late again!             ; face in parentheses switches the sprite
[shake strength=14 duration=0.5]            ; a plugin command (screenfx)

[choice Apologize -> apologize]             ; consecutive choice lines form one prompt
[choice Make an excuse -> excuse if=courage>=2]

[label apologize]
me: I'm sorry...
[jump ending]
```

## Lines

| Line | Meaning |
|---|---|
| `[name positional key=value …]` | A command. Values with spaces go in quotes: `key="a b"` (single quotes work too). |
| `speaker: text` | Dialogue. A full-width colon `：` is accepted. |
| `speaker(face): text` | Dialogue that also switches the speaker's face; full-width parentheses `（）` are accepted. |
| `text` or `\|text` | Narration (no speaker). Use the leading `\|` when the text itself contains a colon, which would otherwise read as a speaker. |
| `; text` or `// text` | A comment. Blank lines are ignored. |

Everything is trimmed, so indentation is free. A line that starts with `[` must
also end with `]` to be a command; otherwise it is narration.

Consecutive `[choice …]` lines merge into a single choices prompt. Any other line
between them starts a new prompt.

## Inline markup

Inside dialogue and narration text:

| Markup | Meaning |
|---|---|
| `{effect:text}` | Apply an inline text effect contributed by a plugin (`{wave:…}`, `{shaky:…}`, `{rainbow:…}`, `{pop:…}`, `{fadein:…}` from `@nilvn/plugins`' `textfx`). |
| `{w:0.5}` | Pause the typewriter for that many seconds (`{w}` alone pauses 0.5 s). |
| `{br}` | Line break. |
| `\{`, `\}`, `\\` | A literal brace or backslash. A backslash escapes the next character. |

An unknown effect name is not an error: the text is shown plainly and a
diagnostic is reported.

## Text references

Where a line of text is expected — dialogue, narration, a choice label — a bare
`@key` token refers to an entry in the engine's content catalogs instead of a
literal:

```
yuki: @yuki_hi
[choice @choice_follow -> follow_yuki]
```

The engine resolves the key in the current language at display time, so a game
that ships catalogs for several languages can switch language mid-play. Catalogs
come from `createEngine({ catalogs })` or from a [script package](script-package.md);
the studio writes `@key` scripts for you. Hand-written scripts can mix literal text
and `@key` references freely.

## Commands

A command is `[name …]` with positional arguments and `key=value` parameters, in
any order. Built-in commands, the commands each active plugin adds, and the
parameter defaults are listed in [commands.md](commands.md). A command the engine
does not know is skipped with a diagnostic — a typo or a plugin you forgot to
`[use]` never stops the story.

Three built-ins are structural rather than stage commands:

- `[label name]` marks a jump target. Scene changes, branches and saves all
  address the script by label.
- `[jump label]` moves the playhead there.
- `[choice text -> label if=condition]` offers the player a branch. The `if=`
  condition hides the option when it is false.

## Variables and conditions

`[set name = expression]` writes a variable (the `=` is optional). `[if condition -> label]`
jumps when the condition is truthy, and a choice's `if=` uses the same grammar.
Variable names may contain any letters, including CJK characters.

Expressions support numbers, `'single'` / `"double"` quoted strings, variables,
the operators `+ - * / %`, comparisons `== != < <= > >=`, logical `&& || !` and
parentheses. They are evaluated by a small purpose-built evaluator, never by
`eval`, so a script cannot reach into the page.

```
[set affection = affection + 1]
[set route 'yuki']
[if affection >= 3 && route == 'yuki' -> good_end]
[choice Go with her -> follow if=affection>0]
```

## Macros and defaults

The config file (or `createEngine` options) can define command **macros** and
per-command **defaults**:

```toml
[defaults]
bg = { fade = 1.2 }

[macros]
bg_street = "bg @bg/street.svg"
quake = """
se @se/impact.wav volume=0.7
shake strength=14 duration=0.5
"""
```

In the script, `[bg_street]` expands to `[bg @bg/street.svg fade=1.2]`; a
one-line macro accepts extra parameters that override the macro's own
(`[bg_street fade=2]`). A multi-line macro is a sequence of commands run in
order. Macros may use other macros (nesting is limited to depth 8). Defaults
apply to every invocation of a command unless the script sets the parameter
explicitly.

## Actors

`[actor id name=… color=… textColor=… sprites=… face=…]` declares (or updates) a character:

- `name` — the name shown on the name tag (defaults to the id).
- `color` — the name tag's **background** colour (the theme's `name-bg` when absent).
- `textColor` — the name tag's **text** colour (the theme's `name-color` when absent).
- `sprites` — a sprite URL template where `{face}` is replaced by the current face,
  e.g. `@char/yuki-{face}.svg`.
- `face` — the default face.

Fields a later `[actor]` line does not mention are kept.

`[char id face]` then shows the character; `speaker(face): …` switches the face
while speaking. Actors can also be declared in the config file's `[actors.*]`
tables, which additionally accept `nameKey` (a catalog key for a localizable
name) and `voice` (the pitch of the typing blip, in Hz).

## Plugins

`[use …]` activates plugins for the script:

```
[use textfx screenfx]                 ; host-registered plugins by short name (app.nilvn.*)
[use app.nilvn.charfx]                ; or by id
[use ./plugins/neon/plugin.json]      ; a plugin package (manifest + module + styles)
[use ./plugins/glitch.js]             ; a bare plugin module
```

Paths resolve relative to the script (or the config file). A name that resolves to
nothing is recorded in `engine.missingPlugins` with a diagnostic; the commands and
effects it would have provided become no-ops and the story goes on.

## Paths and aliases

Resource paths (backgrounds, sprites, audio, plugins) resolve relative to the
script's directory, or to the config file's directory when one was loaded.
`[alias @bg assets/bg]` (or the config's `[path]` table) defines a prefix so a
script can write `@bg/street.svg`. In single-file builds every path is looked up
in an inline asset table first, so a bundled game needs no network access.

## Multi-language content

Ship one catalog per language and write the script with `@key` references. The
engine resolves text in `lang`, falling back to `defaultLang`, and `setLanguage`
(or the in-game menu) switches the language of the line currently on
screen without losing playback state. See [api.md](api.md#languages).
