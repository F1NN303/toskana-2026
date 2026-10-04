import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var tracker: Tracker
    @State private var tokenInput = ""
    @State private var messageInput = ""

    private let asphalt = Color(red: 0.14, green: 0.15, blue: 0.15)
    private let signYellow = Color(red: 0.95, green: 0.76, blue: 0.09)
    private let amber = Color(red: 1.0, green: 0.68, blue: 0.0)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Toskana-Fahrt 2026")
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)
                    Text("Bus-Sender")
                        .font(.system(size: 38, weight: .black))
                }

                if !tracker.hasToken {
                    tokenBox
                }

                Button {
                    tracker.running ? tracker.stop() : tracker.start()
                } label: {
                    Text(tracker.running ? "Tracking stoppen" : "Tracking starten")
                        .font(.title2.weight(.heavy))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(tracker.running ? .red : .green)
                .disabled(!tracker.hasToken)

                statusBox
                messageBox

                VStack(alignment: .leading, spacing: 6) {
                    Text("So läuft es zuverlässig").font(.headline)
                    Text("• Standort auf „Immer“ erlauben (Einstellungen › Bus-Sender › Standort).")
                    Text("• App nicht wegwischen. Sperren und andere Apps benutzen ist in Ordnung.")
                    Text("• Handy möglichst am Ladekabel lassen.")
                    Text("• Oben links in der Statusleiste erscheint ein blauer Standort-Hinweis, solange gesendet wird.")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)

                if tracker.hasToken {
                    Button("Schlüssel ändern") { tracker.saveToken("") }
                        .font(.footnote)
                }
            }
            .padding()
        }
        .background(asphalt.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear { messageInput = tracker.sentMessage }
    }

    private var tokenBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Einmalig: Schlüssel eintragen").font(.headline.weight(.heavy))
            Text("Der GitHub-Token erlaubt diesem Handy, den Standort zu speichern. Er bleibt nur auf diesem Gerät.")
                .font(.subheadline)
            SecureField("", text: $tokenInput, prompt: Text("github_pat_…").foregroundColor(.gray))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Color.white)
                .foregroundStyle(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            Button("Schlüssel speichern") {
                tracker.saveToken(tokenInput)
                tokenInput = ""
            }
            .buttonStyle(.borderedProminent)
            .tint(.black)
            .disabled(tokenInput.trimmingCharacters(in: .whitespaces).count < 20)
        }
        .foregroundStyle(Color.black)
        .padding(16)
        .background(signYellow)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.black, lineWidth: 3).padding(4))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var statusBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            row("Status", tracker.running ? "Läuft" : "Aus")
            row("Erlaubnis", tracker.authText)
            row("GPS", tracker.lastFix.map { "\(Tracker.clock.string(from: $0)) · ±\(Int(tracker.accuracy)) m" } ?? "–")
            row("Gesendet", tracker.lastSent.map { Tracker.clock.string(from: $0) } ?? "–")
            row("Anzahl", "\(tracker.sentCount)")
            if let error = tracker.lastError {
                Text(error)
                    .foregroundStyle(Color(red: 1, green: 0.55, blue: 0.48))
                    .font(.system(.footnote, design: .monospaced).weight(.bold))
            }
        }
        .font(.system(.subheadline, design: .monospaced))
        .foregroundStyle(amber)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black)
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.25), lineWidth: 6))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .lineLimit(1)
                .fixedSize()
                .frame(minWidth: 96, alignment: .leading)
            Text(value).bold()
        }
    }

    private var messageBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nachricht an alle").font(.headline.weight(.heavy))
            Text("Erscheint auf der Schülerseite als Leuchtanzeige, z. B. „Pause bis 03:30“.")
                .font(.subheadline)
            TextField("", text: $messageInput, prompt: Text("z. B. Pause bis 03:30").foregroundColor(.gray))
                .padding(10)
                .background(Color.white)
                .foregroundStyle(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            HStack {
                Button("Senden") { tracker.sendMessage(messageInput) }
                    .buttonStyle(.borderedProminent)
                    .tint(.black)
                    .disabled(messageInput.trimmingCharacters(in: .whitespaces).isEmpty || !tracker.hasToken)
                Button("Löschen") {
                    messageInput = ""
                    tracker.sendMessage("")
                }
                .buttonStyle(.bordered)
                .tint(.black)
                .disabled(!tracker.hasToken)
            }
            if let status = tracker.messageStatus {
                Text(status).font(.footnote.bold())
            }
        }
        .foregroundStyle(Color.black)
        .padding(16)
        .background(signYellow)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.black, lineWidth: 3).padding(4))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
