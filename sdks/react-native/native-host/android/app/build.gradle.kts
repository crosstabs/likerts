plugins { id("com.android.application"); kotlin("android") }
android {
    namespace = "com.likerts.rnhost"
    compileSdk = 36
    defaultConfig { applicationId = "com.likerts.rnhost"; minSdk = 24; targetSdk = 35; versionCode = 1; versionName = "1.0"; ndk { abiFilters += "arm64-v8a" } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { pickFirsts += "**/libc++_shared.so" } }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation("com.facebook.react:react-android:0.86.3")
    implementation("com.facebook.hermes:hermes-android:0.17.0")
}
