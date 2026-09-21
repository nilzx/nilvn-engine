# Command reference

Every command is written `[name positional key=value …]`. Positional arguments
are listed first; named parameters follow with their defaults. Times are in
seconds. A parameter the script omits takes the value from the config file's
`[defaults]` table, then the default shown here.

## Built-in commands

Always available; they live in the engine itself.

### Script structure

| Command | Effect |
|---|---|
| `[label name]` | Jump target. |
| `[jump label]` | Continue at `label`. An unknown label stays put and reports a diagnostic. |
| `[call label]` / `[return]` | Jump remembering the line after the call; return to it (calls nest, the stack is saved). A stray `[return]` is reported and ignored. |
| `[choice text -> label if=cond disabled=cond]` | One option of a choices prompt. Consecutive choice lines form one prompt; `if=` hides the option when false, `disabled=` greys it out when true. `text` may be an `@key`. The prompt's look, layout and timer come from the `[choices]` config section. |
| `[if cond -> label]` | Jump when `cond` is truthy (see the expression grammar in [script-syntax.md](script-syntax.md#variables-and-conditions)). |
| `[set var = expr]` | Assign a variable; the `=` is optional. A persistent variable (`[persist]`) is written to the store. |
| `[input var prompt= default= maxlength= pattern= persist=true]` | Ask the player for a string in an in-engine box and assign it (see [script-syntax.md](script-syntax.md#asking-the-player)). |
| `[wait sec]` | Pause. Default 0.5; `duration=` is the named form. |
| `[end sec]` | Fade to black over `sec` (default 1) and finish the script into the `default` ending (`onEnd` fires, the session enters `ending`). |
| `[ending id sec=1]` | Like `[end]`, into the named ending: `engine.ending` = `id` and its page (`[ending.<id>]` in the config). `[end]` = `[ending default]`. |
| `[title]` | Stop the story and return to the title (`engine.showTitle()`): variables, stage and audio are cleared. |

### Declarations

| Command | Effect |
|---|---|
| `[use name…]` | Activate plugins: host-registered ids (or `app.nilvn.*` short names), `…/plugin.json` packages, `.js` modules. |
| `[alias @name path]` | Path prefix alias. |
| `[actor id name= color= sprites= face=]` | Declare or update an actor (see [script-syntax.md](script-syntax.md#actors)). |
| `[persist name = default …]` | Declare persistent variables with their first-run defaults (the stored value wins); a bare name defaults to `""`. Same as the `[persist]` config section. |
| `[include path]` | Paste another script file in here — resolved when the file loads, before parsing (see [script-syntax.md](script-syntax.md#several-files)). |
| `[preload ref …]` | `wait=false` | Warm assets ahead of a heavy scene; `wait=true` shows the loading page until they are in. |
| `[ui show\|hide\|toggle id]` | | Show, hide or toggle a `[ui.<id>]` panel (see [config.md](config.md#uiid)). |
| `[choices timer= default=]` | | The next prompt's countdown (seconds; `0` = none) and 1-based default, overriding the `[choices]` config for that prompt only. |
| `[hotspot id x= y= w= h= onclick= if=]` | | A clickable region of the stage (percent of the stage, in the world so it pans with the camera) whose click runs `onclick` (script commands, one per line). `if=` runs to the end of the tag (spaces allowed — put it last); false leaves the hotspot out. `[hotspot remove id]` / `[hotspot clear]`. Saved with the stage. A region whose centre the dialogue box, a panel or the HUD covers is reported as a diagnostic — see [script-syntax.md](script-syntax.md#events). |

### Stage

| Command | Parameters | Effect |
|---|---|---|
| `[bg image]` | `fade=0` `trans=` `dir=` `duration=` `mask=` | Cross-fade to a background image; `trans=kind` swaps through a scene transition instead (see [script-syntax.md](script-syntax.md#transitions)). |
| `[trans kind …]` / `[trans end]` | `duration=0.6` `dir=` `color=` `mask=` `softness=` | Freeze the picture; the scene changes that follow are revealed with `kind` (`fade` / `crossfade` / `wipe` / `slide` / `circle` / `blinds` / `rule`) at the next line, or at `[trans end]`. |
| `[bg color=#hex]` | `fade=0` | Solid-color background (`[bg #hex]` also works). |
| `[char id face]` | `at=` `fade=0.3` `src=` `y=` `scale=` `rotation=` `<layer>=` | Show a character or change its face / slot. `at` is `left` / `center` / `right` or a percentage of the stage width; `src` overrides the sprite template; `y` (percent of stage height above the floor), `scale` and `rotation` (degrees) seed the resting transform and carry forward when omitted. A layered actor takes its layers by name (`body=casual extra=blush`, `extra=none` clears an optional one). |
| `[hide id]` | `fade=0.3` | Hide one character. |
| `[clear]` | `fade=0.3` | Hide every character. |
| `[dialog show\|hide]` | | Show or hide the dialogue box (default `show`). |
| `[window skin=image]` | `target=dialog` | Reskin a UI window with an image (stretched) for the rest of the scene; `skin=none` goes back to what the work's theme / `[window]` config defines (a config skin comes back with it; to show a plain box for a scene, `[theme dialog-skin=none dialog-skin-slice=none]`). Today the only window is the dialogue box. |
| `[theme token=value …]` | any [theme token](api.md#theming) | Override theme tokens for the rest of the scene (saved with the stage, cleared by a restart): `[theme name-bg=#0b1c2e text-size=4cqh]`. `[theme reset]` clears them. |
| `[textspeed cps]` | | Typewriter speed; `0` reveals instantly. Default 40. |
| `[fadeout sec]` | `color=#000` | Cover the screen. Default 0.6 s; `duration=` is the named form. |
| `[fadein sec]` | | Reveal the screen. Default 0.6 s. |

### Audio

| Command | Parameters | Effect |
|---|---|---|
| `[bgm audio]` | `loop=true` `volume=1` `track=music` `fade=0` | Start (or replace) a looping track. `music` is the classic BGM slot; any other `track` name is an ambience bed layered under it. `fade` ramps the new track in. |
| `[stopbgm]` | `fade=0` `track=music` | Stop one track; `track=all` stops every loop. |
| `[se audio]` | `volume=1` | One-shot sound effect. |
| `[voice audio]` | `offset=0` | Queue a voice clip for the next dialogue line. Plays alongside the line, seeking past `offset` seconds of leading silence, and mutes the synthesized typing blip for that line. |

The player's master volumes (music / ambience / SFX / voice, `0..1`) multiply
every clip's authored volume; the in-game menu's settings expose them.

## Plugin commands

Everything beyond the built-ins is a plugin command, registered while the plugin
is active: `[use short-name]`, `[use app.nilvn.<short-name>]`, the config's
`[plugins] use`, or `createEngine({ use })` activates a plugin the host
registered; `[use ./x/plugin.json]` fetches one. An unknown command is a
diagnostic and a no-op, never a stop.

The first-party plugins (`textfx`, `screenfx`, `charfx`, `objectfx`,
`spriteanim`, `choicefx`, `voicefx`, `animstudio`, `abreplay`, `menu`) and every
command and parameter they add are documented with the plugins themselves:
[`@nilvn/plugins`](https://github.com/nilzx/nilvn-plugins#the-plugins).

## Object ids

| Id | Kind | Notes |
|---|---|---|
| `screen` | screen | The whole picture: flashes, transitions. `target=screen` in object commands means the camera. |
| `camera` | camera | Transformable: shake, zoom (`scale`), pan (`x` / `y`). |
| `character:<actor id>` | character | Transformable and bandable (`world` / `front`). |
| `sprite:<id>` | sprite | Contributed by `spriteanim`; transformable and bandable. |
| `window:dialog` | window | The dialogue box; reskinnable with `[window]`. |

The transform every transformable object honors: `x`, `y` (offsets, pixels or a
percentage of the object's own box), `scale`, `rotation` (degrees), `opacity`,
`visible`, `zIndex`. Plugins drive it through the stage capability
(see [api.md](api.md#plugins-and-capabilities)).
