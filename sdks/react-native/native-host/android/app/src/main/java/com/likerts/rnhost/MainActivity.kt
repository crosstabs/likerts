package com.likerts.rnhost
import android.os.Bundle
import java.io.File
import org.json.JSONObject
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate
class MainActivity : ReactActivity() {
    private fun hostedFile() = File(filesDir, "likerts-hosted.json")
    override fun getMainComponentName() = "LikertsNativeAcceptance"
    override fun createReactActivityDelegate(): ReactActivityDelegate = object : DefaultReactActivityDelegate(this, mainComponentName, true) {
        override fun getLaunchOptions(): Bundle? {
            if (!hostedFile().isFile) return null
            return try {
                val config = JSONObject(hostedFile().readText())
                Bundle().apply {
                    for (key in listOf("target", "sdkVersion", "baseUrl", "collectionId", "collectionToken", "idempotencyKey")) putString(key, config.getString(key))
                    putBoolean("disposable", config.getBoolean("disposable"))
                    putInt("responseCap", config.getInt("responseCap"))
                }
            } catch (_: Throwable) { Bundle() }
        }
    }
}
