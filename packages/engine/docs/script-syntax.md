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
| `{p}` | Page break: the text so far waits for a tap (auto and skip turn the page), then the box clears and the rest types. With `[window] overflow = "page"` the engine also breaks pages where the text would run past the box. |
| `{$var}` | The current value of a variable (session or persistent), filled when the line is shown. An undefined variable shows as empty and reports one diagnostic. Lists (`{$sys.endings}`) join with commas. |
| `{@key}` | A content-catalog entry inline, in the current language — see [Text references](#text-references). |
| `\{`, `\}`, `\\` | A literal brace or backslash. A backslash escapes the next character. |

Placeholders nest inside an effect: `{wave:{$player}}` waves the player's name.
An effect whose whole content is a bare `@key` resolves it too (`{pop:@route.name}`).
Actor names take the same placeholders (`[actor me name={$player}]`, or a catalog
entry `"actor.me" = "{$player}"`), so a name the player typed shows on the name tag.

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
and `@key` references freely. Inside a line, `{@key}` embeds an entry mid-sentence;
a catalog entry may itself carry `{$var}` placeholders (`"Hello {$player}"`), which
are filled after the key resolves.

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
- `[choice text -> label if=condition disabled=condition]` offers the player a
  branch. The `if=` condition hides the option when it is false; `disabled=`
  shows it greyed and unpickable when true. Both run to the end of the tag.

## Variables and conditions

`[set name = expression]` writes a variable (the `=` is optional). `[if condition -> label]`
jumps when the condition is truthy, and a choice's `if=` uses the same grammar
(the condition runs to the end of the tag, so it may contain spaces). Variable
names may contain any letters, including CJK characters, and dots (`sys.endings`).

Expressions support numbers, `'single'` / `"double"` quoted strings, variables,
the operators `+ - * / %`, comparisons `== != < <= > >=`, logical `&& || !`,
parentheses and a fixed set of functions. They are evaluated by a small
purpose-built evaluator, never by `eval`, so a script cannot reach into the page.

| Function | Result |
|---|---|
| `has(list, x)` | Whether `list` (a persistent set such as `sys.endings`, or a string) contains `x`. |
| `rand(n)` / `rand(a, b)` / `rand()` | An integer in `[0, n)`, an integer in `[a, b]`, a float in `[0, 1)`. |
| `min(…)` / `max(…)` / `floor(x)` | Arithmetic. |
| `len(x)` | A string's or a list's length (0 otherwise). |

```
[set affection = affection + 1]
[set route 'yuki']
[if affection >= 3 && route == 'yuki' -> good_end]
[choice Go with her -> follow if=affection > 0]
[choice New game+ -> ng_plus if=has(sys.endings, "true")]
[set roll = rand(1, 6)]
```

### Persistent variables

A variable declared with `[persist]` (or the `[persist]` section of the config
file) outlives the session: it is not part of a save, survives a restart and a
return to the title, and comes back on the next visit. Declare it with its
first-run default; the stored value wins whenever there is one. `[set]` writes it,
expressions and `{$var}` read it, and plugins hear `onVarChange` as for any
variable.

```
[persist player = "" runs = 0 seen_intro = false]
[set runs = runs + 1]
[if seen_intro -> chapter_1]
```

The engine keeps two persistent lists itself, under the reserved `sys.` names:
`sys.endings` — every ending id reached (`[ending id]`, `[end]` = `default`) —
and `sys.chosen` — every choice ever taken, by its target label (its text when it
has none). Read them with `has()`.

### Asking the player

`[input var …]` opens an in-engine text box and writes the answer to `var`:

```
[input player prompt=@ui.askName default=Traveler maxlength=12 pattern=\S.* persist=true]
me: Nice to meet you, {$player}.
```

`prompt` is the message (an `@key` or literal); `default` is the fallback when
the player cancels or leaves the field empty — unless the variable already has a
value, which is offered back instead (a persisted name on the next run, the first
answer on a second ask). `maxlength` caps the length; `pattern` is a regular
expression the whole value must match before OK enables; `persist=true` declares
the variable persistent. The box's look and button labels come from the
`[input]` section of the config file (see [config.md](config.md#input)).

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
name), `voice` (the pitch of the typing blip, in Hz) and a **layered sprite**
(`canvas` + `[actors.<id>.layers]`, see [config.md](config.md#actorsidlayers)):
then `[char id face body=casual extra=blush]` sets any layer by name, and
`speaker(face):` still drives the `face` layer.

## Events

A click on a `[ui.<id>]` button, a `[hotspot]` or a `[sprite … onclick=]` runs
**script commands** — the value is one command per line, with or without
brackets (a TOML multi-line string for several), executed in the current
session. `[set]`, `[ui show]`, `[jump]`, `[call]`, a plugin command: anything
a script line can say. When the commands move the playhead (`[jump]`,
`[call]`), the line or prompt the story was parked on is released and play goes
on from there — a map screen is a background, a few hotspots and a parked line.

```
[bg @bg/map.png]
[hotspot shop x=10 y=20 w=25 h=30 onclick="jump shop"]
[hotspot home x=60 y=50 w=20 h=25 onclick="jump home" if=day > 1]
narr: Where to?
```

## Transitions

`[trans kind …]` freezes the picture; the scene changes that follow — `[bg]`,
`[char]`, `[hide]`, `[sprite]` … — happen underneath; the next dialogue line or
choices prompt (or an explicit `[trans end]`) reveals the result with the effect.
`[bg image trans=kind …]` does the same for a single background swap.

| Kind | Effect | Parameters |
|---|---|---|
| `fade` | Through a colour: the old picture fades to `color` (default black), the new one fades in. | `duration=0.6` `color=#000` |
| `crossfade` | The old picture dissolves into the new. | `duration` |
| `wipe` | A straight edge sweeps across. | `duration` `dir=right\|left\|up\|down` |
| `slide` | The old picture slides away, the new one is underneath. | `duration` `dir=left\|right\|up\|down` |
| `circle` | An iris closes on the old picture. | `duration` |
| `blinds` | Six vertical slats close. | `duration` |
| `rule` | A rule image (a luminance ramp) decides the order: dark pixels change first. | `duration` `mask=@fx/rule.png` `softness=0.1` |

`mask=` turns any kind into a rule transition. The old picture is a frozen copy
of the whole camera (backgrounds, characters, sprites), so anything the scene
becomes shows through. A load, restart or return to the title drops an armed
transition. `@nilvn/plugins`' `[transout]` / `[transin]` remain the
cover-with-a-colour pair (they take `mask=` too).

```
[trans slide dir=left duration=0.6]
[bg @bg/rooftop.png]
[hide rin fade=0]
[char mira at=right fade=0]
mira: …                                 ; the slide plays here
[bg @bg/street.png trans=wipe dir=right]
```

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

## Several files

A work can be several `.nvn` files. `[game] scripts = ["intro.nvn", "day1.nvn"]`
in the config file (or `engine.loadScripts([...])`) plays them in order as
**chunks** — the same mechanism a studio export streams through:

- labels are global: `[jump]`, `[call]` and choices reach a label in any file;
  a label defined in two files is reported and the first wins;
- a file's name (without extension) is itself a label naming its first line
  (`[jump day1]`);
- a file falls through into the next one in the list when it runs off its end;
- a save addresses the file's chunk, so a fresh load of the work resumes there.

`[include path]` pastes another file in where the line stands — before parsing,
when the file loads (`load`, `loadScript`, `[game] entry` / `scripts`). Paths
are relative to the including file (`@alias` paths resolve through the
aliases); includes nest up to eight deep, and a file that includes itself is
skipped with a diagnostic. Use it for shared headers — `[actor …]`
declarations, `[alias …]` — and for sub-routines reached by `[call]`. Text
handed to `loadSource()` cannot include: an `[include]` reached at run time
reports and does nothing.

`[call label]` jumps like `[jump]` but remembers the line after itself;
`[return]` comes back to it. Calls nest; the pending returns are part of a save.
A `[return]` with nothing to return to is reported and ignored.

```
[call flash_white]        ; runs the sub-routine below, then continues here
yuki: …

[label flash_white]
[flash color=#ffffff duration=0.3]
[return]
```

`[preload ref …]` warms assets ahead of a heavy scene (images are decoded,
everything else fetched into the cache) without stopping the story;
`wait=true` shows the loading page until they are in. The opening assets are
warmed by the config's `[preload]` section (see [config.md](config.md#preload)).

## Multi-language content

Ship one catalog per language and write the script with `@key` references. The
engine resolves text in `lang`, falling back to `defaultLang`, and `setLanguage`
(or the in-game menu) switches the language of the line currently on
screen without losing playback state. See [api.md](api.md#languages).
