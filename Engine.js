.pragma library

// Grainfall engine: falling tetrominoes that crumble into sand on landing.
// A run of one colour that connects the left wall to the right wall clears.
//
// Chaos modifiers, each optional:
//   flips    - every so often the board turns upside down and the pile pours
//   elements - some pieces are water (dye), fire, acid or seeds (vines)
//   groove   - sand physics follow the loudness of the music that is playing
//
// Pure JavaScript with no QML dependencies so it can be unit tested in node.

// ---------------------------------------------------------------- tuning

var GRAIN = 8
var COLUMNS = 10
var ROWS = 20
var WIDTH = COLUMNS * GRAIN
var HEIGHT = ROWS * GRAIN
var SHADES = 4

var MAX_FRAME_MS = 50
var LOCK_MS = 260
var MAX_LOCK_RESETS = 10
var FLASH_MS = 420
var CLEARS_PER_LEVEL = 4
var HARD_DROP_POINTS_PER_ROW = 2
var MOVE_SPEED = 96          // grains per second while a direction is held
var FAST_MOVE_SPEED = 260    // with Shift held
var SOFT_DROP_SPEED = 220
var BASE_GRAVITY = 12        // grains per second at level 1
var GRAVITY_PER_LEVEL = 5
var MAX_GRAVITY = 90
var SAND_STEPS_PER_SECOND = 150
var SINK_THROUGH_WATER = 0.5

var FLIP_WARNING_MS = 3000
var FLIP_MIN_MS = 30000
var FLIP_MAX_MS = 55000
var FIRST_FLIP_GRACE_MS = 8000
var FLIP_SOONER_PER_LEVEL_MS = 2500
var FLIP_FLOOR_MS = 16000
var POUR_SETTLE_MS = 700
var POUR_MAX_MS = 3500
var POUR_GIVE_UP_MS = 8000   // spawn even if the pour is still in the way
var POUR_BONUS = 2

var CALM_OPENING_PIECES = 3
var ELEMENT_CHANCE = 0.2
var WATER_EVAPORATE = 0.0012
var WATER_DYE = 0.35
var FIRE_DECAY = 0.018
var FIRE_BURN = 0.04
var FIRE_SPREAD_VINE = 0.6
var ACID_EAT = 0.3
var ACID_EVAPORATE = 0.002
var ACID_FLOOR_EVAPORATE = 0.02
var SPROUT_GROW = 0.35
var SPROUT_STOP = 0.015

// Peak levels arrive on a cube-root scale, so quiet music still reads ~0.3.
var GROOVE_QUIET = 0.3
var GROOVE_FLOWING = 0.75
var GROOVE_RUNNY = 0.85
var GROOVE_STICKY_SLIDE = 0.002
var GROOVE_MAX_DRIFT = 0.3
var BEAT_DRIFT = 0.45

// ------------------------------------------------------------------ cells

// Materials, stored in the top three bits of a cell.
var SAND = 0
var WATER = 1
var FIRE = 2
var ACID = 3
var SPROUT = 4
var VINE = 5

var NO_COLOR = -1
var FULL_LIFE = 3
var GROWS_LEFT = 0
var GROWS_RIGHT = 1

// A cell packs colour (bits 0-2, 1-based, 0 = colourless), shade (bits 3-4)
// and material (bits 5-7). Zero means empty. Fire and acid keep their
// remaining life in the shade bits; sprouts keep their direction there.
function cellColor(cell) { return cell & 7 }
function cellShade(cell) { return (cell >> 3) & 3 }
function cellMaterial(cell) { return cell >> 5 }
function packCell(color, shade, material) {
  return ((color + 1) & 7) | ((shade & 3) << 3) | ((material || 0) << 5)
}
function withShade(cell, shade) { return (cell & ~24) | ((shade & 3) << 3) }
function withColorOf(cell, source) { return (cell & ~7) | cellColor(source) }
function asSand(cell) { return cell & 31 }

function isMaterial(cell, material) { return cell !== 0 && cellMaterial(cell) === material }

// The colour a cell lends to a wall-to-wall path: only sand and vines join.
function pathColor(cell) {
  var material = cellMaterial(cell)
  return (material === SAND || material === VINE) ? cellColor(cell) : 0
}

// ----------------------------------------------------------------- pieces

// Piece materials. "seed" lands as sand plus two sprouts.
var ELEMENTS = ["water", "fire", "acid", "seed"]

var KINDS = ["I", "O", "T", "S", "Z", "J", "L"]
var SHAPES = {
  I: { box: 4, blocks: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { box: 2, blocks: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { box: 3, blocks: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { box: 3, blocks: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { box: 3, blocks: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { box: 3, blocks: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { box: 3, blocks: [[2, 0], [0, 1], [1, 1], [2, 1]] }
}

// Rotation kicks in grains: try nudging sideways first, then upward.
var KICKS = (function() {
  var kicks = []
  var lifts = [0, -2, -4, 2]
  var nudges = [0, -2, 2, -4, 4, -6, 6, -8, 8]
  for (var j = 0; j < lifts.length; j++)
    for (var i = 0; i < nudges.length; i++) kicks.push([nudges[i], lifts[j]])
  return kicks
})()

var NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

function rotateBlocks(blocks, box, turns) {
  var rotated = blocks.map(function(b) { return [b[0], b[1]] })
  for (var t = 0; t < turns; t++)
    rotated = rotated.map(function(b) { return [box - 1 - b[1], b[0]] })
  return rotated
}

function pieceBounds(blocks) {
  var minX = 9, maxX = -1, minY = 9, maxY = -1
  for (var i = 0; i < blocks.length; i++) {
    minX = Math.min(minX, blocks[i][0]); maxX = Math.max(maxX, blocks[i][0])
    minY = Math.min(minY, blocks[i][1]); maxY = Math.max(maxY, blocks[i][1])
  }
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY }
}

// Call visit(x, y, shade) for every grain of a piece placed at (originX, originY).
function forEachGrain(piece, originX, originY, visit) {
  for (var b = 0; b < piece.blocks.length; b++) {
    var blockX = originX + piece.blocks[b][0] * GRAIN
    var blockY = originY + piece.blocks[b][1] * GRAIN
    for (var gy = 0; gy < GRAIN; gy++)
      for (var gx = 0; gx < GRAIN; gx++)
        visit(blockX + gx, blockY + gy, piece.shades[(b * GRAIN + gy) * GRAIN + gx])
  }
}

function makeRandom(seed) {
  if (seed === undefined || seed === null) return Math.random
  var s = seed >>> 0
  return function() {   // mulberry32
    s = (s + 0x6D2B79F5) >>> 0
    var t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomIndex(random, length) { return Math.floor(random() * length) }
function randomSide(random) { return random() < 0.5 ? -1 : 1 }

// -------------------------------------------------------------- new game

function newGame(options) {
  options = options || {}
  var state = {
    cells: new Uint8Array(WIDTH * HEIGHT),
    visited: new Uint8Array(WIDTH * HEIGHT),
    movedThisStep: new Uint8Array(WIDTH * HEIGHT),
    flashing: null,
    flashMs: 0,
    colors: Math.max(2, Math.min(6, options.colors || 4)),
    flips: options.flips === true,
    elements: options.elements === true,
    random: makeRandom(options.seed),
    bag: [],
    piecesDealt: 0,
    piece: null,
    next: null,
    heldPiece: null,
    status: "playing",
    paused: false,
    score: 0,
    clears: 0,
    level: 1,
    chain: 0,
    bestChain: 0,
    dyed: 0,
    burned: 0,
    dissolved: 0,
    fallCarry: 0,
    moveCarry: 0,
    sandCarry: 0,
    lockMs: 0,
    lockResets: 0,
    sandActive: false,
    pouring: false,
    pourMs: 0,
    flipIn: 0,
    groove: { active: false, slide: 1, liquid: 0 },
    shake: 0,
    frame: 0,
    events: []
  }
  if (state.flips) scheduleFlip(state, true)
  state.next = makePiece(state)
  spawn(state)
  return state
}

// Seven-piece bag: every kind once, in random order, before any repeats.
function drawKind(state) {
  if (state.bag.length === 0) {
    state.bag = KINDS.slice()
    for (var i = state.bag.length - 1; i > 0; i--) {
      var j = randomIndex(state.random, i + 1)
      var swap = state.bag[i]; state.bag[i] = state.bag[j]; state.bag[j] = swap
    }
  }
  return state.bag.pop()
}

function drawMaterial(state) {
  var calmOpening = state.piecesDealt < CALM_OPENING_PIECES
  if (!state.elements || calmOpening || state.random() >= ELEMENT_CHANCE) return "sand"
  return ELEMENTS[randomIndex(state.random, ELEMENTS.length)]
}

function makePiece(state) {
  var kind = drawKind(state)
  var shape = SHAPES[kind]
  var shades = new Uint8Array(4 * GRAIN * GRAIN)
  for (var i = 0; i < shades.length; i++) shades[i] = randomIndex(state.random, SHADES)
  var material = drawMaterial(state)
  state.piecesDealt++
  return {
    kind: kind,
    material: material,
    color: randomIndex(state.random, state.colors),
    rotation: 0,
    box: shape.box,
    blocks: rotateBlocks(shape.blocks, shape.box, 0),
    shades: shades,
    x: 0,
    y: 0
  }
}

// Top centre of the board, with the piece's top row on row 0.
function spawnPosition(piece) {
  var bounds = pieceBounds(piece.blocks)
  var widthInBlocks = bounds.maxX - bounds.minX + 1
  return {
    x: Math.floor((WIDTH - widthInBlocks * GRAIN) / 2) - bounds.minX * GRAIN,
    y: -bounds.minY * GRAIN
  }
}

function spawnFits(state, piece) {
  var position = spawnPosition(piece)
  return fits(state, piece.blocks, position.x, position.y)
}

// Put a piece at the top centre. Without an explicit piece, deal the next one.
function spawn(state, piece) {
  if (!piece) {
    piece = state.next
    state.next = makePiece(state)
  }
  var position = spawnPosition(piece)
  piece.x = position.x
  piece.y = position.y
  state.piece = piece
  state.fallCarry = 0
  state.lockMs = 0
  state.lockResets = 0
  if (!fits(state, piece.blocks, piece.x, piece.y)) endGame(state)
}

function endGame(state) {
  state.status = "over"
  state.events.push({ type: "gameOver" })
}

// Hot path: checked on every move and fall, so it loops directly instead of
// going through forEachGrain.
function fits(state, blocks, px, py) {
  var cells = state.cells
  for (var b = 0; b < blocks.length; b++) {
    var blockX = px + blocks[b][0] * GRAIN
    var blockY = py + blocks[b][1] * GRAIN
    if (blockX < 0 || blockX + GRAIN > WIDTH || blockY + GRAIN > HEIGHT) return false
    for (var gy = 0; gy < GRAIN; gy++) {
      var y = blockY + gy
      if (y < 0) continue
      var row = y * WIDTH
      for (var gx = 0; gx < GRAIN; gx++)
        if (cells[row + blockX + gx] !== 0) return false
    }
  }
  return true
}

// ---------------------------------------------------------------- controls

function canAct(state) {
  return state.status === "playing" && !state.paused && state.piece !== null && state.flashing === null
}

// Moving a grounded piece buys it more time before it locks, a few times over.
function extendLockDelay(state) {
  if (state.lockMs > 0 && state.lockResets < MAX_LOCK_RESETS) {
    state.lockMs = 0
    state.lockResets++
  }
}

function shift(state, dx) {
  if (!canAct(state)) return false
  var piece = state.piece
  if (!fits(state, piece.blocks, piece.x + dx, piece.y)) return false
  piece.x += dx
  extendLockDelay(state)
  return true
}

function rotate(state, direction) {
  if (!canAct(state)) return false
  var piece = state.piece
  if (piece.kind === "O") return false
  var rotation = (piece.rotation + (direction < 0 ? 3 : 1)) % 4
  var blocks = rotateBlocks(SHAPES[piece.kind].blocks, piece.box, rotation)
  for (var k = 0; k < KICKS.length; k++) {
    var x = piece.x + KICKS[k][0]
    var y = piece.y + KICKS[k][1]
    if (!fits(state, blocks, x, y)) continue
    piece.blocks = blocks
    piece.rotation = rotation
    piece.x = x
    piece.y = y
    extendLockDelay(state)
    return true
  }
  return false
}

// How far the piece can fall. Tetromino columns are contiguous, so only the
// lowest grain of each column needs checking against the stack below it.
function dropDistance(state) {
  var piece = state.piece
  if (!piece) return 0
  var lowestByColumn = {}
  for (var b = 0; b < piece.blocks.length; b++) {
    var blockX = piece.x + piece.blocks[b][0] * GRAIN
    var blockBottom = piece.y + piece.blocks[b][1] * GRAIN + GRAIN - 1
    for (var gx = 0; gx < GRAIN; gx++) {
      var x = blockX + gx
      if (lowestByColumn[x] === undefined || lowestByColumn[x] < blockBottom) lowestByColumn[x] = blockBottom
    }
  }
  var shortest = HEIGHT
  for (var key in lowestByColumn)
    shortest = Math.min(shortest, freeRowsBelow(state, Number(key), lowestByColumn[key]))
  return shortest
}

function freeRowsBelow(state, x, y) {
  var free = 0
  for (var row = y + 1; row < HEIGHT && (row < 0 || state.cells[row * WIDTH + x] === 0); row++) free++
  return free
}

function hardDrop(state) {
  if (!canAct(state)) return false
  var distance = dropDistance(state)
  state.piece.y += distance
  state.score += Math.floor(distance / GRAIN) * HARD_DROP_POINTS_PER_ROW
  land(state)
  return true
}

// ----------------------------------------------------------------- landing

function landedCell(piece, shade) {
  switch (piece.material) {
  case "water": return packCell(piece.color, shade, WATER)
  case "fire": return packCell(NO_COLOR, FULL_LIFE, FIRE)
  case "acid": return packCell(NO_COLOR, FULL_LIFE, ACID)
  default: return packCell(piece.color, shade, SAND)
  }
}

function land(state) {
  var piece = state.piece
  var cells = state.cells
  var overflow = false
  var leftEdge = null, rightEdge = null   // lowest grain in the outermost columns
  forEachGrain(piece, piece.x, piece.y, function(x, y, shade) {
    if (y < 0) { overflow = true; return }
    cells[y * WIDTH + x] = landedCell(piece, shade)
    if (!leftEdge || x < leftEdge.x || (x === leftEdge.x && y > leftEdge.y)) leftEdge = { x: x, y: y }
    if (!rightEdge || x > rightEdge.x || (x === rightEdge.x && y > rightEdge.y)) rightEdge = { x: x, y: y }
  })
  if (piece.material === "seed") {
    if (leftEdge) cells[leftEdge.y * WIDTH + leftEdge.x] = packCell(piece.color, GROWS_LEFT, SPROUT)
    if (rightEdge) cells[rightEdge.y * WIDTH + rightEdge.x] = packCell(piece.color, GROWS_RIGHT, SPROUT)
  }
  state.piece = null
  state.chain = 0
  state.sandActive = true
  if (overflow) endGame(state)
  else if (!state.pouring) spawn(state)
}

// -------------------------------------------------------------- simulation

function moveCell(state, from, to) {
  state.cells[to] = state.cells[from]
  state.cells[from] = 0
  state.movedThisStep[to] = 1
}

function swapCells(state, a, b) {
  var cells = state.cells
  var swap = cells[a]; cells[a] = cells[b]; cells[b] = swap
  state.movedThisStep[b] = 1
}

function randomNeighbour(state, x, y) {
  var offset = NEIGHBOURS[randomIndex(state.random, 8)]
  var nx = x + offset[0], ny = y + offset[1]
  if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) return -1
  return ny * WIDTH + nx
}

// Move one column left or right (random side first) into the row at
// index + rowOffset, if both that cell and the one beside us are empty.
function slideEitherWay(state, index, x, rowOffset) {
  var cells = state.cells
  var side = randomSide(state.random)
  for (var attempt = 0; attempt < 2; attempt++, side = -side) {
    var nx = x + side
    if (nx >= 0 && nx < WIDTH && cells[index + rowOffset + side] === 0 && cells[index + side] === 0) {
      moveCell(state, index, index + rowOffset + side)
      return true
    }
  }
  return false
}

// Fall straight, else slide diagonally (with probability `slide`), else
// drift sideways (with probability `drift`). Heavy grains sink through water.
function stepGranular(state, index, x, y, slide, drift) {
  var cells = state.cells
  var random = state.random
  if (y < HEIGHT - 1) {
    var below = index + WIDTH
    if (cells[below] === 0) { moveCell(state, index, below); return true }
    if (isMaterial(cells[below], WATER) && random() < SINK_THROUGH_WATER) { swapCells(state, index, below); return true }
    if ((slide >= 1 || random() < slide) && slideEitherWay(state, index, x, WIDTH)) return true
  }
  if (drift > 0 && random() < drift) {
    var side = randomSide(random)
    var nx = x + side
    if (nx >= 0 && nx < WIDTH && cells[index + side] === 0) {
      moveCell(state, index, index + side)
      return true
    }
  }
  return false
}

// Dye water: recolours the sand it touches, then soaks in. Flows like a liquid.
function stepWater(state, index, x, y) {
  var cells = state.cells
  var random = state.random
  if (random() < WATER_EVAPORATE) { cells[index] = 0; return true }
  var n = randomNeighbour(state, x, y)
  if (n >= 0 && canDye(cells[n], cells[index]) && random() < WATER_DYE) {
    cells[n] = withColorOf(cells[n], cells[index])
    cells[index] = 0
    state.dyed++
    return true
  }
  return stepGranular(state, index, x, y, 1, 0) || slideEitherWay(state, index, x, 0)
}

function canDye(target, water) {
  return pathColor(target) !== 0 && cellColor(target) !== cellColor(water)
}

// Fire and acid burn down their life; at zero they are gone.
function spendLife(cells, index) {
  var life = cellShade(cells[index])
  if (life === 0) { cells[index] = 0; return false }
  cells[index] = withShade(cells[index], life - 1)
  return true
}

// Fire: smoulders for a short life, burns sand, races along vines, and is
// put out by water.
function stepFire(state, index, x, y) {
  var cells = state.cells
  var random = state.random
  if (random() < FIRE_DECAY && !spendLife(cells, index)) return true
  var n = randomNeighbour(state, x, y)
  if (n >= 0) {
    var target = cells[n]
    if (isMaterial(target, WATER)) {
      cells[n] = 0
      cells[index] = 0
      return true
    }
    if ((isMaterial(target, VINE) || isMaterial(target, SPROUT)) && random() < FIRE_SPREAD_VINE) {
      cells[n] = packCell(NO_COLOR, FULL_LIFE, FIRE)
      state.movedThisStep[n] = 1
      state.burned++
      return true
    }
    if (isMaterial(target, SAND) && random() < FIRE_BURN) {
      cells[n] = 0
      state.burned++
      return true
    }
  }
  return stepGranular(state, index, x, y, 1, 0)
}

// Acid: eats whatever is below it, a few grains per drop, then is spent.
function stepAcid(state, index, x, y) {
  var cells = state.cells
  var random = state.random
  var onFloor = y === HEIGHT - 1
  if (random() < (onFloor ? ACID_FLOOR_EVAPORATE : ACID_EVAPORATE)) { cells[index] = 0; return true }
  if (!onFloor) {
    var below = index + WIDTH
    var target = cells[below]
    if (isMaterial(target, WATER)) {
      cells[below] = 0
      cells[index] = 0
      return true
    }
    if (target !== 0 && cellMaterial(target) !== ACID && random() < ACID_EAT) {
      cells[below] = 0
      state.dissolved++
      if (spendLife(cells, index)) moveCell(state, index, below)
      return true
    }
  }
  return stepGranular(state, index, x, y, 1, 0)
}

// Mostly straight, sometimes veering up or down.
function growthOrder(random) {
  var roll = random()
  if (roll < 0.7) return [0, -1, 1]
  if (roll < 0.85) return [-1, 0, 1]
  return [1, 0, -1]
}

// Sprout: once resting, grows a vine of its colour toward one wall,
// burrowing up to the surface first when it is buried.
function stepSprout(state, index, x, y) {
  var cells = state.cells
  var random = state.random
  var sprout = cells[index]
  if (y < HEIGHT - 1 && cells[index + WIDTH] === 0) { moveCell(state, index, index + WIDTH); return true }
  if (random() > SPROUT_GROW) return false
  var vine = packCell(cellColor(sprout) - 1, randomIndex(random, SHADES), VINE)
  var nx = x + (cellShade(sprout) === GROWS_RIGHT ? 1 : -1)
  var reachedWall = nx < 0 || nx >= WIDTH
  if (reachedWall || random() < SPROUT_STOP) { cells[index] = vine; return true }
  var order = growthOrder(random)
  for (var k = 0; k < order.length; k++) {
    var ny = y + order[k]
    if (ny < 0 || ny >= HEIGHT || cells[ny * WIDTH + nx] !== 0) continue
    moveCell(state, index, ny * WIDTH + nx)
    cells[index] = vine
    return true
  }
  if (y > 0 && burrowUp(state, index, vine)) return true
  cells[index] = vine
  return true
}

// A buried sprout climbs toward the surface: into open air (leaving vine
// behind) or by swapping with loose sand or water above it.
function burrowUp(state, index, vine) {
  var cells = state.cells
  var up = index - WIDTH
  if (cells[up] === 0) {
    moveCell(state, index, up)
    cells[index] = vine
    return true
  }
  if (isMaterial(cells[up], SAND) || isMaterial(cells[up], WATER)) {
    swapCells(state, index, up)
    return true
  }
  return false
}

// One simulation pass, bottom-up, alternating scan direction per row so
// piles don't lean one way.
function sandStep(state) {
  var cells = state.cells
  var movedThisStep = state.movedThisStep
  movedThisStep.fill(0)
  var groove = state.groove
  var slide = groove.active ? groove.slide : 1
  var drift = (groove.active ? groove.liquid : 0) + state.shake
  state.shake = 0
  var moved = false
  var leftFirst = (state.frame & 1) === 0
  for (var y = HEIGHT - 1; y >= 0; y--) {
    for (var i = 0; i < WIDTH; i++) {
      var x = leftFirst ? i : WIDTH - 1 - i
      var index = y * WIDTH + x
      if (cells[index] !== 0 && !movedThisStep[index] && stepCell(state, index, x, y, slide, drift)) moved = true
    }
    leftFirst = !leftFirst
  }
  state.frame++
  return moved
}

function stepCell(state, index, x, y, slide, drift) {
  switch (cellMaterial(state.cells[index])) {
  case SAND: return stepGranular(state, index, x, y, slide, drift)
  case WATER: return stepWater(state, index, x, y)
  case FIRE: return stepFire(state, index, x, y)
  case ACID: return stepAcid(state, index, x, y)
  case SPROUT: return stepSprout(state, index, x, y)
  default: return false   // vines stay rooted where they grew
  }
}

// ------------------------------------------------------------------ clears

// Every same-colour region that touches both side walls (8-connected).
// Seeding only from the left wall is enough: a spanning region must touch it.
function findSpans(state) {
  state.visited.fill(0)
  var spans = []
  for (var y = 0; y < HEIGHT; y++) {
    var start = y * WIDTH
    if (pathColor(state.cells[start]) === 0 || state.visited[start]) continue
    var region = floodRegion(state, start)
    if (region.reachesRightWall) spans.push(region.cells)
  }
  return spans
}

function floodRegion(state, start) {
  var cells = state.cells
  var visited = state.visited
  var color = pathColor(cells[start])
  var region = { cells: [], reachesRightWall: false }
  var stack = [start]
  visited[start] = 1
  while (stack.length > 0) {
    var index = stack.pop()
    region.cells.push(index)
    var x = index % WIDTH
    var y = (index - x) / WIDTH
    if (x === WIDTH - 1) region.reachesRightWall = true
    for (var k = 0; k < NEIGHBOURS.length; k++) {
      var nx = x + NEIGHBOURS[k][0], ny = y + NEIGHBOURS[k][1]
      if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue
      var n = ny * WIDTH + nx
      if (visited[n] || pathColor(cells[n]) !== color) continue
      visited[n] = 1
      stack.push(n)
    }
  }
  return region
}

function startClear(state, spans) {
  var grains = spans.reduce(function(all, span) { return all.concat(span) }, [])
  var bonus = state.pouring ? POUR_BONUS : 1
  state.chain++
  state.bestChain = Math.max(state.bestChain, state.chain)
  state.clears += spans.length
  var points = grains.length * state.chain * state.level * bonus
  state.score += points
  state.level = Math.max(state.level, 1 + Math.floor(state.clears / CLEARS_PER_LEVEL))
  state.flashing = grains
  state.flashMs = 0
  state.events.push({ type: "clear", grains: grains.length, chain: state.chain, points: points, flip: bonus > 1 })
}

function finishClear(state) {
  for (var i = 0; i < state.flashing.length; i++) state.cells[state.flashing[i]] = 0
  state.flashing = null
  state.sandActive = true
}

// ------------------------------------------------------------------- flips

function scheduleFlip(state, first) {
  var gap = FLIP_MIN_MS + state.random() * (FLIP_MAX_MS - FLIP_MIN_MS) + (first ? FIRST_FLIP_GRACE_MS : 0)
  state.flipIn = Math.max(FLIP_FLOOR_MS, gap - (state.level - 1) * FLIP_SOONER_PER_LEVEL_MS)
}

// Turn the board upside down. The falling piece is held until the pour
// settles; clears made while it pours score double.
function flip(state) {
  mirrorRows(state.cells)
  tearVinesLoose(state.cells)
  if (state.piece) state.heldPiece = state.piece
  state.piece = null
  state.pouring = true
  state.pourMs = 0
  state.chain = 0
  state.sandActive = true
  state.events.push({ type: "flip" })
  scheduleFlip(state, false)
}

function mirrorRows(cells) {
  for (var top = 0, bottom = HEIGHT - 1; top < bottom; top++, bottom--) {
    var a = top * WIDTH, b = bottom * WIDTH
    for (var x = 0; x < WIDTH; x++) {
      var swap = cells[a + x]; cells[a + x] = cells[b + x]; cells[b + x] = swap
    }
  }
}

// Rooted vines would hang from the new ceiling and block the spawn point,
// so the jolt turns them (and sprouts) back into sand of their colour.
function tearVinesLoose(cells) {
  for (var i = 0; i < cells.length; i++)
    if (isMaterial(cells[i], VINE) || isMaterial(cells[i], SPROUT)) cells[i] = asSand(cells[i])
}

function finishPour(state) {
  var held = state.heldPiece
  state.pouring = false
  state.heldPiece = null
  spawn(state, held || undefined)
}

// Seconds left before the next flip, or 0 when no warning is showing.
function flipCountdown(state) {
  if (!state.flips || state.pouring || state.flipIn > FLIP_WARNING_MS) return 0
  return Math.max(1, Math.ceil(state.flipIn / 1000))
}

// ------------------------------------------------------------------ groove

// energy: 0..1 loudness of the music; active: whether music is playing.
// Quiet makes sand sticky so it stacks steeply; loud makes it runny.
function setGroove(state, active, energy) {
  var groove = state.groove
  groove.active = active === true
  if (!groove.active) {
    groove.slide = 1
    groove.liquid = 0
    return
  }
  var flow = clamp((energy - GROOVE_QUIET) / (GROOVE_FLOWING - GROOVE_QUIET), 0, 1)
  groove.slide = GROOVE_STICKY_SLIDE + (1 - GROOVE_STICKY_SLIDE) * flow * flow
  groove.liquid = energy > GROOVE_RUNNY ? Math.min(GROOVE_MAX_DRIFT, (energy - GROOVE_RUNNY) * 2) : 0
}

// A beat knocks loose grains sideways on the next simulation pass.
function shake(state, strength) {
  state.shake = Math.max(state.shake, clamp(strength, 0, 1) * BEAT_DRIFT)
  state.sandActive = true
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)) }

// ------------------------------------------------------------------ update

// Advance the game by dtMs. input: { horizontal: -1|0|1, fast, softDrop }.
// Returns whether anything on the board changed.
function update(state, dtMs, input) {
  if (state.status !== "playing" || state.paused) return false
  dtMs = Math.min(dtMs, MAX_FRAME_MS)
  input = input || {}

  if (state.flashing !== null) {
    advanceFlash(state, dtMs)
    return true
  }
  if (state.flips && !state.pouring && countDownToFlip(state, dtMs)) return true

  var sand = settleSand(state, dtMs)
  if (state.flashing !== null) return true
  if (state.pouring) {
    advancePour(state, dtMs, sand.settled)
    return true
  }
  if (!state.piece) return sand.changed

  var steered = steerPiece(state, dtMs, input)
  var fell = applyGravity(state, dtMs, input)
  var grounded = lockWhenGrounded(state, dtMs, input)
  return sand.changed || steered || fell || grounded
}

function advanceFlash(state, dtMs) {
  state.flashMs += dtMs
  if (state.flashMs >= FLASH_MS) finishClear(state)
}

function countDownToFlip(state, dtMs) {
  state.flipIn -= dtMs
  if (state.flipIn > 0) return false
  flip(state)
  return true
}

// Run the sand passes due this frame (a fixed rate, whatever the frame rate)
// and start a clear if a wall-to-wall path has formed.
function settleSand(state, dtMs) {
  state.sandCarry += dtMs * SAND_STEPS_PER_SECOND / 1000
  var steps = Math.floor(state.sandCarry)
  state.sandCarry -= steps
  var moved = false
  for (var s = 0; s < steps; s++) if (sandStep(state)) moved = true
  var changed = moved || state.sandActive
  if (changed) {
    var spans = findSpans(state)
    if (spans.length > 0) {
      startClear(state, spans)
      return { changed: true, settled: false }
    }
  }
  if (steps > 0) state.sandActive = moved
  return { changed: changed, settled: steps > 0 && !moved }
}

function advancePour(state, dtMs, sandSettled) {
  state.pourMs += dtMs
  var roomToSpawn = !state.heldPiece || spawnFits(state, state.heldPiece)
  var settled = sandSettled && state.pourMs >= POUR_SETTLE_MS
  var waitedLongEnough = state.pourMs >= POUR_MAX_MS
  if (((settled || waitedLongEnough) && roomToSpawn) || state.pourMs >= POUR_GIVE_UP_MS)
    finishPour(state)
}

function steerPiece(state, dtMs, input) {
  if (!input.horizontal) {
    state.moveCarry = 0
    return false
  }
  var moved = false
  state.moveCarry += dtMs * (input.fast ? FAST_MOVE_SPEED : MOVE_SPEED) / 1000
  while (state.moveCarry >= 1) {
    state.moveCarry -= 1
    if (!shift(state, input.horizontal)) {
      state.moveCarry = 0
      break
    }
    moved = true
  }
  return moved
}

function gravityPerSecond(state) {
  return Math.min(MAX_GRAVITY, BASE_GRAVITY + (state.level - 1) * GRAVITY_PER_LEVEL)
}

function applyGravity(state, dtMs, input) {
  var piece = state.piece
  var speed = input.softDrop ? Math.max(SOFT_DROP_SPEED, gravityPerSecond(state)) : gravityPerSecond(state)
  var fell = false
  state.fallCarry += dtMs * speed / 1000
  while (state.fallCarry >= 1) {
    state.fallCarry -= 1
    if (!fits(state, piece.blocks, piece.x, piece.y + 1)) {
      state.fallCarry = 0
      break
    }
    piece.y++
    state.lockMs = 0
    fell = true
  }
  return fell
}

function lockWhenGrounded(state, dtMs, input) {
  var piece = state.piece
  if (fits(state, piece.blocks, piece.x, piece.y + 1)) {
    state.lockMs = 0
    return false
  }
  state.lockMs += dtMs
  if (input.softDrop || state.lockMs >= LOCK_MS) land(state)
  return true
}

function setPaused(state, paused) {
  if (state.status === "playing") state.paused = paused
}

function takeEvents(state) {
  var events = state.events
  state.events = []
  return events
}

// --------------------------------------------------------------- rendering

// Build the colour tables the renderer needs from base [r, g, b] colours.
// sand:  one [r, g, b] base per sand colour
// extra: { fire: [4 bases], acid: [2 bases], water, sprout, background }
function buildPalette(sand, extra) {
  extra = extra || {}
  var water = extra.water || [80, 160, 220]
  var fire = extra.fire || [[200, 60, 40], [230, 120, 60], [240, 180, 80], [255, 230, 150]]
  var acid = extra.acid || [[120, 220, 90], [180, 250, 140]]
  var sprout = extra.sprout || [240, 250, 220]
  var background = extra.background || [20, 20, 28]
  function tones(rgb, factors) { return factors.map(function(f) { return scaleRgb(rgb, f) }) }
  return {
    sand: sand.map(function(rgb) { return tones(rgb, [0.80, 0.90, 1.0, 1.10]) }),
    // Vines glow lighter than sand so they read as veins through the pile.
    vine: sand.map(function(rgb) { return tones(rgb, [1.28, 1.36, 1.44, 1.36]) }),
    // Dye water: its colour, see-through against the board, with a glint tone.
    water: sand.map(function(rgb) {
      var body = mixRgb(mixRgb(rgb, water, 0.2), background, 0.42)
      return [body, scaleRgb(body, 1.08), scaleRgb(body, 1.16), mixRgb(rgb, [255, 255, 255], 0.5)]
    }),
    fire: fire.map(function(rgb) { return rgb.slice() }),
    acid: [scaleRgb(acid[0], 0.75), scaleRgb(acid[0], 0.9), acid[0], acid[1]],
    sprout: sprout.slice()
  }
}

// Darken below 1, lighten toward white above 1.
function scaleRgb(rgb, factor) {
  return rgb.map(function(v) {
    var scaled = factor >= 1 ? v + (255 - v) * (factor - 1) : v * factor
    return clamp(Math.round(scaled), 0, 255)
  })
}

function mixRgb(a, b, t) {
  return [0, 1, 2].map(function(i) { return Math.round(a[i] + (b[i] - a[i]) * t) })
}

// Animated tones: water glints, acid bubbles, fire flickers.
function waterTone(shade, index, frame) { return ((index * 7 + (frame >> 2)) & 15) === 0 ? 3 : shade % 3 }
function acidTone(shade, index, frame) { return ((index * 13 + (frame >> 2)) & 15) === 0 ? 3 : shade }
function flicker(index, frame) { return index * 31 + frame * 7 }

function grainColor(palette, cell, index, frame) {
  var color = cellColor(cell) - 1
  var shade = cellShade(cell)
  switch (cellMaterial(cell)) {
  case VINE: return palette.vine[color][shade]
  case WATER: return palette.water[color][waterTone(shade, index, frame)]
  case FIRE: return palette.fire[Math.min(3, shade + (flicker(index, frame) & 1))]
  case ACID: return palette.acid[acidTone(shade, index, frame)]
  case SPROUT: return palette.sprout
  default: return palette.sand[color][shade]
  }
}

// Colour of a falling piece's grain, previewing what it becomes.
function pieceGrainColor(palette, piece, shade, index, frame) {
  switch (piece.material) {
  case "water": return palette.water[piece.color][waterTone(shade, index, frame)]
  case "fire": return palette.fire[(shade + (flicker(index, frame) & 3)) & 3]
  case "acid": return palette.acid[acidTone(shade, index, frame)]
  case "seed": return shade === 0 ? palette.vine[piece.color][2] : palette.sand[piece.color][shade]
  default: return palette.sand[piece.color][shade]
  }
}

function putPixel(pixels, index, rgb) {
  var p = index * 4
  pixels[p] = rgb[0]
  pixels[p + 1] = rgb[1]
  pixels[p + 2] = rgb[2]
  pixels[p + 3] = 255
}

function blendPixel(pixels, index, rgb, alpha) {
  var p = index * 4
  for (var c = 0; c < 3; c++) pixels[p + c] = pixels[p + c] + (rgb[c] - pixels[p + c]) * alpha
}

// Render the board into an RGBA byte array, one pixel per grain.
// theme: { background, grid, flash: [r, g, b], ghost: alpha }
function render(state, pixels, palette, theme) {
  paintCells(state, pixels, palette, theme)
  if (state.flashing !== null) paintFlash(state, pixels, theme.flash)
  if (!state.piece || state.status !== "playing") return
  paintGhost(state, pixels, palette, theme.ghost)
  paintPiece(state, pixels, palette)
}

function paintCells(state, pixels, palette, theme) {
  var cells = state.cells
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i]
    var onGridLine = (i % WIDTH) % GRAIN === 0
    var rgb = cell !== 0 ? grainColor(palette, cell, i, state.frame) : (onGridLine ? theme.grid : theme.background)
    putPixel(pixels, i, rgb)
  }
}

function paintFlash(state, pixels, flashRgb) {
  var flashOn = Math.floor(state.flashMs / 70) % 2 === 0
  if (!flashOn) return
  for (var i = 0; i < state.flashing.length; i++) putPixel(pixels, state.flashing[i], flashRgb)
}

// A faint copy of the piece where a hard drop would put it.
function paintGhost(state, pixels, palette, alpha) {
  var piece = state.piece
  var distance = dropDistance(state)
  if (distance <= GRAIN / 2) return
  var tint = pieceGrainColor(palette, piece, 2, 0, 0)
  forEachGrain(piece, piece.x, piece.y + distance, function(x, y) {
    if (y >= 0 && y < HEIGHT) blendPixel(pixels, y * WIDTH + x, tint, alpha)
  })
}

function paintPiece(state, pixels, palette) {
  var piece = state.piece
  forEachGrain(piece, piece.x, piece.y, function(x, y, shade) {
    if (y < 0 || y >= HEIGHT) return
    var index = y * WIDTH + x
    putPixel(pixels, index, pieceGrainColor(palette, piece, shade, index, state.frame))
  })
}

// Render a piece centred in a small RGBA buffer, for the "next" preview.
function renderPreview(piece, pixels, width, height, palette, background, frame) {
  for (var i = 0; i < width * height; i++) putPixel(pixels, i, background)
  if (!piece) return
  var bounds = pieceBounds(piece.blocks)
  var originX = Math.floor((width - (bounds.maxX - bounds.minX + 1) * GRAIN) / 2) - bounds.minX * GRAIN
  var originY = Math.floor((height - (bounds.maxY - bounds.minY + 1) * GRAIN) / 2) - bounds.minY * GRAIN
  forEachGrain(piece, originX, originY, function(x, y, shade) {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    var index = y * width + x
    putPixel(pixels, index, pieceGrainColor(palette, piece, shade, index, frame || 0))
  })
}
