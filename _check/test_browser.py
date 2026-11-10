import subprocess
import time
import os
import signal

# Test basic webgl screenshot
html_content = """<!DOCTYPE html>
<html>
<head>
    <title>WebGL Test</title>
</head>
<body style="margin:0; background: #070b1e; color: white;">
    <h1 id="status">Testing WebGL...</h1>
    <canvas id="c"></canvas>
    <script type="module">
        import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js';
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 800/600, 0.1, 100);
        camera.position.set(0, 2, 5);
        camera.lookAt(0, 0, 0);
        const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
        renderer.setSize(800, 600);
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        renderer.render(scene, camera);
        document.getElementById('status').innerText = 'WebGL Render OK: ' + !!renderer.getContext();
    </script>
</body>
</html>"""

os.makedirs("_check", exist_ok=True)
with open("_check/test.html", "w") as f:
    f.write(html_content)

# Start simple server
srv = subprocess.Popen(["python3", "-m", "http.server", "8999", "--directory", "_check"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

brave_bin = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
cmd = [
    brave_bin,
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--window-size=800,600",
    "--user-data-dir=/tmp/brave_test_tmp",
    "--screenshot=_check/webgl_test.png",
    "http://127.0.0.1:8999/test.html"
]

res = subprocess.run(cmd, capture_output=True, text=True)
print("Return code:", res.returncode)
if os.path.exists("_check/webgl_test.png"):
    print("Screenshot exists, size:", os.path.getsize("_check/webgl_test.png"))
else:
    print("Screenshot failed")

srv.terminate()
