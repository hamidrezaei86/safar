// Safar's web view controller: registers Safar's own native plugins with Capacitor.
import UIKit
import Capacitor

class SafarViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
