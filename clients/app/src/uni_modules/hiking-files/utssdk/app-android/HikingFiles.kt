package earth.hiking.files
import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
object HikingFiles {
    fun copyMapArchive(context: Context, uri: Uri): String {
        val root = context.cacheDir.canonicalFile
        val file = java.io.File(root, "he-map-import-${java.util.UUID.randomUUID()}.zip").canonicalFile
        require(file.parentFile == root)
        var total = 0L
        try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                java.io.FileOutputStream(file).use { output ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        total += count
                        require(total <= 192L * 1024 * 1024) { "压缩包超过192 MiB" }
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            } ?: throw IllegalArgumentException("无法读取压缩包")
            require(total >= 22L && file.length() == total)
        } catch (error: Exception) { file.delete(); throw error }
        return file.toURI().toString()
    }

    fun removeMapArchive(context: Context, path: String): Boolean {
        return try {
            val root = context.cacheDir.canonicalFile
            val file = java.io.File(java.net.URI(path)).canonicalFile
            file.parentFile == root && file.name.startsWith("he-map-import-") && file.name.endsWith(".zip") && (!file.exists() || file.delete())
        } catch (_: Exception) { false }
    }

    fun verifyApk(context: Context, path: String, expectedHash: String, expectedSize: Long): Boolean {
        val file = java.io.File(path).canonicalFile
        val roots = listOfNotNull(java.io.File(context.applicationInfo.dataDir), context.getExternalFilesDir(null), context.externalCacheDir)
        require(roots.any { file.path.startsWith(it.canonicalPath + java.io.File.separator) })
        require(file.isFile && expectedSize in 1..(200L * 1024 * 1024) && file.length() == expectedSize)
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        java.io.FileInputStream(file).use { input ->
            val buffer = ByteArray(65536)
            while (true) { val size = input.read(buffer); if (size < 0) break; digest.update(buffer, 0, size) }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == expectedHash
    }

    fun write(context: Context, uri: Uri, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        if (bytes.size > 25 * 1024 * 1024) throw IllegalArgumentException("文件超过25 MB")
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes); it.flush() } ?: throw IllegalArgumentException("文件不能写入")
    }
    fun read(context: Context, uri: Uri): String {
        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer); if (count < 0) break
                if (output.size() + count > 5 * 1024 * 1024) throw IllegalArgumentException("文件超过5 MB")
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: throw IllegalArgumentException("无法打开选中的文件")
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    }
}
