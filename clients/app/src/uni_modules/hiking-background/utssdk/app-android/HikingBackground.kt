package earth.hiking.background
import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import org.json.JSONArray
import org.json.JSONObject

object HikingBackground {
    var changed: (() -> Unit)? = null
    var error: ((String) -> Unit)? = null
    @Volatile private var activeOwner: String? = null
    @Volatile private var activeSession: String? = null
    private fun prefs(context: Context) = context.getSharedPreferences("hiking_background", Context.MODE_PRIVATE)
    private fun bufferKey(owner: String) = "buffer:" + owner.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    private fun emptyBuffer(owner: String) = JSONObject().put("owner", owner).put("session", "").put("points", JSONArray()).toString()
    private fun validBufferedPoint(point: JSONObject): Boolean {
        fun number(key: String, min: Double? = null, max: Double? = null): Double? {
            val raw = point.opt(key) as? Number ?: return null
            val value = raw.toDouble()
            if (!value.isFinite() || (min != null && value < min) || (max != null && value > max)) return null
            return value
        }
        return number("latitude", -90.0, 90.0) != null && number("longitude", -180.0, 180.0) != null
            && number("timestamp", 0.000001) != null
            && (!point.has("altitude") || number("altitude") != null)
            && (!point.has("speed") || number("speed", 0.0) != null)
            && (!point.has("accuracy") || number("accuracy", 0.0) != null)
    }
    @Synchronized fun buffer(context: Context, owner: String, legacySession: String = ""): String {
        val store = prefs(context); val key = bufferKey(owner)
        store.getString(key, null)?.let { return it }
        val legacy = store.getString("buffer", null)
        if (!legacySession.isEmpty() && legacy != null) {
            try {
                val data = JSONObject(legacy); val points = data.optJSONArray("points") ?: JSONArray()
                if (data.optString("session") == legacySession && points.length() > 0) {
                    data.put("owner", owner)
                    if (store.edit().putString(key, data.toString()).remove("buffer").commit()) return data.toString()
                }
            } catch (_: Exception) {}
        }
        return emptyBuffer(owner)
    }
    @Synchronized fun start(context: Context, owner: String, session: String, changed: () -> Unit, error: (String) -> Unit): Boolean {
        if (owner.isEmpty() || owner.length > 128 || session.isEmpty()) { error("后台轨迹账号或会话无效"); return false }
        if (Build.VERSION.SDK_INT >= 23 && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            error("后台轨迹需要精确定位权限，请先在系统设置中授权"); return false
        }
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (context is Activity) context.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7352)
            error("请允许持续通知后重新开启后台记录"); return false
        }
        val old = try { JSONObject(buffer(context, owner, session)) } catch (_: Exception) { error("后台轨迹缓存格式异常，原始缓存已保留"); return false }
        val oldPoints = old.optJSONArray("points")
        if (old.optString("owner") != owner || old.opt("session") !is String || oldPoints == null
            || (0 until oldPoints.length()).any { !validBufferedPoint(oldPoints.optJSONObject(it) ?: return@any true) }) {
            error("后台轨迹缓存格式异常，原始缓存已保留"); return false
        }
        if (old.optString("session") != session && oldPoints.length() > 0) {
            error("还有未恢复的后台轨迹，请先恢复草稿"); return false
        }
        if (old.optString("session") != session && !prefs(context).edit().putString(bufferKey(owner), JSONObject().put("owner", owner).put("session", session).put("points", JSONArray()).toString()).commit()) {
            error("无法创建后台轨迹缓存，记录未启动"); return false
        }
        activeOwner = owner; activeSession = session
        this.changed = changed; this.error = error
        try {
            val intent = Intent(context, HikingLocationService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            return true
        } catch (_: Exception) { activeOwner = null; activeSession = null; this.changed = null; this.error = null; error("系统未允许后台定位服务，请保持应用在前台"); return false }
    }
    fun stop(context: Context) { HikingLocationService.instance?.stopUpdates(); context.stopService(Intent(context, HikingLocationService::class.java)); activeOwner = null; activeSession = null; changed = null; error = null }
    @Synchronized fun append(context: Context, location: Location) {
        val owner = activeOwner ?: return; val session = activeSession ?: return
        val data = try { JSONObject(buffer(context, owner, session)) } catch (_: Exception) {
            error?.invoke("后台轨迹缓存格式异常，记录已停止并保留原始缓存"); stop(context); return
        }
        val points = data.optJSONArray("points")
        if (data.optString("owner") != owner || data.optString("session") != session || points == null
            || (0 until points.length()).any { !validBufferedPoint(points.optJSONObject(it) ?: return@any true) }) {
            error?.invoke("后台轨迹缓存格式异常，记录已停止并保留原始缓存"); stop(context); return
        }
        if (points.length() >= 10000) { error?.invoke("后台缓存已满，记录已停止，请返回应用保存轨迹"); stop(context); return }
        val point = JSONObject().put("latitude", location.latitude).put("longitude", location.longitude)
            .put("timestamp", location.time).put("accuracy", location.accuracy.toDouble())
        if (location.hasAltitude()) point.put("altitude", location.altitude)
        if (location.hasSpeed()) point.put("speed", location.speed.toDouble())
        points.put(point); data.put("points", points)
        if (!prefs(context).edit().putString(bufferKey(owner), data.toString()).commit()) { error?.invoke("后台轨迹缓存失败，记录已停止"); stop(context); return }
        changed?.invoke()
    }
    @Synchronized fun ack(context: Context, owner: String, timestamp: Number): Boolean {
        if (!timestamp.toDouble().isFinite() || timestamp.toDouble() <= 0) return false
        try {
        val data = JSONObject(buffer(context, owner)); if (data.optString("owner") != owner) return false
        if (data.opt("session") !is String) return false
        val all = data.optJSONArray("points") ?: return false
        for (i in 0 until all.length()) {
            val point = all.optJSONObject(i) ?: return false
            if (!validBufferedPoint(point)) return false
        }
        val remaining = JSONArray()
        for (i in 0 until all.length()) { val p = all.optJSONObject(i); if (p == null || !p.optDouble("timestamp").isFinite() || p.optDouble("timestamp") > timestamp.toDouble()) remaining.put(all.get(i)) }
        data.put("points", remaining); return prefs(context).edit().putString(bufferKey(owner), data.toString()).commit()
        } catch (_: Exception) { return false }
    }
}
class HikingLocationService : Service(), LocationListener {
    companion object { var instance: HikingLocationService? = null }
    private var manager: LocationManager? = null
    private var accepting = false
    override fun onCreate() { super.onCreate(); instance = this }
    fun stopUpdates() { accepting = false; manager?.removeUpdates(this) }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) notificationManager.createNotificationChannel(NotificationChannel("hiking_record", "徒步轨迹记录", NotificationManager.IMPORTANCE_LOW))
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            val notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "hiking_record") else Notification.Builder(this))
                .setContentTitle("徒步地球正在记录轨迹").setContentText("返回应用暂停或结束；轨迹保存在本机")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true)
            if (launch != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)))
            if (Build.VERSION.SDK_INT >= 29) startForeground(7351, notification.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(7351, notification.build())
            manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            accepting = true
            manager!!.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000L, 2f, this, Looper.getMainLooper())
        } catch (_: Exception) { HikingBackground.error?.invoke("后台GPS不可用，请检查系统定位权限"); stopSelf() }
        // Never restart recording silently after process termination.
        return START_NOT_STICKY
    }
    override fun onLocationChanged(location: Location) { if (accepting) HikingBackground.append(this, location) }
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) { HikingBackground.error?.invoke("系统GPS已关闭"); stopSelf() }
    @Deprecated("Legacy API") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onDestroy() { stopUpdates(); instance = null; super.onDestroy() }
}
