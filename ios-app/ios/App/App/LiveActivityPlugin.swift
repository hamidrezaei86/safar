// Capacitor plugin: the web app calls start / update / end while Go navigation is running,
// and iOS shows the next stop on the lock screen and in the Dynamic Island.
import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "SafarLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    @objc func available(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) { call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled]); return }
        #endif
        call.resolve(["available": false])
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private func state(_ call: CAPPluginCall) -> SafarActivityAttributes.ContentState {
        let arriveMs = call.getDouble("arrive") ?? (Date().timeIntervalSince1970 * 1000 + 600_000)
        return SafarActivityAttributes.ContentState(
            stop: call.getString("stop") ?? "Next stop", emoji: call.getString("emoji") ?? "📍",
            instruction: call.getString("instruction") ?? "", arrow: call.getString("arrow") ?? "↑",
            distance: call.getString("distance") ?? "", arrive: Date(timeIntervalSince1970: arriveMs / 1000),
            planned: call.getString("planned") ?? "", mode: call.getString("mode") ?? "walking",
            stopsLeft: call.getInt("stopsLeft") ?? 0, late: call.getBool("late") ?? false)
    }
    @available(iOS 16.2, *)
    private var current: Activity<SafarActivityAttributes>? { Activity<SafarActivityAttributes>.activities.first }
    #endif

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["started": false, "reason": "Live Activities are off for Safar in Settings"]); return }
            let st = state(call)
            Task {
                for a in Activity<SafarActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
                do {
                    let attrs = SafarActivityAttributes(day: call.getString("day") ?? "", city: call.getString("city") ?? "")
                    _ = try Activity.request(attributes: attrs, content: .init(state: st, staleDate: st.arrive.addingTimeInterval(1800)))
                    call.resolve(["started": true])
                } catch { call.resolve(["started": false, "reason": error.localizedDescription]) }
            }
            return
        }
        #endif
        call.resolve(["started": false, "reason": "Needs iOS 16.2 or later"])
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let a = current else { start(call); return }
            let st = state(call)
            Task { await a.update(.init(state: st, staleDate: st.arrive.addingTimeInterval(1800))); call.resolve(["updated": true]) }
            return
        }
        #endif
        call.resolve(["updated": false])
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task { for a in Activity<SafarActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }; call.resolve(["ended": true]) }
            return
        }
        #endif
        call.resolve(["ended": false])
    }
}
