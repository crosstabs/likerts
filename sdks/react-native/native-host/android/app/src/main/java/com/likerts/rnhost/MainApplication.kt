package com.likerts.rnhost
import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
class MainApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy { DefaultReactHost.getDefaultReactHost(this, listOf(MainReactPackage()), jsBundleAssetPath = "index.android.bundle.js", useDevSupport = false) }
    override fun onCreate() { super.onCreate(); SoLoader.init(this, OpenSourceMergedSoMapping); DefaultNewArchitectureEntryPoint.load() }
}
