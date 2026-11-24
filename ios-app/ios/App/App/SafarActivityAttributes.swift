// Shared by the app and the SafarWidgets extension: what a navigation Live Activity shows.
import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct SafarActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var stop: String          // next stop's name
        public var emoji: String         // next stop's emoji
        public var instruction: String   // e.g. "Turn left onto Via Nazionale"
        public var arrow: String         // ↑ ← → ↖ ↗ …
        public var distance: String      // e.g. "650 m"
        public var arrive: Date          // estimated arrival time
        public var planned: String       // planned start, e.g. "10:30"
        public var mode: String          // walking, metro, bus, taxi, driving
        public var stopsLeft: Int
        public var late: Bool
    }
    public var day: String               // "Day 2 · Tue 3 Dec"
    public var city: String
}
#endif
