import SwiftUI
import WidgetKit

private let mindwtrFocusLockWidgetKind = "MindwtrFocusLockWidget"

// Lock screen (accessory family) widget showing the current focused task (#821).
// Reuses MindwtrTasksWidgetProvider: accessory families fall through to the
// default payload key, whose items mirror the app's Today's Focus list.
// Accessory families are iOS 16+; on iOS 15 the widget offers no families.
struct MindwtrFocusLockWidget: Widget {
    let kind: String = mindwtrFocusLockWidgetKind

    private var families: [WidgetFamily] {
        if #available(iOSApplicationExtension 16.0, *) {
            return [.accessoryRectangular, .accessoryInline, .accessoryCircular]
        }
        return []
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MindwtrTasksWidgetProvider()) { entry in
            MindwtrFocusLockWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Focus")
        .description("Current focused task")
        .supportedFamilies(families)
    }
}

private struct MindwtrFocusLockWidgetEntryView: View {
    let entry: MindwtrTasksWidgetEntry

    var body: some View {
        if #available(iOSApplicationExtension 16.0, *) {
            MindwtrFocusLockView(entry: entry)
        } else {
            EmptyView()
        }
    }
}

// Lock screen widgets render in the system's monochrome/vibrant style, so the
// theme palette deliberately does not apply here.
@available(iOSApplicationExtension 16.0, *)
private struct MindwtrFocusLockView: View {
    let entry: MindwtrTasksWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily

    private var focusedTitle: String? {
        entry.payload.items.first?.title
    }

    var body: some View {
        content
            .widgetURL(URL(string: entry.payload.focusUri) ?? URL(fileURLWithPath: "/"))
            .mindwtrLockWidgetBackground()
    }

    @ViewBuilder
    private var content: some View {
        switch widgetFamily {
        case .accessoryInline:
            Text(focusedTitle ?? entry.payload.emptyMessage)

        case .accessoryCircular:
            // The star counts starred (Today's Focus) tasks, not the truncated
            // display list — items.count is capped by the payload's maxItems.
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text("\(entry.payload.focusedCount ?? entry.payload.items.count)")
                        .font(.system(size: 16, weight: .bold))
                }
            }

        default:
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.payload.headerTitle)
                    .font(.system(size: 12, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                Text(focusedTitle ?? entry.payload.emptyMessage)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

private extension View {
    @ViewBuilder
    func mindwtrLockWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}
