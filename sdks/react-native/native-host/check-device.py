"""Exercise the real RN Android host through native accessibility and OS input."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

host = Path(__file__).resolve().parent
root = host.parents[2]
sdk = Path(os.environ.get('ANDROID_HOME', root / '.tools/android-sdk'))
serial = os.environ.get('ANDROID_SERIAL', 'emulator-5554')
adb = [str(sdk / 'platform-tools/adb'), '-s', serial]

def run(*args):
    return subprocess.check_output(adb + list(args)).decode()

def snapshot():
    run('shell', 'uiautomator', 'dump', '/sdcard/likerts-rn-hierarchy.xml')
    return ET.fromstring(run('exec-out', 'cat', '/sdcard/likerts-rn-hierarchy.xml'))

def bounds(node):
    return list(map(int, re.findall(r'\d+', node.get('bounds'))))

def find(tag, direction='down'):
    for _ in range(9):
        tree = snapshot()
        node = next((n for n in tree.iter('node') if n.get('resource-id') == tag), None)
        width, height = bounds(next(tree.iter('node')))[2:]
        if node is not None:
            left, top, right, bottom = bounds(node)
            if bottom - top >= 16 and top >= 24 and bottom < height - 10:
                return node
        start, end = (int(height * .78), int(height * .30)) if direction == 'down' else (int(height * .28), int(height * .76))
        run('shell', 'input', 'swipe', str(width//2), str(start), str(width//2), str(end), '300')
    raise AssertionError('Visible native node not found: '+tag)

def tap(tag, direction='down'):
    node = find(tag, direction)
    assert node.get('enabled') == 'true', tag+' is disabled'
    left, top, right, bottom = bounds(node)
    run('shell', 'input', 'tap', str((left+right)//2), str((top+bottom)//2))

run('shell','am','force-stop','com.likerts.rnhost')
run('shell','am','start','-n','com.likerts.rnhost/.MainActivity')
time.sleep(1)
tap('acceptance-submit')
error = find('acceptance-error')
assert error.get('text') == 'Priority: an answer is required.', error.attrib
assert find('host-status', 'up').get('text') == 'Awaiting native interaction'
tap('acceptance-rank-a-down')
tap('acceptance-matrix-r-two')
assert find('acceptance-matrix-r-two').get('checked') == 'true'
for tag, value in [('acceptance-sum-x','60'),('acceptance-sum-y','40')]:
    tap(tag)
    run('shell','input','text',value)
    run('shell','input','keyevent','4')
assert find('acceptance-sum-remaining').get('text') == '0 remaining'
tap('acceptance-submit')
status = find('host-status', 'up')
assert status.get('text') == 'NATIVE PASS — exact answers, one submission', status.attrib
output = Path(os.environ.get('LIKERTS_RN_SCREENSHOT', '/tmp/likerts-rn-native-pass.png'))
output.write_bytes(subprocess.check_output(adb+['exec-out','screencap','-p']))
print(json.dumps({'reactNative':'0.86.3','react':'19.2.3','platform':'Android','device':serial,'api':run('shell','getprop','ro.build.version.sdk').strip(),'checks':['required validation prevents submit','ranking native move','matrix checked state','native text input','allocation exact total','complete exact answer map','one submission'], 'result':'passed','screenshot':str(output)}))
