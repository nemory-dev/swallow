import Foundation
import PDFKit
import AppKit
import Vision

struct Page: Codable { let text: String; let method: String }
enum PdfFailure: Error { case message(String) }
func image(_ page: PDFPage, longest: CGFloat) throws -> NSBitmapImageRep {
    let bounds = page.bounds(for: .cropBox)
    guard bounds.width > 0, bounds.height > 0, bounds.width.isFinite, bounds.height.isFinite else { throw PdfFailure.message("PDF 페이지 크기가 잘못되었습니다.") }
    // Crop bounds do not include page rotation, while PDFKit thumbnails do.
    let quarterTurn = ((page.rotation % 360) + 360) % 180 == 90
    let size = quarterTurn ? NSSize(width: bounds.height, height: bounds.width) : bounds.size
    let scale = min(longest / max(size.width, size.height), 4)
    let width = max(1, Int(size.width * scale)), height = max(1, Int(size.height * scale))
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw PdfFailure.message("PDF 페이지 이미지를 만들 수 없습니다.") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let cg = context.cgContext
    cg.setFillColor(NSColor.white.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // PDFKit's thumbnail applies crop and rotation, including scanned/rotated pages.
    page.thumbnail(of: NSSize(width: width, height: height), for: .cropBox).draw(in: NSRect(x: 0, y: 0, width: width, height: height))
    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}
func ocr(_ page: PDFPage) throws -> String {
    let bitmap = try image(page, longest: 1800)
    guard let cg = bitmap.cgImage else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let supported = try request.supportedRecognitionLanguages()
    request.recognitionLanguages = ["ko-KR", "en-US"].filter { supported.contains($0) }
    try VNImageRequestHandler(cgImage: cg).perform([request])
    return (request.results ?? []).sorted { a, b in
        if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.015 { return a.boundingBox.midY > b.boundingBox.midY }
        return a.boundingBox.minX < b.boundingBox.minX
    }.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
func run() throws {
    let args = CommandLine.arguments
    guard args.count >= 3, let document = PDFDocument(url: URL(fileURLWithPath: args[2])) else { throw PdfFailure.message("PDF가 손상되었거나 읽을 수 없습니다. 파일 권한과 형식을 확인하세요.") }
    guard !document.isEncrypted else { throw PdfFailure.message("암호화된 PDF는 지원하지 않습니다. 암호가 없는 사본을 선택하세요.") }
    guard document.pageCount > 0 && document.pageCount <= 300 else { throw PdfFailure.message("PDF는 1~300쪽까지 지원합니다. 파일을 나누어 가져오세요.") }
    if args[1] == "inspect" {
        var pages: [Page] = []
        var length = 0
        for index in 0..<document.pageCount {
            let result: Page = try autoreleasepool {
                guard let page = document.page(at: index) else { throw PdfFailure.message("PDF 페이지를 읽을 수 없습니다.") }
                let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { return Page(text: text, method: "text") }
                let recognized = try ocr(page)
                return Page(text: recognized, method: recognized.isEmpty ? "empty" : "ocr")
            }
            length += result.text.utf16.count + 100
            guard length <= 1_000_000 else { throw PdfFailure.message("PDF 추출 원문은 100만 자 이내여야 합니다. 파일을 나누어 가져오세요.") }
            pages.append(result)
        }
        FileHandle.standardOutput.write(try JSONEncoder().encode(pages))
    } else if args[1] == "render", args.count == 4, let number = Int(args[3]), number > 0, let page = document.page(at: number - 1) {
        let bitmap = try image(page, longest: 2400)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85]), data.count <= 6_000_000 else { throw PdfFailure.message("PDF 페이지 이미지가 너무 큽니다.") }
        FileHandle.standardOutput.write(try JSONEncoder().encode("data:image/jpeg;base64," + data.base64EncodedString()))
    } else { throw PdfFailure.message("PDF 처리 요청이 잘못되었습니다.") }
}
do { try run() } catch {
    let message: String
    if case PdfFailure.message(let reason) = error { message = reason } else { message = "PDF 텍스트/OCR 처리에 실패했습니다. 원본을 확인하고 다시 시도하세요." }
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
