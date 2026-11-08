# Grainfall

A falling-block puzzle for the Omarchy shell where every piece crumbles into
sand the moment it lands. Join one colour from the left wall to the right wall
and that whole region clears; the sand above tumbles down and can set off
chains. Inspired by the sand-tetris genre (Setris, Sandtris).

Runs as a native shell plugin in its own window, follows the active Omarchy
theme live (sand colours come from the theme's red/yellow/blue/green/magenta),
and has no dependencies beyond the shell.

## Install

```bash
omarchy plugin add https://github.com/larsgart/grainfall.git --enable
```

This downloads the plugin, validates it, and adds the sand-pile icon to the
bar. Update with `omarchy plugin update lars.grainfall`; remove with
`omarchy plugin remove lars.grainfall`.

## Play

Click the sand-pile icon in the bar, or bind a key to:

```bash
omarchy-shell shell summon lars.grainfall '{}'
```

| Key | Action |
| --- | --- |
| ← → / A D | Move (hold Shift for faster) |
| ↑ / X / W | Rotate clockwise |
| Z / Q | Rotate counter-clockwise |
| ↓ / S | Soft drop |
| Space | Hard drop |
| Esc / P | Pause menu (↑ ↓ and Enter, or click) |
| R / M / C | In the pause menu: Restart, Main menu, Close window |

On the title screen, ↑ ↓ pick Easy (3 colours), Normal (4) or Hard (5); Enter starts.

## Chaos modifiers

Toggle each one on the title screen (F, E, M, or click). All three start on.

- **Flips (F)** — every 30–55 seconds (sooner at higher levels) the board
  turns upside down after a 3-second warning. The pile pours back down, vines
  are torn loose into sand, and the falling piece waits until the pour
  settles. Clears made while it pours score double.
- **Elements (E)** — about one piece in five is special:
  - *Dye water* flows like a liquid and recolours any sand it touches, then
    soaks in. Sand sinks through it.
  - *Fire* smoulders briefly, burns sand, races along vines, and is put out
    by water.
  - *Acid* eats straight down through the pile, a few grains per drop.
  - *Seeds* land as sand with two sprouts that burrow to the surface and grow
    vines of their colour toward both walls. Vines stay put and count toward
    clears, so a good seed can bridge the board on its own.
- **Groove (M)** — sand physics follow the music playing on your default
  output. Quiet passages make sand sticky so it stacks in steep towers; loud
  ones let it flow; very loud ones make it runny; beats shake the board and
  knock loose grains sideways. This reads only the output's peak level
  through PipeWire (the same meter Omarchy's audio panel uses), only while a
  Groove game is on screen. Nothing is recorded or stored.

## Rules

- Each block is 8×8 grains on a 10×20 block board (80×160 grains).
- Grains fall straight down, or slide diagonally when blocked.
- A same-coloured region of sand and vines (8-connected) touching both side walls clears.
- Points = grains cleared × chain × level. Chains count clears caused by one
  landing. The level rises every 4 clears and speeds up gravity.
- The game ends when a new piece has no room to spawn.

Best scores are kept per difficulty in `~/.local/state/grainfall.ini`.

## How it works

| File | Role |
| --- | --- |
| `Engine.js` | All game logic, QML-free so node can test it |
| `Grainfall.qml` | Window, input, theme colours, groove meter, rendering |
| `BarWidget.qml` | The bar icon |
| `i18n/en.json` | Strings (other languages can be added beside it) |

The board is one `Uint8Array` of 80×160 cells, each byte packing colour,
shade and material. Every frame the engine runs a fixed number of
cellular-automaton passes (bottom-up, one rule per material), then looks for
clears with a flood fill seeded only from the left wall: any region that
reaches the right wall spans the board. The board is rendered one pixel per
grain and scaled up with `drawImage` (Qt Quick's Canvas ignores
`putImageData`).

## Development

```bash
./scripts/check.sh            # engine tests + manifest validation
./scripts/run-dev.sh          # run in a throwaway Quickshell window
GRAINFALL_DEV_AUTOSTART=1 GRAINFALL_DEV_CHAOS=1 ./scripts/run-dev.sh   # every piece an element, early flip
```

Dev runs keep their scores in a temporary file, never in your real one.
