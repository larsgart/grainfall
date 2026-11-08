import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root

  moduleName: "lars.grainfall"

  readonly property bool gameOpen: bar && bar.shell && typeof bar.shell.isPluginOpen === "function"
    ? bar.shell.isPluginOpen(moduleName) === true
    : false

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    active: root.gameOpen
    tooltipText: "Grainfall"

    // A grain falling onto a small sand pile, on a 5×5 grid.
    iconComponent: Component {
      Item {
        id: icon
        readonly property real cell: width / 5
        Repeater {
          model: [
            [2, 0],
            [2, 2],
            [1, 3], [2, 3], [3, 3],
            [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]
          ]
          delegate: Rectangle {
            required property var modelData
            x: modelData[0] * icon.cell
            y: modelData[1] * icon.cell
            width: icon.cell - 0.6
            height: icon.cell - 0.6
            radius: icon.cell * 0.2
            color: button.active ? button.activeColor : button.foreground
          }
        }
      }
    }

    onPressed: function(mouseButton) {
      if (mouseButton !== Qt.LeftButton || !root.bar || !root.bar.shell) return
      root.bar.shell.toggle(root.moduleName, "{}")
    }
  }
}
