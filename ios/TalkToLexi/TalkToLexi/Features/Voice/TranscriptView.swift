import SwiftUI

struct TranscriptView: View {
    var rows: [TranscriptRow]

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(rows) { row in
                Text(row.text)
                    .font(.system(size: 16))
                    .foregroundStyle(row.role == "user" ? Color.white.opacity(0.92) : Color.white.opacity(0.86))
                    .multilineTextAlignment(row.role == "user" ? .trailing : .leading)
                    .frame(maxWidth: .infinity, alignment: row.role == "user" ? .trailing : .leading)
                    .padding(.horizontal, 16)
                    .id(row.id)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
