#!/usr/bin/env python3
"""Opt-in synthetic SDK transport acceptance on native runtimes, never management APIs.

Requires an owner-provisioned private config and a named device. All tool output is
private/redacted by default; stdout contains only the public receipt evidence.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
from urllib.parse import urlsplit
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ('android', 'ios', 'react_native', 'flutter')
FIELDS = {'schemaVersion', 'target', 'sdkVersion', 'baseUrl', 'collectionId', 'collectionToken', 'idempotencyKey', 'responseCap', 'disposable'}

class AcceptanceFailure(Exception):
    pass

def require(value, code):
    if not value:
        raise AcceptanceFailure(code)

def read_config(path, target):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'config_not_regular_file')
    require(info.st_mode & 0o077 == 0 and info.st_size <= 8192, 'config_requires_private_permissions_and_small_size')
    with path.open() as handle:
        config = json.load(handle)
    require(isinstance(config, dict) and set(config) == FIELDS, 'config_fields_invalid_no_management_credentials_allowed')
    require(config['schemaVersion'] == 1 and config['target'] == target and config['sdkVersion'] == '0.0.3', 'config_target_or_version_invalid')
    require(config['disposable'] is True and config['responseCap'] == 1, 'disposable_cap_one_required')
    url = urlsplit(config['baseUrl'])
    require(url.scheme == 'https' and url.hostname and not url.username and not url.password and not url.query and not url.fragment and url.path in ('', '/'), 'exact_https_origin_required')
    require(str(uuid.UUID(config['collectionId'])) == config['collectionId'].lower(), 'collection_uuid_required')
    token = config['collectionToken']
    require(isinstance(token, str) and 16 <= len(token) <= 4096 and not re.search(r'[\s\x00-\x1f\x7f]', token), 'collection_token_invalid')
    require(isinstance(config['idempotencyKey'], str) and re.fullmatch(r'[A-Za-z0-9_-]{8,128}', config['idempotencyKey']), 'stable_idempotency_key_required')
    # Refuse a tracked secret file even if it has restrictive local permissions.
    try:
        relative = path.resolve().relative_to(ROOT)
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', str(relative)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        require(not tracked, 'config_must_not_be_tracked')
    except ValueError:
        pass
    return config

def verify_release_source(target):
    """All runtime source bytes must equal the frozen 0.0.3 release sources."""
    roots = {'android': ROOT/'sdks/android/src/main/kotlin', 'ios': ROOT/'sdks/ios/Sources', 'react_native': ROOT/'sdks/react-native/src', 'flutter': ROOT/'sdks/flutter/lib'}
    source = roots[target]
    if target == 'android':
        archive = ROOT/'releases/0.0.3/maven/com/likerts/likerts-android/0.0.3/likerts-android-0.0.3-sources.jar'
        with zipfile.ZipFile(archive) as jar:
            for file in source.rglob('*.kt'):
                require(jar.read(file.relative_to(source).as_posix()) == file.read_bytes(), 'source_differs_from_release_0_0_3')
    else:
        archive, prefix = {
            'ios': ('Likerts-ios-0.0.3.tar.gz', 'Likerts/Sources/'),
            'react_native': ('likerts-react-native-0.0.3.tgz', 'package/src/'),
            'flutter': ('likerts-flutter-0.0.3.tar.gz', 'likerts/lib/'),
        }[target]
        with tarfile.open(ROOT/'releases/0.0.3'/archive, 'r:gz') as tar:
            for file in source.rglob('*'):
                if file.is_file():
                    member = tar.extractfile(prefix + file.relative_to(source).as_posix())
                    require(member is not None and member.read() == file.read_bytes(), 'source_differs_from_release_0_0_3')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=TARGETS)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--device', required=True, help='Exact adb serial or iOS simulator UUID')
    parser.add_argument('--validate-only', action='store_true', help='Check config/source equivalence; do not build, launch or make network calls')
    args = parser.parse_args()
    config = read_config(args.config, args.target)
    verify_release_source(args.target)
    if args.validate_only:
        print(json.dumps({'target': args.target, 'config': 'validated', 'releaseSource': '0.0.3 identical', 'networkCalls': 0}))
        return
    private = ROOT/'.validation-private'
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    run_id = f'native-hosted-{args.target}-{uuid.uuid4().hex}'
    log_path = private/(run_id+'.log')
    log_path.touch(mode=0o600)
    env = os.environ.copy()
    env.setdefault('ANDROID_HOME', str(ROOT/'.tools/android-sdk'))
    if 'JAVA_HOME' not in env:
        env['JAVA_HOME'] = str(next((ROOT/'.tools/jdk').glob('*/Contents/Home')))
    env.setdefault('GRADLE_USER_HOME', str(ROOT/'.tools/gradle-home'))
    gradle = env.get('GRADLE_COMMAND', str(ROOT/'.tools/gradle-8.11.1/bin/gradle'))
    adb = [str(Path(env['ANDROID_HOME'])/'platform-tools/adb'), '-s', args.device]
    payload = json.dumps(config).encode()
    cleanup = []
    result = None
    with log_path.open('ab') as log:
        def run(command, label, cwd=ROOT, timeout=600, input=None, capture=False, check=True):
            try:
                completed = subprocess.run([str(v) for v in command], cwd=cwd, env=env, input=input,
                                           stdout=subprocess.PIPE if capture else log, stderr=log, timeout=timeout)
            except subprocess.TimeoutExpired:
                raise AcceptanceFailure(label+'_timeout') from None
            require(not check or completed.returncode == 0, label+'_failed')
            return completed.stdout if capture else b''

        def stage_android(package):
            run(adb+['shell', 'am', 'force-stop', package], 'stop_host')
            run(adb+['shell', 'run-as', package, 'mkdir', '-p', 'files'], 'create_private_files')
            run(adb+['shell', 'run-as', package, 'rm', '-f', 'files/likerts-hosted-result.json'], 'clear_stale_receipt')
            cleanup.append(lambda: run(adb+['shell', 'run-as', package, 'rm', '-f', 'files/likerts-hosted.json', 'files/likerts-hosted-result.json'], 'remove_private_config'))
            cleanup.append(lambda: run(adb+['shell', 'am', 'force-stop', package], 'stop_host'))
            run(adb+['shell', 'run-as', package, 'dd', 'of=files/likerts-hosted.json'], 'stage_collection_credential', input=payload)
            run(adb+['shell', 'run-as', package, 'chmod', '600', 'files/likerts-hosted.json'], 'protect_collection_credential')

        try:
            if args.target == 'android':
                run([gradle, '-p', ROOT/'sdks/android', 'assembleDebugAndroidTest'], 'android_build')
                apk = ROOT/'sdks/android/build/outputs/apk/androidTest/debug/likerts-android-debug-androidTest.apk'
                run(adb+['install', '-r', apk], 'android_install')
                package = 'com.likerts.sdk.test'
                stage_android(package)
                run(adb+['shell', 'am', 'instrument', '-w', '-e', 'class', 'com.likerts.sdk.HostedTransportInstrumentedTest', package+'/androidx.test.runner.AndroidJUnitRunner'], 'android_instrument', timeout=90)
                result = json.loads(run(adb+['exec-out', 'run-as', package, 'cat', 'files/likerts-hosted-result.json'], 'android_receipt', capture=True))
            elif args.target == 'react_native':
                host = ROOT/'sdks/react-native/native-host'
                run(['node', host/'bundle.cjs', 'android', 'hosted'], 'rn_bundle')
                run([gradle, '-p', host/'android', ':app:checkDebugAarMetadata'], 'rn_dependencies')
                run(['python3', host/'build-native.py'], 'rn_native_glue')
                run([gradle, '-p', host/'android', ':app:assembleDebug'], 'rn_build')
                run(adb+['install', '-r', host/'android/app/build/outputs/apk/debug/app-debug.apk'], 'rn_install')
                stage_android('com.likerts.rnhost')
                run(adb+['shell', 'am', 'start', '-n', 'com.likerts.rnhost/.MainActivity'], 'rn_launch')
                deadline = time.monotonic()+55
                while time.monotonic() < deadline:
                    run(adb+['shell', 'uiautomator', 'dump', '/sdcard/likerts-rn-hosted.xml'], 'rn_snapshot', timeout=10)
                    tree = ET.fromstring(run(adb+['exec-out', 'cat', '/sdcard/likerts-rn-hosted.xml'], 'rn_read_snapshot', capture=True))
                    node = next((n for n in tree.iter('node') if n.get('resource-id') == 'hosted-status'), None)
                    status = node.get('text', '') if node is not None else ''
                    require(not status.startswith('HOSTED FAIL'), 'rn_transport_failure')
                    if status.startswith('HOSTED PASS '):
                        result = json.loads(status[len('HOSTED PASS '):])
                        break
                    time.sleep(1)
                require(result is not None, 'rn_transport_timeout')
            elif args.target == 'ios':
                host = ROOT/'sdks/ios/Example'
                run(['xcodegen', 'generate'], 'ios_project', cwd=host)
                common = ['xcodebuild', '-quiet', '-project', host/'LikertsSample.xcodeproj', '-scheme', 'LikertsSample', '-destination', f'platform=iOS Simulator,id={args.device}', '-derivedDataPath', host/'.derived', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']
                run(common+['build-for-testing'], 'ios_build')
                run(['xcrun', 'simctl', 'install', args.device, host/'.derived/Build/Products/Debug-iphonesimulator/LikertsSample.app'], 'ios_install')
                def ios_directory():
                    container = Path(run(['xcrun', 'simctl', 'get_app_container', args.device, 'com.likerts.sample', 'data'], 'ios_container', capture=True).decode().strip())
                    return container/'Library/Application Support'
                directory = ios_directory()
                directory.mkdir(parents=True, exist_ok=True)
                staged = directory/'likerts-hosted.json'
                receipt_file = directory/'likerts-hosted-result.json'
                receipt_file.unlink(missing_ok=True)
                staged.write_bytes(payload)
                staged.chmod(0o600)
                cleanup.extend([lambda: staged.unlink(missing_ok=True), lambda: receipt_file.unlink(missing_ok=True)])
                # XCTest may reinstall the host into a new container, migrating its data.
                def clear_current_ios_config():
                    current = ios_directory()
                    (current/'likerts-hosted.json').unlink(missing_ok=True)
                    (current/'likerts-hosted-result.json').unlink(missing_ok=True)
                cleanup.append(clear_current_ios_config)
                run(common+['test-without-building', '-only-testing:LikertsSampleTests/HostedTransportTests'], 'ios_transport', timeout=100)
                result = json.loads((ios_directory()/'likerts-hosted-result.json').read_text())
            else:
                host = ROOT/'sdks/flutter/example'
                flutter = env.get('FLUTTER_COMMAND', str(ROOT/'.tools/flutter/bin/flutter'))
                defines = private/(run_id+'-defines.json')
                defines.write_text(json.dumps({'LIKERTS_HOSTED_CONFIG': json.dumps(config)}))
                defines.chmod(0o600)
                cleanup.append(lambda: defines.unlink(missing_ok=True))
                # Flutter defines are compiled into temporary ignored artifacts; clear them after the test.
                cleanup.append(lambda: shutil.rmtree(host/'build', ignore_errors=True))
                cleanup.append(lambda: shutil.rmtree(host/'.dart_tool/flutter_build', ignore_errors=True))
                def remove_flutter_host():
                    # flutter test normally uninstalls its integration app itself.
                    installed = run(adb+['shell', 'pm', 'path', 'com.likerts.likerts_example'], 'flutter_package_check', capture=True, check=False).strip()
                    if installed:
                        run(adb+['uninstall', 'com.likerts.likerts_example'], 'flutter_uninstall')
                    remaining = run(adb+['shell', 'pm', 'path', 'com.likerts.likerts_example'], 'flutter_package_check', capture=True, check=False).strip()
                    require(not remaining, 'flutter_app_cleanup_unverified')
                cleanup.append(remove_flutter_host)
                run([flutter, 'test', 'integration_test/hosted_transport_test.dart', '-d', args.device, '--dart-define-from-file='+str(defines)], 'flutter_transport', cwd=host, timeout=600)
                log.flush()
                matches = re.findall(r'LIKERTS_HOSTED_RESULT (\{[^\r\n]+\})', log_path.read_text(errors='replace'))
                require(len(matches) == 1, 'flutter_receipt_missing_or_duplicate')
                result = json.loads(matches[0])
            require(result and result.get('result') == 'passed' and result.get('target') == args.target and result.get('collectionId') == config['collectionId'] and result.get('identicalRetrySameReceipt') is True, 'receipt_evidence_invalid')
            result['sourceEquivalence'] = 'all runtime source bytes match frozen release 0.0.3'
            result['device'] = args.device
            result['privateLog'] = str(log_path)
        finally:
            cleanup_failures = 0
            for action in reversed(cleanup):
                try:
                    action()
                except Exception:
                    cleanup_failures += 1
            require(cleanup_failures == 0, 'private_config_cleanup_unverified')
        result['privateConfigCleanup'] = 'completed'
        output = private/(run_id+'-result.json')
        output.write_text(json.dumps(result, indent=2)+'\n')
        output.chmod(0o600)
        print(json.dumps(result))

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        main()
    except (AcceptanceFailure, OSError, ValueError, KeyError, StopIteration) as error:
        # Config parse errors and subprocess output may contain secrets: emit only known stage codes.
        code = str(error) if isinstance(error, AcceptanceFailure) else type(error).__name__
        print('Native hosted acceptance failed: '+code+'. Inspect the private local log if created.', file=sys.stderr)
        sys.exit(1)
