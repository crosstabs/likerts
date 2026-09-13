plugins {
    `maven-publish`
    signing
    id("org.jetbrains.dokka") version "2.2.0"
    id("com.android.library") version "8.9.2"
    id("com.android.application") version "8.9.2" apply false
    kotlin("android") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    kotlin("plugin.compose") version "2.1.20"
}

android {
    namespace = "com.likerts.sdk"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true }
    publishing { singleVariant("release") { withSourcesJar() } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }

val documentationJar by tasks.registering(Jar::class) {
    dependsOn("dokkaGeneratePublicationHtml")
    archiveClassifier.set("javadoc")
    from(layout.buildDirectory.dir("dokka/html"))
    from(rootProject.file("../../LICENSE")) { into("META-INF") }
}

val centralStaging = providers.gradleProperty("likertsCentralStaging").orNull == "true"
if (centralStaging) {
    require(providers.environmentVariable("LIKERTS_MAVEN_SIGNING_KEY").isPresent) {
        "Central staging requires LIKERTS_MAVEN_SIGNING_KEY from your secret manager"
    }
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                groupId = "com.likerts"
                artifactId = "likerts-android"
                version = "0.0.3"
                artifact(documentationJar)
                pom {
                    name.set("Likerts Android SDK")
                    description.set("Typed embedded survey collection and Jetpack Compose controls for Android applications.")
                    url.set("https://likerts.com")
                    licenses { license { name.set("MIT License"); url.set("https://opensource.org/license/mit/") } }
                    developers { developer { id.set("crosstabs"); name.set("Likerts contributors"); url.set("https://github.com/crosstabs/likerts/graphs/contributors") } }
                    scm {
                        url.set("https://github.com/crosstabs/likerts")
                        connection.set("scm:git:https://github.com/crosstabs/likerts.git")
                        developerConnection.set("scm:git:ssh://git@github.com/crosstabs/likerts.git")
                    }
                }
            }
        }
        repositories {
            maven {
                name = "localRelease"
                url = uri(providers.gradleProperty("likertsReleaseRepository")
                    .getOrElse(layout.buildDirectory.dir("local-release").get().asFile.absolutePath))
            }
        }
    }
    if (centralStaging) {
        signing {
            useInMemoryPgpKeys(
                providers.environmentVariable("LIKERTS_MAVEN_SIGNING_KEY").get(),
                providers.environmentVariable("LIKERTS_MAVEN_SIGNING_PASSWORD").orNull
            )
            sign(publishing.publications["release"])
        }
    }
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    api(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.compose.material3:material3")
    api("androidx.compose.ui:ui")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
