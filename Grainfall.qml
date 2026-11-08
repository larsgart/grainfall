import QtQuick
import QtCore
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire
import qs.Commons
import qs.Commons as Commons
import "Engine.js" as Engine

Item {
  id: root

  property var shell: null
  readonly property bool opened: window.visible
  property bool closingFromHost: false

  property var game: null
  property string view: "title"          // title | game
  property int difficulty: prefs.difficulty
  property int score: 0
  property int level: 1
  property int clears: 0
  property int bestChain: 0
  property bool paused: false
  property bool over: false
  property bool newBest: false
  property int flipCountdown: 0
  property string nextMaterial: "sand"
  property bool gameGroove: false        // Groove as chosen when this game started

  property bool leftHeld: false
  property bool rightHeld: false
  property bool fastHeld: false
  property bool downHeld: false
  property int lastHorizontal: 0
  property var shownNext: null
  property int previewTicks: 0

  readonly property var difficulties: [
    { key: "easy", colors: 3, label: "difficulty.easy" },
    { key: "normal", colors: 4, label: "difficulty.normal" },
    { key: "hard", colors: 5, label: "difficulty.hard" }
  ]
  readonly property var modifiers: [
    { key: "flips", letter: "F" },
    { key: "elements", letter: "E" },
    { key: "groove", letter: "M" }
  ]

  // ---------------------------------------------------------------- theme

  readonly property color background: Commons.Color.background
  readonly property color foreground: Commons.Color.foreground
  readonly property color accent: Commons.Color.accent
  readonly property color muted: Commons.Color.muted
  readonly property color urgent: Commons.Color.urgent
  readonly property color hairline: alpha(foreground, 0.12)
  readonly property color boardColor: Qt.tint(background, Qt.rgba(0, 0, 0, 0.18))
  readonly property real cornerRadius: Math.min(Style.cornerRadius, 6)

  property var themeColors: ({})
  readonly property var sandColors: {
    var t = themeColors
    return [
      t.red || urgent,
      t.yellow || Qt.tint(accent, "#80e0b050"),
      t.blue || accent,
      t.green || Qt.tint(foreground, "#8060c060"),
      t.magenta || Qt.tint(accent, "#80c060c0")
    ]
  }
  readonly property var palette: {
    var t = themeColors
    var red = t.red || urgent
    var yellow = t.yellow || "#e0b050"
    var acid = t.bright_green || t.green || "#90e070"
    return Engine.buildPalette(sandColors.map(rgbOf), {
      fire: [red, t.orange || Qt.tint(red, "#80f0a040"), yellow, t.bright_yellow || Qt.tint(yellow, "#80ffffff")].map(rgbOf),
      acid: [acid, Qt.tint(acid, "#90ffffff")].map(rgbOf),
      water: rgbOf(t.bright_cyan || t.cyan || accent),
      sprout: rgbOf(t.bright_foreground || foreground),
      background: rgbOf(boardColor)
    })
  }
  readonly property var boardTheme: ({
    background: rgbOf(boardColor),
    grid: rgbOf(Qt.tint(boardColor, alpha(foreground, 0.022))),
    flash: rgbOf(Qt.tint(foreground, "#60ffffff")),
    ghost: 0.16
  })

  onPaletteChanged: repaintAll()
  onBoardThemeChanged: repaintAll()

  function alpha(color, opacity) { return Qt.rgba(color.r, color.g, color.b, opacity) }

  function rgbOf(color) {
    var c = Qt.color(color)
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
  }

  function loadThemeColors(raw) {
    var parsed = {}
    var colorLine = /^\s*((?:bright_)?(?:red|yellow|green|blue|magenta|cyan|foreground)|orange)\s*=\s*["']?(#[0-9A-Fa-f]{6})/
    var lines = String(raw || "").split("\n")
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(colorLine)
      if (match) parsed[match[1]] = match[2]
    }
    themeColors = parsed
  }

  FileView {
    id: colorsFile
    path: Commons.Color.currentThemePath + "/colors.toml"
    watchChanges: true
    printErrors: false
    onLoaded: root.loadThemeColors(text())
    onFileChanged: reload()
  }

  // Theme switches push the new palette to Commons.Color over IPC; re-read
  // the sand colours from the same theme whenever that happens.
  Connections {
    target: Commons.Color
    function onAccentChanged() { colorsFile.reload() }
    function onBackgroundChanged() { colorsFile.reload() }
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // ---------------------------------------------------------- persistence

  // The dev harness points this at a throwaway file so test runs never touch real scores.
  readonly property string stateFile: Quickshell.env("GRAINFALL_STATE_FILE")
    || StandardPaths.writableLocation(StandardPaths.GenericStateLocation) + "/grainfall.ini"

  Settings {
    id: best
    location: root.stateFile
    category: "best"
    property int easy: 0
    property int normal: 0
    property int hard: 0
  }

  Settings {
    id: prefs
    location: root.stateFile
    category: "prefs"
    property int difficulty: 1
    property bool flips: true
    property bool elements: true
    property bool groove: true
  }

  function bestFor(index) { return best[difficulties[index].key] || 0 }

  // Saves the current game's score if it beats the best; returns whether it did.
  function recordBest() {
    var key = difficulties[difficulty].key
    if (game.score <= (best[key] || 0)) return false
    best[key] = game.score
    return true
  }

  function modifierOn(key) { return prefs[key] === true }
  function toggleModifier(key) { prefs[key] = !prefs[key] }

  // ---------------------------------------------------------------- groove
  // The default output's peak level drives the sand. Nothing is recorded or
  // stored: the meter only runs while a Groove game is on screen.

  property real grooveFast: 0
  property real grooveSlow: 0
  property bool grooveActive: false
  property double lastPeakAt: 0
  property double lastBeatAt: 0

  PwObjectTracker { objects: Pipewire.defaultAudioSink ? [Pipewire.defaultAudioSink] : [] }

  PwNodePeakMonitor {
    node: Pipewire.defaultAudioSink
    enabled: window.visible && root.view === "game" && root.gameGroove && !!Pipewire.defaultAudioSink
    onPeakChanged: root.handlePeak(peak)
  }

  // A beat is a peak well above the recent average, at most every 220 ms.
  function handlePeak(peak) {
    var now = Date.now()
    lastPeakAt = now
    grooveFast = peak > grooveFast ? peak : grooveFast * 0.6 + peak * 0.4
    grooveSlow = grooveSlow * 0.96 + peak * 0.04
    var jump = peak - grooveSlow
    if (jump > 0.12 && peak > 0.3 && now - lastBeatAt > 220) {
      lastBeatAt = now
      beat(Math.min(1, jump * 3))
    }
  }

  function updateGroove() {
    if (!gameGroove) return
    // Peaks stop arriving in silence, so let the levels fall on their own.
    if (Date.now() - lastPeakAt > 250) {
      grooveFast *= 0.9
      grooveSlow *= 0.985
    }
    grooveActive = grooveSlow > 0.05
    Engine.setGroove(game, grooveActive, grooveFast)
  }

  function beat(strength) {
    if (!game || paused || over) return
    Engine.shake(game, strength)
    boardShake.amplitude = 2 + strength * 4
    boardShake.restart()
    beatPulse.restart()
  }

  // ------------------------------------------------------------ lifecycle

  function open(payloadJson) {
    if (window.visible) {
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
      return
    }
    closingFromHost = false
    window.visible = true
    Qt.callLater(function() {
      keyCatcher.forceActiveFocus()
      repaintAll()
    })
  }

  // Called by the shell; the window's own close goes through requestClose.
  function close() {
    closingFromHost = true
    requestClose()
    closingFromHost = false
  }

  function requestClose() {
    pauseGame(true)
    resetHeld()
    window.visible = false
  }

  // ----------------------------------------------------------------- game

  function startGame() {
    prefs.difficulty = difficulty
    game = Engine.newGame({
      colors: difficulties[difficulty].colors,
      flips: prefs.flips,
      elements: prefs.elements
    })
    gameGroove = prefs.groove
    grooveFast = 0
    grooveSlow = 0
    grooveActive = false
    view = "game"
    over = false
    newBest = false
    paused = false
    shownNext = null
    resetHeld()
    syncStats()
    repaintAll()
  }

  function pauseGame(value) {
    if (!game || game.status !== "playing") return
    Engine.setPaused(game, value)
    paused = game.paused
    if (paused) pauseIndex = 0
    resetHeld()
  }

  // Leave the current game for the title screen. A score that beats the
  // best still counts, even from an abandoned game.
  function goToMenu() {
    if (game && !over) recordBest()
    game = null
    view = "title"
    score = 0
    level = 1
    clears = 0
    bestChain = 0
    paused = false
    over = false
    flipCountdown = 0
    nextMaterial = "sand"
    shownNext = null
    resetHeld()
    repaintAll()
  }

  function finishGame() {
    over = true
    overIndex = 0
    resetHeld()
    newBest = recordBest()
    board.requestPaint()
  }

  function resetHeld() {
    leftHeld = false
    rightHeld = false
    fastHeld = false
    downHeld = false
    lastHorizontal = 0
  }

  function syncStats() {
    if (!game) return
    score = game.score
    level = game.level
    clears = game.clears
    bestChain = game.bestChain
  }

  function horizontalInput() {
    if (leftHeld && rightHeld) return lastHorizontal
    if (leftHeld) return -1
    if (rightHeld) return 1
    return 0
  }

  function tick(dtMs) {
    if (!game) return
    updateGroove()
    var changed = Engine.update(game, dtMs, {
      horizontal: horizontalInput(),
      fast: fastHeld,
      softDrop: downHeld
    })
    handleEvents()
    if (changed) board.requestPaint()
    flipCountdown = Engine.flipCountdown(game)
    refreshPreview()
  }

  function refreshPreview() {
    if (game.next !== shownNext) {
      shownNext = game.next
      nextMaterial = game.next ? game.next.material : "sand"
      preview.requestPaint()
    } else if (nextMaterial !== "sand" && ++previewTicks % 3 === 0) {
      preview.requestPaint()   // keep water, fire and acid shimmering
    }
  }

  function handleEvents() {
    var events = Engine.takeEvents(game)
    if (events.length === 0) return
    for (var i = 0; i < events.length; i++) {
      var e = events[i]
      if (e.type === "clear") showPopup(e)
      else if (e.type === "flip") flipAnimation.restart()
      else if (e.type === "gameOver") finishGame()
    }
    syncStats()
  }

  function showPopup(e) {
    popup.points = e.points
    popup.chain = e.chain
    popup.flip = e.flip === true
    popupAnimation.restart()
  }

  function repaintAll() {
    board.requestPaint()
    preview.requestPaint()
  }

  function act(fn) {
    if (!game || paused || over) return
    if (fn()) {
      handleEvents()
      board.requestPaint()
    }
  }

  // ------------------------------------------------------------ menus

  readonly property var pauseItems: [
    { action: "resume", label: "pause.resume", key: "Esc" },
    { action: "restart", label: "pause.restart", key: "R" },
    { action: "menu", label: "pause.menu", key: "M" },
    { action: "close", label: "pause.close", key: "C" }
  ]
  readonly property var overItems: [
    { action: "restart", label: "over.again", key: "Enter" },
    { action: "menu", label: "pause.menu", key: "Esc" }
  ]
  property int pauseIndex: 0
  property int overIndex: 0

  function menuAction(action) {
    if (action === "resume") pauseGame(false)
    else if (action === "restart") startGame()
    else if (action === "menu") goToMenu()
    else if (action === "close") requestClose()
  }

  // ------------------------------------------------------------ keyboard

  function isActivateKey(key) { return key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space }
  function isUpKey(key) { return key === Qt.Key_Up || key === Qt.Key_W }
  function isDownKey(key) { return key === Qt.Key_Down || key === Qt.Key_S }

  function handleKeyPressed(event) {
    if (view === "title") event.accepted = handleTitleKey(event)
    else if (over) event.accepted = handleOverKey(event)
    else if (paused) event.accepted = handlePausedKey(event)
    else event.accepted = handlePlayKey(event)
  }

  function handleTitleKey(event) {
    var key = event.key
    if (key === Qt.Key_Escape) requestClose()
    else if (isUpKey(key)) difficulty = Math.max(0, difficulty - 1)
    else if (isDownKey(key)) difficulty = Math.min(difficulties.length - 1, difficulty + 1)
    else if (event.isAutoRepeat) { /* toggles and start ignore key repeat */ }
    else if (key === Qt.Key_F) toggleModifier("flips")
    else if (key === Qt.Key_E) toggleModifier("elements")
    else if (key === Qt.Key_M) toggleModifier("groove")
    else if (isActivateKey(key)) startGame()
    else return false
    return true
  }

  function handleOverKey(event) {
    var key = event.key
    if (event.isAutoRepeat) return true
    if (isUpKey(key) || isDownKey(key)) overIndex = (overIndex + 1) % overItems.length
    else if (isActivateKey(key)) menuAction(overItems[overIndex].action)
    else if (key === Qt.Key_R) startGame()
    else if (key === Qt.Key_Escape || key === Qt.Key_M) goToMenu()
    return true
  }

  function handlePausedKey(event) {
    var key = event.key
    var count = pauseItems.length
    if (isUpKey(key)) pauseIndex = (pauseIndex + count - 1) % count
    else if (isDownKey(key)) pauseIndex = (pauseIndex + 1) % count
    else if (event.isAutoRepeat) { /* actions ignore key repeat */ }
    else if (isActivateKey(key)) menuAction(pauseItems[pauseIndex].action)
    else if (key === Qt.Key_Escape || key === Qt.Key_P) pauseGame(false)
    else if (key === Qt.Key_R) startGame()
    else if (key === Qt.Key_M) goToMenu()
    else if (key === Qt.Key_C) requestClose()
    return true
  }

  // Held keys (move, soft drop, Shift) are tracked; one-shot keys act once
  // per press and ignore key repeat.
  function handlePlayKey(event) {
    var key = event.key
    var firstPress = !event.isAutoRepeat
    switch (key) {
    case Qt.Key_Escape:
    case Qt.Key_P:
      if (firstPress) pauseGame(true)
      return true
    case Qt.Key_Left:
    case Qt.Key_A:
      if (firstPress) startMoving(-1)
      return true
    case Qt.Key_Right:
    case Qt.Key_D:
      if (firstPress) startMoving(1)
      return true
    case Qt.Key_Shift:
      fastHeld = true
      return true
    case Qt.Key_Down:
    case Qt.Key_S:
      downHeld = true
      return true
    case Qt.Key_Up:
    case Qt.Key_X:
    case Qt.Key_W:
      if (firstPress) act(function() { return Engine.rotate(game, 1) })
      return true
    case Qt.Key_Z:
    case Qt.Key_Q:
      if (firstPress) act(function() { return Engine.rotate(game, -1) })
      return true
    case Qt.Key_Space:
      if (firstPress) act(function() { return Engine.hardDrop(game) })
      return true
    default:
      return false
    }
  }

  // Step one grain at once; holding the key keeps moving in tick().
  function startMoving(direction) {
    if (direction < 0) leftHeld = true
    else rightHeld = true
    lastHorizontal = direction
    act(function() { return Engine.shift(game, direction) })
  }

  function handleKeyReleased(event) {
    if (event.isAutoRepeat) return
    switch (event.key) {
    case Qt.Key_Left:
    case Qt.Key_A:
      leftHeld = false
      if (rightHeld) lastHorizontal = 1
      break
    case Qt.Key_Right:
    case Qt.Key_D:
      rightHeld = false
      if (leftHeld) lastHorizontal = -1
      break
    case Qt.Key_Shift:
      fastHeld = false
      break
    case Qt.Key_Down:
    case Qt.Key_S:
      downHeld = false
      break
    default:
      return
    }
    event.accepted = true
  }

  FrameAnimation {
    running: window.visible && root.view === "game" && root.game !== null && !root.paused && !root.over
    onTriggered: root.tick(frameTime * 1000)
  }

  // --------------------------------------------------------------- window

  FloatingWindow {
    id: window
    title: "Grainfall"
    visible: false
    color: root.background
    implicitWidth: 600
    implicitHeight: 680
    minimumSize: Qt.size(420, 460)

    onVisibleChanged: {
      if (!visible && !root.closingFromHost && root.shell && typeof root.shell.hide === "function")
        root.shell.hide("lars.grainfall")
    }

    FocusScope {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onPressed: function(event) { root.handleKeyPressed(event) }
      Keys.onReleased: function(event) { root.handleKeyReleased(event) }

      Rectangle {
        anchors.fill: parent
        color: root.background
      }

      Item {
        id: layout
        anchors.fill: parent
        anchors.margins: Math.max(14, Math.min(28, parent.width * 0.04, parent.height * 0.04))

        readonly property real sideWidth: Math.max(130, Math.min(190, width * 0.3))
        readonly property real gap: Math.max(14, width * 0.035)
        readonly property real dpr: Screen.devicePixelRatio > 0 ? Screen.devicePixelRatio : 1
        // Snap the grain size to whole device pixels so every grain is the same size.
        readonly property real grainSize: {
          var fit = Math.min((width - sideWidth - gap - 2) / Engine.WIDTH, (height - 2) / Engine.HEIGHT)
          return Math.max(1, Math.floor(fit * dpr)) / dpr
        }

        Row {
          anchors.centerIn: parent
          spacing: layout.gap

          // ------------------------------------------------------- board
          Rectangle {
            id: boardFrame
            width: Engine.WIDTH * layout.grainSize + 2
            height: Engine.HEIGHT * layout.grainSize + 2
            color: root.boardColor
            border.width: root.flipCountdown > 0 ? 2 : 1
            border.color: root.flipCountdown > 0 ? root.urgent : root.hairline
            radius: root.cornerRadius
            transform: Translate { id: shakeShift }

            SequentialAnimation {
              id: boardShake
              property real amplitude: 4
              NumberAnimation { target: shakeShift; property: "x"; to: boardShake.amplitude; duration: Style.duration(40); easing.type: Easing.OutCubic }
              NumberAnimation { target: shakeShift; property: "x"; to: -boardShake.amplitude * 0.7; duration: Style.duration(60); easing.type: Easing.OutCubic }
              NumberAnimation { target: shakeShift; property: "x"; to: 0; duration: Style.duration(80); easing.type: Easing.OutCubic }
            }

            Item {
              id: boardClip
              x: 1
              y: 1
              width: Engine.WIDTH * layout.grainSize
              height: Engine.HEIGHT * layout.grainSize
              clip: true

              // The engine renders one pixel per grain; drawImage scales it up.
              // (putImageData draws nothing in Qt Quick's Canvas, so it is not used.)
              Canvas {
                id: board
                anchors.fill: parent
                smooth: false
                renderTarget: Canvas.Image
                property var imageData: null

                // A flip mirrors the board data at once; starting this turn at
                // 180° shows the old picture and swings it round to the new one.
                transform: Rotation {
                  id: flipRotation
                  origin.x: board.width / 2
                  origin.y: board.height / 2
                  axis { x: 1; y: 0; z: 0 }
                  angle: 0
                }

                onPaint: {
                  var ctx = getContext("2d")
                  if (!root.game) {
                    ctx.fillStyle = root.boardColor
                    ctx.fillRect(0, 0, width, height)
                    return
                  }
                  if (!imageData) imageData = ctx.createImageData(Engine.WIDTH, Engine.HEIGHT)
                  Engine.render(root.game, imageData.data, root.palette, root.boardTheme)
                  ctx.drawImage(imageData, 0, 0, width, height)
                }
              }

              NumberAnimation {
                id: flipAnimation
                target: flipRotation
                property: "angle"
                from: 180
                to: 0
                duration: Style.duration(560)
                easing.type: Easing.OutCubic
              }

              Column {
                visible: root.flipCountdown > 0 && !root.paused && !root.over
                anchors.horizontalCenter: parent.horizontalCenter
                y: parent.height * 0.08
                spacing: 2
                BoardText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("flip.warning").arg(root.flipCountdown)
                  color: root.urgent
                  font.pixelSize: Math.max(18, boardClip.width * 0.085)
                  font.weight: Font.Bold
                }
                BoardText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("flip.hint")
                  font.pixelSize: 11
                }
              }

              Column {
                id: popup
                property int points: 0
                property int chain: 1
                property bool flip: false
                anchors.horizontalCenter: parent.horizontalCenter
                y: parent.height * 0.32
                opacity: 0
                spacing: 2

                BoardText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: "+" + Commons.I18n.formatNumber(popup.points)
                  font.pixelSize: Math.max(18, boardClip.width * 0.09)
                  font.weight: Font.Bold
                }
                BoardText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  visible: popup.chain > 1
                  text: strings.t("popup.chain").arg(popup.chain)
                  color: root.accent
                  font.pixelSize: Math.max(13, boardClip.width * 0.05)
                  font.weight: Font.DemiBold
                }
                BoardText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  visible: popup.flip
                  text: strings.t("popup.flip")
                  color: root.urgent
                  font.pixelSize: Math.max(13, boardClip.width * 0.05)
                  font.weight: Font.DemiBold
                }
              }

              SequentialAnimation {
                id: popupAnimation
                ParallelAnimation {
                  NumberAnimation { target: popup; property: "opacity"; from: 0; to: 1; duration: Style.duration(160); easing.type: Easing.OutCubic }
                  NumberAnimation { target: popup; property: "scale"; from: 0.96; to: 1; duration: Style.duration(160); easing.type: Easing.OutCubic }
                }
                PauseAnimation { duration: 650 }
                NumberAnimation { target: popup; property: "opacity"; to: 0; duration: Style.duration(140); easing.type: Easing.OutCubic }
              }

              // --------------------------------------------- overlays
              Rectangle {
                anchors.fill: parent
                visible: root.view === "title" || root.paused || root.over
                color: root.alpha(root.boardColor, root.view === "title" ? 0.94 : 0.78)
              }

              Column {
                id: titleView
                visible: root.view === "title"
                anchors.centerIn: parent
                width: parent.width - 24
                readonly property bool compact: boardClip.height < 560
                readonly property real choiceWidth: Math.min(width, 230)
                spacing: compact ? 8 : 12

                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: "GRAINFALL"
                  color: root.foreground
                  font.pixelSize: Math.max(22, boardClip.width * 0.11)
                  font.weight: Font.Bold
                  font.letterSpacing: 3
                }
                PlainText {
                  width: parent.width
                  horizontalAlignment: Text.AlignHCenter
                  wrapMode: Text.WordWrap
                  text: strings.t("title.tagline")
                  color: root.muted
                  font.pixelSize: 12
                }

                Repeater {
                  model: root.difficulties
                  delegate: Choice {
                    required property var modelData
                    required property int index
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: titleView.choiceWidth
                    height: titleView.compact ? 38 : 44
                    selected: index === root.difficulty
                    onActivated: {
                      if (root.difficulty === index) root.startGame()
                      else root.difficulty = index
                    }

                    Column {
                      anchors.centerIn: parent
                      spacing: 1
                      PlainText {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: strings.t(modelData.label)
                        color: selected ? root.foreground : root.muted
                        font.pixelSize: 13
                        font.weight: selected ? Font.DemiBold : Font.Normal
                      }
                      PlainText {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: strings.t("title.best").arg(Commons.I18n.formatNumber(root.bestFor(index)))
                        color: root.muted
                        font.pixelSize: 10
                      }
                    }
                  }
                }

                SectionLabel {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("title.chaos")
                  topPadding: titleView.compact ? 2 : 6
                }

                Column {
                  anchors.horizontalCenter: parent.horizontalCenter
                  width: titleView.choiceWidth
                  spacing: 4
                  Repeater {
                    model: root.modifiers
                    delegate: Choice {
                      required property var modelData
                      width: parent.width
                      height: titleView.compact ? 30 : 34
                      selected: root.modifierOn(modelData.key)
                      tone: root.urgent
                      fillOpacity: 0.12
                      borderOpacity: 0.7
                      onActivated: root.toggleModifier(modelData.key)

                      PlainText {
                        id: letter
                        anchors.left: parent.left
                        anchors.leftMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        text: modelData.letter
                        color: selected ? root.urgent : root.muted
                        font.pixelSize: 12
                        font.weight: Font.Bold
                      }
                      Column {
                        anchors.left: letter.right
                        anchors.leftMargin: 10
                        anchors.right: onOff.left
                        anchors.rightMargin: 6
                        anchors.verticalCenter: parent.verticalCenter
                        PlainText {
                          width: parent.width
                          elide: Text.ElideRight
                          text: strings.t("mod." + modelData.key)
                          color: selected ? root.foreground : root.muted
                          font.pixelSize: 12
                          font.weight: selected ? Font.DemiBold : Font.Normal
                        }
                        PlainText {
                          width: parent.width
                          elide: Text.ElideRight
                          visible: !titleView.compact
                          text: strings.t("mod." + modelData.key + ".hint")
                          color: root.muted
                          font.pixelSize: 9
                        }
                      }
                      PlainText {
                        id: onOff
                        anchors.right: parent.right
                        anchors.rightMargin: 10
                        anchors.verticalCenter: parent.verticalCenter
                        text: strings.t(selected ? "mod.on" : "mod.off")
                        color: selected ? root.urgent : root.muted
                        font.pixelSize: 10
                        font.weight: Font.DemiBold
                      }
                    }
                  }
                }

                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("title.start")
                  color: root.accent
                  font.pixelSize: 13
                  font.weight: Font.DemiBold
                  topPadding: titleView.compact ? 2 : 6
                }
              }

              Column {
                visible: root.view === "game" && root.paused && !root.over
                anchors.centerIn: parent
                width: parent.width - 28
                spacing: 10
                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("pause.title")
                  color: root.foreground
                  font.pixelSize: Math.max(18, boardClip.width * 0.08)
                  font.weight: Font.Bold
                  bottomPadding: 4
                }
                MenuList {
                  width: parent.width
                  items: root.pauseItems
                  currentIndex: root.pauseIndex
                  onHighlighted: function(index) { root.pauseIndex = index }
                }
              }

              Column {
                visible: root.view === "game" && root.over
                anchors.centerIn: parent
                width: parent.width - 28
                spacing: 10
                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: strings.t("over.title")
                  color: root.foreground
                  font.pixelSize: Math.max(18, boardClip.width * 0.075)
                  font.weight: Font.Bold
                }
                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: Commons.I18n.formatNumber(root.score)
                  color: root.accent
                  font.pixelSize: Math.max(22, boardClip.width * 0.1)
                  font.weight: Font.Bold
                }
                PlainText {
                  anchors.horizontalCenter: parent.horizontalCenter
                  visible: root.newBest
                  text: strings.t("over.newBest")
                  color: root.foreground
                  font.pixelSize: 13
                }
                Item { width: 1; height: 2 }
                MenuList {
                  width: parent.width
                  items: root.overItems
                  currentIndex: root.overIndex
                  onHighlighted: function(index) { root.overIndex = index }
                }
              }
            }
          }

          // -------------------------------------------------- side panel
          Column {
            width: layout.sideWidth
            height: boardFrame.height
            spacing: boardFrame.height > 560 ? 16 : 11

            // Always-visible way back: opens the pause menu.
            MenuRow {
              visible: root.view === "game"
              width: layout.sideWidth
              height: 32
              label: "☰  " + strings.t("side.menu")
              keyHint: "Esc"
              selected: root.paused || root.over
              onActivated: {
                if (root.over) root.goToMenu()
                else root.pauseGame(!root.paused)
              }
            }

            Column {
              spacing: 6
              SectionLabel { text: strings.t("stat.next") }
              Rectangle {
                width: layout.sideWidth
                height: width * 0.6
                color: root.boardColor
                border.width: 1
                border.color: root.nextMaterial !== "sand" && root.view === "game" ? root.urgent : root.hairline
                radius: root.cornerRadius

                Item {
                  id: previewBox
                  readonly property int grainsWide: 48
                  readonly property int grainsHigh: 28
                  readonly property real grainSize: {
                    var fit = Math.min((parent.width - 12) / grainsWide, (parent.height - 12) / grainsHigh)
                    return Math.max(1, Math.floor(fit * layout.dpr)) / layout.dpr
                  }
                  anchors.centerIn: parent
                  width: grainsWide * grainSize
                  height: grainsHigh * grainSize

                  Canvas {
                    id: preview
                    anchors.fill: parent
                    smooth: false
                    renderTarget: Canvas.Image
                    property var imageData: null
                    onPaint: {
                      var ctx = getContext("2d")
                      if (!imageData) imageData = ctx.createImageData(previewBox.grainsWide, previewBox.grainsHigh)
                      var next = root.game && root.view === "game" ? root.game.next : null
                      var frame = root.game ? root.game.frame : 0
                      Engine.renderPreview(next, imageData.data, previewBox.grainsWide, previewBox.grainsHigh,
                        root.palette, root.boardTheme.background, frame)
                      ctx.drawImage(imageData, 0, 0, width, height)
                    }
                  }
                }
              }
              Column {
                visible: root.nextMaterial !== "sand" && root.view === "game"
                width: layout.sideWidth
                PlainText {
                  text: strings.t("element." + root.nextMaterial)
                  color: root.urgent
                  font.pixelSize: 11
                  font.weight: Font.Bold
                  font.letterSpacing: 1
                }
                PlainText {
                  width: parent.width
                  wrapMode: Text.WordWrap
                  text: strings.t("element." + root.nextMaterial + ".hint")
                  color: root.muted
                  font.pixelSize: 10
                }
              }
            }

            Stat { label: strings.t("stat.score"); value: root.score; big: true }
            Stat { label: strings.t("stat.best"); value: root.bestFor(root.difficulty) }
            Stat { label: strings.t("stat.level"); value: root.level }
            Stat { label: strings.t("stat.clears"); value: root.clears }
            Stat { label: strings.t("stat.chain"); value: root.bestChain }

            Column {
              visible: root.view === "game" && root.gameGroove
              width: layout.sideWidth
              spacing: 4
              SectionLabel { text: strings.t("stat.groove") }
              Rectangle {
                width: parent.width
                height: 6
                radius: 3
                color: root.hairline
                Rectangle {
                  id: grooveBar
                  height: parent.height
                  radius: 3
                  width: parent.width * Math.min(1, root.grooveFast)
                  color: root.grooveActive ? root.accent : root.muted
                }
                Rectangle {
                  id: beatDot
                  anchors.verticalCenter: parent.verticalCenter
                  x: Math.max(0, grooveBar.width - width / 2)
                  width: 10
                  height: 10
                  radius: 5
                  color: root.urgent
                  opacity: 0
                }
                SequentialAnimation {
                  id: beatPulse
                  NumberAnimation { target: beatDot; property: "opacity"; to: 1; duration: Style.duration(30) }
                  NumberAnimation { target: beatDot; property: "opacity"; to: 0; duration: Style.duration(220); easing.type: Easing.OutCubic }
                }
              }
              PlainText {
                width: parent.width
                wrapMode: Text.WordWrap
                text: strings.t(root.grooveActive ? "groove.listening" : "groove.silent")
                color: root.muted
                font.pixelSize: 10
              }
            }

            Column {
              spacing: 3
              visible: boardFrame.height > 600
              Repeater {
                model: ["help.move", "help.rotate", "help.drop", "help.other"]
                delegate: PlainText {
                  required property string modelData
                  width: layout.sideWidth
                  wrapMode: Text.WordWrap
                  text: strings.t(modelData)
                  color: root.muted
                  font.pixelSize: 10
                }
              }
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ components

  component PlainText: Text {
    textFormat: Text.PlainText
    font.family: Style.fontFamily
  }

  // Text drawn over the sand, outlined so it stays readable.
  component BoardText: PlainText {
    color: root.foreground
    style: Text.Outline
    styleColor: root.boardColor
  }

  component SectionLabel: PlainText {
    color: root.muted
    font.pixelSize: 10
    font.letterSpacing: 1
  }

  component Stat: Column {
    property string label: ""
    property int value: 0
    property bool big: false
    spacing: 2
    SectionLabel { text: parent.label }
    PlainText {
      text: Commons.I18n.formatNumber(parent.value)
      color: root.foreground
      font.pixelSize: parent.big ? 24 : 17
      font.weight: Font.DemiBold
    }
  }

  // A clickable, highlightable row: difficulties, modifiers and menu items.
  component Choice: Rectangle {
    id: choice
    property bool selected: false
    property color tone: root.accent
    property real fillOpacity: 0.16
    property real borderOpacity: 1
    signal activated()
    signal hovered()
    radius: root.cornerRadius
    color: selected ? root.alpha(tone, fillOpacity) : "transparent"
    border.width: 1
    border.color: selected ? root.alpha(tone, borderOpacity) : root.hairline

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: choice.hovered()
      onClicked: {
        choice.activated()
        keyCatcher.forceActiveFocus()
      }
    }
  }

  component MenuRow: Choice {
    id: menuRow
    property string label: ""
    property string keyHint: ""
    height: 36

    PlainText {
      anchors.left: parent.left
      anchors.leftMargin: 12
      anchors.right: hintLabel.left
      anchors.rightMargin: 8
      anchors.verticalCenter: parent.verticalCenter
      elide: Text.ElideRight
      text: menuRow.label
      color: menuRow.selected ? root.foreground : root.muted
      font.pixelSize: 13
      font.weight: menuRow.selected ? Font.DemiBold : Font.Normal
    }
    PlainText {
      id: hintLabel
      anchors.right: parent.right
      anchors.rightMargin: 12
      anchors.verticalCenter: parent.verticalCenter
      text: menuRow.keyHint
      color: menuRow.selected ? root.accent : root.muted
      font.pixelSize: 11
      font.weight: Font.DemiBold
    }
  }

  // A column of menu rows driven by an items list ({ action, label, key }).
  component MenuList: Column {
    id: menuList
    property var items: []
    property int currentIndex: 0
    signal highlighted(int index)
    spacing: 10

    Repeater {
      model: menuList.items
      delegate: MenuRow {
        required property var modelData
        required property int index
        anchors.horizontalCenter: parent.horizontalCenter
        width: Math.min(menuList.width, 230)
        label: strings.t(modelData.label)
        keyHint: modelData.key
        selected: index === menuList.currentIndex
        onHovered: menuList.highlighted(index)
        onActivated: root.menuAction(modelData.action)
      }
    }
  }
}
