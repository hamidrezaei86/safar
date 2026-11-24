import WidgetKit
import SwiftUI

@main
struct SafarWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SafarNavLiveActivity()   // the extension needs iOS 16.2+
    }
}
