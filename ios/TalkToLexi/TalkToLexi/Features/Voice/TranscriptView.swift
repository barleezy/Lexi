import SwiftUI

struct TranscriptView: View {
    var rows: [TranscriptRow]

    var body: some View {
        if rows.count > 1 {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(rows.suffix(6)) { row in
                        Text(row.role == "user" ? "You: \(row.text)" : row.text)
                            .font(.system(size: 13))
                            .foregroundStyle(row.role == "user" ? LexiTheme.muted : Color.white.opacity(0.86))
                            .frame(maxWidth: .infinity, alignment: row.role == "user" ? .trailing : .leading)
                    }
                }
            }
            .frame(maxHeight: 96)
        }
    }
}
