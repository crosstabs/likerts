"""Build the RN core TurboModule registration glue with the installed NDK.

The fixture has no third-party native modules. Pinned RN/Fbjni prefab headers and
RN's own compiler flags are used, rather than substituting JS mocks.
"""
import os
from pathlib import Path
import re
import subprocess

host = Path(__file__).resolve().parent
root = host.parents[2]
sdk = Path(os.environ.get('ANDROID_HOME', root / '.tools/android-sdk'))
cache = Path(os.environ.get('GRADLE_USER_HOME', root / '.tools/gradle-home')) / 'caches'
rn = next(cache.glob('*/transforms/*/transformed/react-android-0.86.3-debug/prefab'))
fb = next(cache.glob('*/transforms/*/transformed/fbjni-0.7.0/prefab'))
compiler = next(sdk.glob('ndk/*/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android24-clang++'))
source = host / 'android/app/src/main'
output = source / 'jniLibs/arm64-v8a/libappmodules.so'
output.parent.mkdir(parents=True, exist_ok=True)
flags_file = host.parent / 'node_modules/react-native/ReactAndroid/cmake-utils/folly-flags.cmake'
flags = re.findall(r'-D[A-Z_]+=[01]', flags_file.read_text())
args = [str(compiler), '-shared', '-fPIC', '-std=c++20', '-Wl,-z,max-page-size=16384', *flags]
for prefab in [rn, fb]:
    for include in prefab.glob('modules/*/include'):
        args += ['-I', str(include)]
    for library in prefab.glob('modules/*/libs/android.arm64-v8a'):
        args += ['-L', str(library)]
args += [str(source / 'jni/OnLoad.cpp'), '-lreactnative', '-lfbjni', '-llog', '-o', str(output)]
subprocess.run(args, check=True)
