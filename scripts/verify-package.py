"""Extract and launch a release package, including embedded Python on Windows."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile


def main():
    with tempfile.TemporaryDirectory(prefix="Misrah package test ") as temp:
        with zipfile.ZipFile(sys.argv[1]) as archive:
            assert archive.testzip() is None
            assert not any(part in {".local-data", "photos", ".git", "node_modules"}
                           for name in archive.namelist() for part in Path(name).parts)
            archive.extractall(temp)
        root = next(Path(temp).iterdir())
        python = root / "runtime" / "python.exe" if sys.platform == "win32" else Path(sys.executable)
        if sys.platform == "win32":
            subprocess.run([str(python), "-c", "from windows_printer import WindowsPrinter; assert WindowsPrinter().request('check') is True; print('PASS Windows native print bridge compiles')"], cwd=root, check=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen([str(python), str(root / "server.py"), "--no-open", "--port", str(port)], cwd=root)
        try:
            base = f"http://127.0.0.1:{port}"
            for attempt in range(100):
                try:
                    with urllib.request.urlopen(base + "/api/bootstrap", timeout=2) as response:
                        bootstrap = json.load(response)
                    break
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError(f"Packaged server exited: {process.returncode}")
                    time.sleep(.1)
            else:
                raise RuntimeError("Packaged server did not start")
            assert bootstrap["token"]
            for asset in ["landscape.html", "index.html", "landscape.js", "approved-portraits.js", "models/face_landmarker.task"]:
                with urllib.request.urlopen(base + "/" + asset, timeout=5) as response:
                    assert response.status == 200 and response.read()
            with urllib.request.urlopen(base + "/api/status", timeout=10) as response:
                assert isinstance(json.load(response)["printers"], list)
            print("PASS packaged server, settings database, landscape screen, bundled model and printer status")
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
