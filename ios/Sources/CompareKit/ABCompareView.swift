#if canImport(UIKit)
import SwiftUI
import UIKit

public struct ABCompareView: View {
    private let left: UIImage
    private let right: UIImage
    @State private var split: CGFloat = 0.5

    public init(left: UIImage, right: UIImage) {
        self.left = left
        self.right = right
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                Image(uiImage: right).resizable().scaledToFit()
                Image(uiImage: left)
                    .resizable()
                    .scaledToFit()
                    .mask(Rectangle().frame(width: geometry.size.width * split))
            }
            .gesture(
                DragGesture().onChanged { value in
                    let width = geometry.size.width
                    guard width > 0 else { return }
                    split = min(max(0, value.location.x / width), 1)
                }
            )
        }
    }
}
#else
import SwiftUI

@available(macOS 10.15, iOS 15.0, *)
public struct ABCompareView: View {
    public init(left: Any, right: Any) {}

    public var body: some View {
        Text("AB comparison available on iOS builds")
            .font(.footnote)
            .foregroundColor(.secondary)
    }
}
#endif
