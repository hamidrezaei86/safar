// The lock-screen banner and Dynamic Island shown while Safar's Go navigation runs.
import ActivityKit
import WidgetKit
import SwiftUI

private let teal = Color(red: 0.05, green: 0.47, blue: 0.43)
private let navy = Color(red: 0.05, green: 0.09, blue: 0.20)

@available(iOS 16.2, *)
struct SafarNavLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SafarActivityAttributes.self) { ctx in
            LockScreenView(a: ctx.attributes, s: ctx.state)
                .activityBackgroundTint(navy)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "safar://go"))
        } dynamicIsland: { ctx in
            let s = ctx.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(s.arrow).font(.system(size: 34, weight: .bold)).foregroundColor(teal).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(s.arrive, style: .time).font(.headline).foregroundColor(s.late ? .orange : .white)
                        Text("arrive").font(.caption2).foregroundColor(.secondary)
                    }.padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("\(s.emoji) \(s.stop)").font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(s.instruction.isEmpty ? s.mode.capitalized : s.instruction).font(.subheadline).lineLimit(2)
                        Spacer()
                        Text(s.distance).font(.subheadline.weight(.semibold)).foregroundColor(teal)
                    }
                }
            } compactLeading: {
                Text(s.arrow).font(.headline).foregroundColor(teal)
            } compactTrailing: {
                Text(timerInterval: Date()...max(s.arrive, Date().addingTimeInterval(1)), countsDown: true)
                    .monospacedDigit().frame(maxWidth: 52).font(.caption.weight(.semibold))
            } minimal: {
                Text(s.arrow).foregroundColor(teal)
            }
            .widgetURL(URL(string: "safar://go"))
            .keylineTint(teal)
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let a: SafarActivityAttributes
    let s: SafarActivityAttributes.ContentState
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Safar · \(a.day)").font(.caption.weight(.semibold)).foregroundColor(.white.opacity(0.7))
                Spacer()
                Text(s.stopsLeft == 1 ? "Last stop today" : "\(s.stopsLeft) stops left").font(.caption).foregroundColor(.white.opacity(0.7))
            }
            HStack(alignment: .center, spacing: 12) {
                Text(s.arrow).font(.system(size: 36, weight: .bold)).foregroundColor(teal)
                    .frame(width: 52, height: 52).background(Circle().fill(Color.white))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(s.emoji) \(s.stop)").font(.headline).foregroundColor(.white).lineLimit(1)
                    Text(s.instruction.isEmpty ? s.mode.capitalized : s.instruction).font(.subheadline).foregroundColor(.white.opacity(0.85)).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            HStack {
                Label(s.distance, systemImage: "location.fill").font(.caption.weight(.semibold)).foregroundColor(.white)
                Spacer()
                Text("Arrive ").font(.caption).foregroundColor(.white.opacity(0.7)) + Text(s.arrive, style: .time).font(.caption.weight(.semibold)).foregroundColor(s.late ? .orange : .white)
                if !s.planned.isEmpty { Text("· planned \(s.planned)").font(.caption).foregroundColor(.white.opacity(0.7)) }
            }
        }
        .padding(16)
    }
}
