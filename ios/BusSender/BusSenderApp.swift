import SwiftUI

@main
struct BusSenderApp: App {
    @StateObject private var tracker = Tracker()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(tracker)
        }
    }
}
