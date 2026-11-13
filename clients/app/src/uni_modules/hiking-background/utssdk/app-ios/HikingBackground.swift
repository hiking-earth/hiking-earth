import Foundation
import CoreLocation
import CoreFoundation
public class HikingBackground: NSObject, CLLocationManagerDelegate {
    private static let shared = HikingBackground()
    private let manager = CLLocationManager()
    private var accepting = false
    private var changed: (() -> Void)?
    private var failed: ((String) -> Void)?
    private var activeOwner = ""
    private var activeSession = ""
    private let legacyKey = "hiking_background_buffer"
    override init() { super.init(); manager.delegate = self }
    private func bufferKey(_ owner: String) -> String {
        return "hiking_background_buffer:" + owner.utf8.map { String(format: "%02x", $0) }.joined()
    }
    private func emptyBuffer(_ owner: String) -> [String: Any] { return ["owner": owner, "session": "", "points": []] }
    private func data(_ owner: String, _ legacySession: String = "") -> [String: Any] {
        let key = bufferKey(owner)
        if let bytes = UserDefaults.standard.data(forKey: key), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { return value }
        if !legacySession.isEmpty, let bytes = UserDefaults.standard.data(forKey: legacyKey), var value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
           (value["session"] as? String) == legacySession, !((value["points"] as? [[String: Any]]) ?? []).isEmpty {
            value["owner"] = owner
            if store(value, owner) { UserDefaults.standard.removeObject(forKey: legacyKey); return value }
        }
        return emptyBuffer(owner)
    }
    private func store(_ value: [String: Any], _ owner: String) -> Bool {
        guard let bytes = try? JSONSerialization.data(withJSONObject: value) else { return false }
        UserDefaults.standard.set(bytes, forKey: bufferKey(owner)); return true
    }
    private func serializedBuffer(_ owner: String, _ legacySession: String) -> String {
        if let bytes = UserDefaults.standard.data(forKey: bufferKey(owner)) {
            guard let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  let encoded = try? JSONSerialization.data(withJSONObject: value),
                  let text = String(data: encoded, encoding: .utf8) else {
                let invalid: [String: Any] = ["owner": owner, "session": "", "points": [], "invalid": true]
                guard let encoded = try? JSONSerialization.data(withJSONObject: invalid),
                      let text = String(data: encoded, encoding: .utf8) else { return "{}" }
                return text
            }
            return text
        }
        guard let bytes = try? JSONSerialization.data(withJSONObject: data(owner, legacySession)),
              let text = String(data: bytes, encoding: .utf8) else { return "{}" }
        return text
    }
    private func validBufferedPoint(_ point: [String: Any]) -> Bool {
        func number(_ key: String, minimum: Double? = nil, maximum: Double? = nil) -> Double? {
            guard let value = point[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
            let result = value.doubleValue
            guard result.isFinite else { return nil }
            if let minimum, result < minimum { return nil }
            if let maximum, result > maximum { return nil }
            return result
        }
        return number("latitude", minimum: -90, maximum: 90) != nil
            && number("longitude", minimum: -180, maximum: 180) != nil
            && number("timestamp", minimum: 0.000001) != nil
            && (point["altitude"] == nil || number("altitude") != nil)
            && (point["speed"] == nil || number("speed", minimum: 0) != nil)
            && (point["accuracy"] == nil || number("accuracy", minimum: 0) != nil)
    }
    public static func start(_ owner: String, _ session: String, _ changed: @escaping () -> Void, _ error: @escaping (String) -> Void) -> Bool {
        let selfRef = shared
        guard !owner.isEmpty && owner.utf8.count <= 128 && !session.isEmpty else { error("后台轨迹账号或会话无效"); return false }
        guard CLLocationManager.locationServicesEnabled() else { error("系统定位已关闭"); return false }
        let status = CLLocationManager.authorizationStatus()
        guard status == .authorizedAlways else {
            if status == .authorizedWhenInUse || status == .notDetermined { selfRef.manager.requestAlwaysAuthorization() }
            error("请在系统设置中允许始终定位，再重新开始后台记录"); return false
        }
        let key = selfRef.bufferKey(owner)
        if UserDefaults.standard.object(forKey: key) != nil {
            guard let bytes = UserDefaults.standard.data(forKey: key),
                  let stored = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  (stored["owner"] as? String) == owner,
                  let storedSession = stored["session"] as? String,
                  let storedPoints = stored["points"] as? [Any],
                  storedPoints.allSatisfy({ item in guard let point = item as? [String: Any] else { return false }; return selfRef.validBufferedPoint(point) }) else {
                error("后台轨迹缓存格式异常，原始缓存已保留"); return false
            }
            if storedSession != session && !storedPoints.isEmpty { error("还有未恢复的后台轨迹，请先恢复草稿"); return false }
        }
        let old = selfRef.data(owner, session)
        guard (old["owner"] as? String) == owner,
              let oldSession = old["session"] as? String,
              let oldPoints = old["points"] as? [[String: Any]], oldPoints.allSatisfy(selfRef.validBufferedPoint) else {
            error("后台轨迹缓存格式异常，原始缓存已保留"); return false
        }
        if oldSession != session {
            if !oldPoints.isEmpty { error("还有未恢复的后台轨迹，请先恢复草稿"); return false }
            guard selfRef.store(["owner": owner, "session": session, "points": []], owner) else { error("无法创建后台轨迹缓存"); return false }
        }
        selfRef.changed = changed; selfRef.failed = error
        selfRef.activeOwner = owner; selfRef.activeSession = session
        selfRef.manager.desiredAccuracy = kCLLocationAccuracyBest
        selfRef.manager.distanceFilter = 2
        selfRef.manager.activityType = .fitness
        selfRef.manager.pausesLocationUpdatesAutomatically = false
        selfRef.manager.allowsBackgroundLocationUpdates = true
        selfRef.manager.showsBackgroundLocationIndicator = true
        selfRef.accepting = true
        selfRef.manager.startUpdatingLocation(); return true
    }
    public static func stop() {
        shared.accepting = false
        shared.manager.stopUpdatingLocation(); shared.manager.allowsBackgroundLocationUpdates = false
        shared.changed = nil; shared.failed = nil; shared.activeOwner = ""; shared.activeSession = ""
    }
    public static func buffer(_ owner: String, _ legacySession: String) -> String {
        return shared.serializedBuffer(owner, legacySession)
    }
    public static func ack(_ owner: String, _ timestamp: NSNumber) -> Bool {
        guard timestamp.doubleValue.isFinite && timestamp.doubleValue > 0 else { return false }
        var value: [String: Any]
        if let bytes = UserDefaults.standard.data(forKey: shared.bufferKey(owner)) {
            guard let stored = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  (stored["owner"] as? String) == owner, stored["points"] is [Any] else { return false }
            value = stored
        } else { value = shared.data(owner) }
        guard (value["owner"] as? String) == owner else { return false }
        guard let rawPoints = value["points"] as? [Any], rawPoints.allSatisfy({ item in
            guard let point = item as? [String: Any] else { return false }
            return shared.validBufferedPoint(point)
        }) else { return false }
        let points = rawPoints.compactMap { $0 as? [String: Any] }.filter { (($0["timestamp"] as? NSNumber)?.doubleValue ?? 0) > timestamp.doubleValue }
        value["points"] = points; return shared.store(value, owner)
    }
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard accepting && !activeOwner.isEmpty && !activeSession.isEmpty else { return }
        let owner = activeOwner; let session = activeSession
        var value = data(owner, session)
        guard (value["owner"] as? String) == owner && (value["session"] as? String) == session,
              let rawPoints = value["points"] as? [Any],
              rawPoints.allSatisfy({ item in guard let point = item as? [String: Any] else { return false }; return validBufferedPoint(point) }) else {
            let callback = failed
            HikingBackground.stop()
            callback?("后台轨迹缓存格式异常，记录已停止并保留原始缓存")
            return
        }
        var points = rawPoints.compactMap { $0 as? [String: Any] }
        for location in locations where location.horizontalAccuracy >= 0 {
            if points.count >= 10000 {
                value["points"] = points
                let saved = store(value, owner)
                let callback = failed
                HikingBackground.stop()
                callback?(saved ? "后台缓存已满，记录已停止，请返回应用保存轨迹" : "后台轨迹缓存失败，记录已停止")
                return
            }
            var point: [String: Any] = ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude, "timestamp": location.timestamp.timeIntervalSince1970 * 1000, "accuracy": location.horizontalAccuracy]
            if location.verticalAccuracy >= 0 { point["altitude"] = location.altitude }
            if location.speed >= 0 { point["speed"] = location.speed }
            points.append(point)
        }
        value["points"] = points
        guard store(value, owner) else { let callback = failed; HikingBackground.stop(); callback?("后台轨迹缓存失败，记录已停止"); return }
        changed?()
    }
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard accepting else { return }
        if (error as NSError).code == CLError.denied.rawValue { let callback = failed; HikingBackground.stop(); callback?("系统定位权限已撤回") }
    }
}
