#include <DefaultTurboModuleManagerDelegate.h>
#include <FBReactNativeSpec.h>
#include <fbjni/fbjni.h>

// This host has no autolinked native modules. Register React Native's own
// generated Java TurboModules, which its New Architecture requires.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    facebook::react::DefaultTurboModuleManagerDelegate::javaModuleProvider =
        &facebook::react::FBReactNativeSpec_ModuleProvider;
  });
}
