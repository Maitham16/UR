import org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "dev.urnexus"
version = "1.47.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

configurations.named("runtimeClasspath") {
    // IntelliJ provides these at runtime. Scoping the exclusions here keeps
    // them out of the distributable without breaking Gradle's compiler tools.
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-common")
    exclude(group = "org.jetbrains", module = "annotations")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    intellijPlatform {
        intellijIdeaCommunity("2024.3.7.1")
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("243")
        }
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        // IntelliJ's Java interfaces provide JVM default methods. Kotlin's
        // compatibility mode would otherwise emit synthetic overrides for
        // platform-internal methods and make the verifier reject the plugin.
        jvmDefault.set(JvmDefaultMode.NO_COMPATIBILITY)
    }
}
