// Run with: node tests/engine.test.js
const fs = require("fs")
const path = require("path")
const assert = require("assert")

function loadEngine() {
  const source = fs.readFileSync(path.join(__dirname, "..", "Engine.js"), "utf8").replace(/^\.pragma library\s*/m, "")
  const exportsList = ["GRAIN", "WIDTH", "HEIGHT", "newGame", "update", "shift", "rotate", "hardDrop", "fits",
    "findSpans", "sandStep", "render", "buildPalette", "packCell", "takeEvents", "dropDistance",
    "flip", "setGroove", "shake", "flipCountdown", "cellMaterial", "cellColor", "renderPreview",
    "makePiece", "SAND", "WATER", "FIRE", "ACID", "SPROUT", "VINE"]
  return new Function(source + "\nreturn {" + exportsList.join(",") + "}")()
}

const E = loadEngine()
let passed = 0
function test(name, fn) { fn(); passed++; console.log("ok -", name) }

const at = (x, y) => y * E.WIDTH + x
function settle(s, steps) { for (let i = 0; i < steps; i++) E.sandStep(s) }
function count(s, pred = () => true) { let n = 0; for (const c of s.cells) if (c && pred(c)) n++; return n }
function emptyGame(opts) { const s = E.newGame(Object.assign({ seed: 11 }, opts)); s.piece = null; return s }

// Deterministic stand-in for player input, so the long runs are reproducible.
function inputRandom(seed) {
  let x = seed
  return () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296
}

test("new game spawns a fitting piece", () => {
  const s = E.newGame({ seed: 1 })
  assert.strictEqual(s.status, "playing")
  assert.ok(E.fits(s, s.piece.blocks, s.piece.x, s.piece.y))
})

test("hard drop turns the piece into sand at the floor", () => {
  const s = E.newGame({ seed: 2 })
  E.hardDrop(s)
  assert.strictEqual(count(s), 4 * E.GRAIN * E.GRAIN)
  const floor = E.HEIGHT - 1
  assert.ok(s.cells[at(E.WIDTH / 2 - 1, floor)] || s.cells[at(E.WIDTH / 2, floor)])
})

test("sand settles until nothing moves", () => {
  const s = E.newGame({ seed: 3 })
  s.cells[0] = E.packCell(0, 0)
  let steps = 0
  while (E.sandStep(s)) steps++
  assert.ok(s.cells[at(0, E.HEIGHT - 1)])
  assert.strictEqual(steps, E.HEIGHT - 1)
})

test("a wall-to-wall run of one colour clears; mixed colours do not", () => {
  const s = E.newGame({ seed: 4 })
  const y = E.HEIGHT - 1
  for (let x = 0; x < E.WIDTH; x++) s.cells[at(x, y)] = E.packCell(x === 40 ? 1 : 0, 0)
  assert.strictEqual(E.findSpans(s).length, 0)
  s.cells[at(40, y - 1)] = E.packCell(0, 0)   // diagonal bridge over the gap
  assert.strictEqual(E.findSpans(s).length, 1)
  s.sandActive = true
  E.update(s, 16, {})
  assert.ok(s.flashing && s.flashing.length === E.WIDTH)
  assert.ok(s.score > 0)
  for (let t = 0; t < 40; t++) E.update(s, 16, {})
  assert.strictEqual(s.flashing, null)
})

test("pieces cannot leave the board", () => {
  const s = E.newGame({ seed: 5 })
  for (let i = 0; i < 200; i++) E.shift(s, -1)
  assert.ok(E.fits(s, s.piece.blocks, s.piece.x, s.piece.y))
  assert.strictEqual(E.shift(s, -1), false)
})

test("random play runs without throwing", () => {
  const s = E.newGame({ seed: 6 })
  const rand = inputRandom(12345)
  let frames = 0
  while (s.status === "playing" && frames < 100000) {
    const r = rand()
    if (r < 0.02) E.rotate(s, 1)
    if (r > 0.98) E.hardDrop(s)
    E.update(s, 16, { horizontal: r < 0.3 ? -1 : r > 0.7 ? 1 : 0, softDrop: r < 0.1 })
    frames++
  }
  assert.ok(s.score > 0)
  console.log("   frames:", frames, "score:", s.score, "clears:", s.clears, "level:", s.level, s.status)
})

test("performance: full board step + spans + render under budget", () => {
  const s = E.newGame({ seed: 7 })
  for (let i = 0; i < s.cells.length / 2; i++) s.cells[s.cells.length - 1 - i] = E.packCell(Math.floor(Math.random() * 4), 0)
  const palette = E.buildPalette([[200, 0, 0], [0, 200, 0], [0, 0, 200], [200, 200, 0]])
  for (let i = 0; i < 2000; i++) s.cells[s.cells.length - 1 - i * 3] = E.packCell(i % 4, 3, [E.WATER, E.FIRE, E.ACID, E.VINE, E.SPROUT][i % 5])
  const pixels = new Uint8ClampedArray(E.WIDTH * E.HEIGHT * 4)
  const theme = { background: [0, 0, 0], grid: [10, 10, 10], flash: [255, 255, 255], ghost: 0.2 }
  const t0 = Date.now()
  for (let i = 0; i < 200; i++) { E.sandStep(s); E.findSpans(s); E.render(s, pixels, palette, theme) }
  const per = (Date.now() - t0) / 200
  console.log("   ms per frame (node):", per.toFixed(3))
  assert.ok(per < 8)
})



test("dye water recolours the sand it touches and soaks in", () => {
  const s = emptyGame()
  for (let x = 0; x < E.WIDTH; x++) s.cells[at(x, E.HEIGHT - 1)] = E.packCell(0, 1)
  for (let x = 30; x < 50; x++) s.cells[at(x, E.HEIGHT - 2)] = E.packCell(2, 1, E.WATER)
  settle(s, 400)
  assert.ok(count(s, c => E.cellMaterial(c) === E.SAND && E.cellColor(c) === 3) >= 15, "sand was dyed")
  assert.ok(s.dyed >= 15)
})

test("dye water never turns empty space into sand", () => {
  const s = emptyGame()
  for (let x = 20; x < 60; x++) s.cells[at(x, E.HEIGHT - 1)] = E.packCell(2, 1, E.WATER)
  settle(s, 600)
  assert.strictEqual(count(s, c => E.cellMaterial(c) === E.SAND), 0)
})

test("fire burns sand and water puts it out", () => {
  const s = emptyGame()
  for (let y = E.HEIGHT - 10; y < E.HEIGHT; y++) for (let x = 0; x < E.WIDTH; x++) s.cells[at(x, y)] = E.packCell(1, 0)
  const before = count(s, () => true)
  for (let x = 20; x < 28; x++) s.cells[at(x, E.HEIGHT - 11)] = E.packCell(-1, 3, E.FIRE)
  settle(s, 600)
  assert.ok(s.burned > 0, "something burned")
  assert.ok(count(s, c => E.cellMaterial(c) === E.FIRE) === 0, "fire burns out")
  assert.ok(count(s, () => true) < before)
  const t = emptyGame()
  t.cells[at(10, E.HEIGHT - 1)] = E.packCell(-1, 3, E.FIRE)
  t.cells[at(11, E.HEIGHT - 1)] = E.packCell(0, 0, E.WATER)
  t.cells[at(9, E.HEIGHT - 1)] = E.packCell(0, 0, E.WATER)
  settle(t, 200)
  assert.strictEqual(count(t, c => E.cellMaterial(c) === E.FIRE), 0)
})

test("acid drills down through the pile", () => {
  const s = emptyGame()
  for (let y = E.HEIGHT - 20; y < E.HEIGHT; y++) for (let x = 0; x < E.WIDTH; x++) s.cells[at(x, y)] = E.packCell(1, 0)
  for (let x = 36; x < 44; x++) for (let y = E.HEIGHT - 28; y < E.HEIGHT - 20; y++) s.cells[at(x, y)] = E.packCell(-1, 3, E.ACID)
  settle(s, 400)
  assert.ok(s.dissolved > 100, "dissolved " + s.dissolved)
})

test("a seed grows vines that bridge the board and clear", () => {
  const s = emptyGame({ seed: 3 })
  s.cells[at(40, E.HEIGHT - 1)] = E.packCell(1, 0, E.SPROUT)
  s.cells[at(41, E.HEIGHT - 1)] = E.packCell(1, 1, E.SPROUT)
  let spans = []
  for (let i = 0; i < 3000 && spans.length === 0; i++) { E.sandStep(s); spans = E.findSpans(s) }
  assert.ok(count(s, c => E.cellMaterial(c) === E.VINE) > 20, "vines grew")
  // Vine stopping early is random; with seed 3 both reach the walls.
  assert.strictEqual(spans.length, 1, "vines join the walls")
})

test("seed pieces land with two sprouts", () => {
  const s = E.newGame({ seed: 4 })
  s.piece.material = "seed"
  E.hardDrop(s)
  assert.strictEqual(count(s, c => E.cellMaterial(c) === E.SPROUT), 2)
})

test("flip mirrors the board, holds the piece, then respawns it", () => {
  const s = E.newGame({ seed: 5, flips: true })
  s.cells[at(5, E.HEIGHT - 1)] = E.packCell(0, 0)
  const held = s.piece
  s.flipIn = 2500
  E.update(s, 16, {})
  assert.strictEqual(E.flipCountdown(s), 3)
  s.flipIn = 1
  E.update(s, 16, {})
  assert.ok(s.cells[at(5, 0)] !== 0, "bottom grain is now at the top")
  assert.strictEqual(s.piece, null)
  assert.ok(s.pouring)
  for (let i = 0; i < 300 && s.pouring; i++) E.update(s, 16, {})
  assert.strictEqual(s.pouring, false)
  assert.strictEqual(s.piece, held)
  assert.ok(s.flipIn > 10000, "next flip scheduled")
})

test("a flip tears vines loose so they pour as sand", () => {
  const s = E.newGame({ seed: 6, flips: true })
  for (let x = 10; x < 70; x++) s.cells[at(x, E.HEIGHT - 1)] = E.packCell(2, 1, E.VINE)
  s.cells[at(5, E.HEIGHT - 1)] = E.packCell(2, 1, E.SPROUT)
  E.flip(s)
  assert.strictEqual(count(s, c => E.cellMaterial(c) === E.VINE || E.cellMaterial(c) === E.SPROUT), 0)
  for (let i = 0; i < 400 && s.pouring; i++) E.update(s, 16, {})
  let top = 0
  for (let i = 0; i < E.WIDTH * 40; i++) if (s.cells[i]) top++
  assert.strictEqual(top, 0, "nothing left hanging from the ceiling")
  assert.strictEqual(s.status, "playing")
})

test("clears during a pour score double", () => {
  const s = emptyGame({ flips: true })
  for (let x = 0; x < E.WIDTH; x++) s.cells[at(x, E.HEIGHT - 1)] = E.packCell(0, 0)
  s.pouring = true
  s.sandActive = true
  E.update(s, 16, {})
  assert.strictEqual(s.score, E.WIDTH * 2)
})

test("groove: silence makes sand sticky, beats knock it loose", () => {
  const s = emptyGame()
  E.setGroove(s, true, 0.05)
  assert.ok(s.groove.slide < 0.01)
  E.setGroove(s, true, 0.95)
  assert.strictEqual(Math.round(s.groove.slide * 100), 100)
  assert.ok(s.groove.liquid > 0)
  E.setGroove(s, false, 0.95)
  assert.strictEqual(s.groove.slide, 1)
  for (let x = 30; x < 50; x++) s.cells[at(x, E.HEIGHT - 1)] = E.packCell(0, 0)
  E.shake(s, 1)
  assert.ok(E.sandStep(s), "shaken grains move")
})

test("elements are dealt when enabled and never when disabled", () => {
  const on = E.newGame({ seed: 8, elements: true })
  const off = E.newGame({ seed: 8 })
  const seen = {}
  let offSpecial = 0
  for (let i = 0; i < 400; i++) {
    const m = E.makePiece(on).material
    seen[m] = (seen[m] || 0) + 1
    if (E.makePiece(off).material !== "sand") offSpecial++
  }
  assert.deepStrictEqual(Object.keys(seen).sort(), ["acid", "fire", "sand", "seed", "water"])
  assert.ok(seen.sand > 260 && seen.sand < 360, "about 80% sand: " + seen.sand)
  assert.strictEqual(offSpecial, 0)
})

test("chaotic random play with every modifier ends without throwing", () => {
  const s = E.newGame({ seed: 9, flips: true, elements: true })
  let frames = 0, flips = 0
  const rand = inputRandom(777)
  while (s.status === "playing" && frames < 200000) {
    const r = rand()
    if (r < 0.02) E.rotate(s, 1)
    if (r > 0.985) E.hardDrop(s)
    if (frames % 30 === 0) E.setGroove(s, true, Math.abs(Math.sin(frames / 400)))
    if (frames % 45 === 0) E.shake(s, 0.8)
    E.update(s, 16, { horizontal: r < 0.3 ? -1 : r > 0.7 ? 1 : 0, softDrop: r < 0.1 })
    for (const e of E.takeEvents(s)) if (e.type === "flip") flips++
    frames++
  }
  assert.strictEqual(s.status, "over")
  console.log("   frames:", frames, "score:", s.score, "clears:", s.clears, "flips:", flips, "burned:", s.burned, "dyed:", s.dyed, "dissolved:", s.dissolved)
})

console.log(passed + " tests passed")
