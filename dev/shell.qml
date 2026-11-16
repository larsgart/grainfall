import QtQuick
import Quickshell

ShellRoot {
  Grainfall {
    id: game
    shell: QtObject {
      function hide(pluginId) { Qt.quit() }
    }
    Component.onCompleted: {
      game.open("{}")
      if (Quickshell.env("GRAINFALL_DEV_AUTOSTART") === "1") game.startGame()
    }
  }

  // GRAINFALL_DEV_CHAOS=1: every next piece is an element and a flip comes early.
  // GRAINFALL_DEV_RISE_MS=<ms>: turn Rising on, as if that much time had passed.
  Timer {
    property int n: 0
    interval: 400
    repeat: true
    running: Quickshell.env("GRAINFALL_DEV_CHAOS") === "1"
    onTriggered: {
      if (!game.game) return
      if (n === 0) game.game.flipIn = Number(Quickshell.env("GRAINFALL_DEV_FLIP_MS") || 9000)
      if (n === 0 && Quickshell.env("GRAINFALL_DEV_RISE_MS")) {
        game.game.rising = true
        game.gameRising = true
        game.game.riseMs = Number(Quickshell.env("GRAINFALL_DEV_RISE_MS"))
      }
      var order = ["seed", "water", "fire", "acid", "sand", "seed"]
      if (game.game.next && game.game.next.material === "sand") {
        game.game.next.material = order[n % order.length]
        game.shownNext = null
      }
      n++
    }
  }
}
