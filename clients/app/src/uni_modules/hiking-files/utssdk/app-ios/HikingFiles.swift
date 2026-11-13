import Foundation
import UIKit
public class HikingFiles: NSObject, UIDocumentPickerDelegate {
    private static let shared = HikingFiles()
    private var success: ((String) -> Void)?
    private var binarySuccess: ((String) -> Void)?
    private var cancel: (() -> Void)?
    private var exportSuccess: (() -> Void)?
    private var exportURL: URL?
    private var failed: ((String) -> Void)?
    private func topPresenter() -> UIViewController? {
        let window: UIWindow?
        if #available(iOS 13.0, *) {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let activeScenes = scenes.filter { $0.activationState == .foregroundActive }
            let inactiveScenes = scenes.filter { $0.activationState == .foregroundInactive }
            window = (activeScenes + inactiveScenes).flatMap { $0.windows }.first { $0.isKeyWindow }
        } else {
            window = UIApplication.shared.keyWindow
        }
        guard var controller = window?.rootViewController else { return nil }
        while let presented = controller.presentedViewController { controller = presented }
        return controller
    }
    public static func choose(_ success: @escaping (String) -> Void, _ cancel: @escaping () -> Void, _ failed: @escaping (String) -> Void) {
        guard shared.success == nil && shared.binarySuccess == nil && shared.exportSuccess == nil else { failed("请先完成当前文件选择"); return }
        guard let controller = shared.topPresenter() else { failed("当前页面不能选择文件"); return }
        shared.success = success; shared.cancel = cancel; shared.failed = failed
        let picker = UIDocumentPickerViewController(documentTypes: ["public.item"], in: .import)
        picker.delegate = shared; picker.allowsMultipleSelection = false
        controller.present(picker, animated: true)
    }
    public static func chooseBinary(_ success: @escaping (String) -> Void, _ cancel: @escaping () -> Void, _ failed: @escaping (String) -> Void) {
        guard shared.success == nil && shared.binarySuccess == nil && shared.exportSuccess == nil else { failed("请先完成当前文件选择"); return }
        guard let controller = shared.topPresenter() else { failed("当前页面不能选择文件"); return }
        shared.binarySuccess = success; shared.cancel = cancel; shared.failed = failed
        let picker = UIDocumentPickerViewController(documentTypes: ["public.zip-archive", "com.pkware.zip-archive"], in: .import)
        picker.delegate = shared; picker.allowsMultipleSelection = false
        controller.present(picker, animated: true)
    }
    public static func removeBinary(_ path: String) -> Bool {
        guard let url = URL(string: path), url.isFileURL else { return false }
        let cache = FileManager.default.temporaryDirectory.standardizedFileURL.resolvingSymlinksInPath()
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        guard file.deletingLastPathComponent() == cache, file.lastPathComponent.hasPrefix("he-map-import-"), file.pathExtension == "zip" else { return false }
        do { if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }; return true }
        catch { return false }
    }
    public static func save(_ name: String, _ text: String, _ mimeType: String, _ success: @escaping () -> Void, _ cancel: @escaping () -> Void, _ failed: @escaping (String) -> Void) {
        guard shared.success == nil && shared.binarySuccess == nil && shared.exportSuccess == nil else { failed("请先完成当前文件选择"); return }
        guard let bytes = text.data(using: .utf8), bytes.count <= 25 * 1024 * 1024 else { failed("文件超过25 MB"); return }
        let safe = name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)).joined().prefix(80)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(safe.isEmpty ? "徒步轨迹.gpx" : String(safe))
            try bytes.write(to: url, options: .atomic)
            guard let presenter = shared.topPresenter() else { try? FileManager.default.removeItem(at: directory); failed("当前页面不能保存文件"); return }
            shared.exportURL = directory; shared.exportSuccess = success; shared.cancel = cancel; shared.failed = failed
            let picker = UIDocumentPickerViewController(urls: [url], in: .exportToService)
            picker.delegate = shared; presenter.present(picker, animated: true)
        } catch { try? FileManager.default.removeItem(at: directory); failed("无法创建导出文件") }
    }
    private func clear() {
        if let directory = exportURL { try? FileManager.default.removeItem(at: directory) }
        success = nil; binarySuccess = nil; cancel = nil; failed = nil; exportSuccess = nil; exportURL = nil
    }
    private func copyBoundedMapArchive(from source: URL, to destination: URL) throws -> Int {
        let input = try FileHandle(forReadingFrom: source)
        defer { input.closeFile() }
        let output = try FileHandle(forWritingTo: destination)
        defer { output.closeFile() }
        let limit = 192 * 1024 * 1024
        var total = 0
        while true {
            let chunk = input.readData(ofLength: 1024 * 1024)
            if chunk.isEmpty { break }
            total += chunk.count
            guard total <= limit else { throw NSError(domain: "HikingFiles", code: 1) }
            output.write(chunk)
        }
        guard total >= 22 else { throw NSError(domain: "HikingFiles", code: 2) }
        output.synchronizeFile()
        return total
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { cancel?(); clear() }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        defer { clear() }
        if let completed = exportSuccess { completed(); return }
        guard let url = urls.first else { failed?("没有选中文件"); return }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let completed = binarySuccess {
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("he-map-import-\(UUID().uuidString).zip")
            guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
                failed?("无法创建地图压缩包临时文件，请检查本机空间")
                return
            }
            do {
                _ = try shared.copyBoundedMapArchive(from: url, to: destination)
                completed(destination.absoluteString)
            } catch {
                try? FileManager.default.removeItem(at: destination)
                failed?("压缩包无效、超过192 MiB或复制失败；请检查文件和本机空间")
            }
            return
        }
        do {
            let handle = try FileHandle(forReadingFrom: url); defer { handle.closeFile() }
            let bytes = handle.readData(ofLength: 5 * 1024 * 1024 + 1)
            guard bytes.count <= 5 * 1024 * 1024 else { failed?("文件超过5 MB"); return }
            guard let text = String(data: bytes, encoding: .utf8) else { failed?("文件需要UTF-8编码"); return }
            success?(text)
        } catch { failed?("文件读取失败，请重新选择") }
    }
}
