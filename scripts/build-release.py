"""Build clean operating packages; never copy local settings or guest photographs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VERSION = "3.14.10"
PYTHON_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
PYTHON_SHA256 = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=["all", "macos", "windows"], default="all")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--python-zip", type=Path, help="Use a previously downloaded, checksum-verified runtime")
    args = parser.parse_args()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    args.output.mkdir(parents=True, exist_ok=True)
    checksums = []
    with tempfile.TemporaryDirectory(prefix="misrah-build-") as temp:
        temp = Path(temp)
        for platform in (["macos", "windows"] if args.platform == "all" else [args.platform]):
            name = f"misrah-photobooth-v{version}-{platform}" + ("-x64" if platform == "windows" else "")
            stage = temp / name
            stage.mkdir()
            for file in ["server.py", "desktop_launch.py", "booth_service.py", "windows_printer.py", "windows-print.ps1", "README.md", "IMPLEMENTATION.md", "THIRD_PARTY_NOTICES.txt"]:
                shutil.copy2(ROOT / file, stage / file)
            shutil.copytree(ROOT / "public", stage / "public", ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
            launcher = "Start Photobooth.bat" if platform == "windows" else "Start Photobooth.command"
            shutil.copy2(ROOT / launcher, stage / launcher)
            if platform == "windows":
                if args.python_zip:
                    data = args.python_zip.read_bytes()
                else:
                    with urllib.request.urlopen(PYTHON_URL, timeout=90) as response:
                        data = response.read()
                if hashlib.sha256(data).hexdigest() != PYTHON_SHA256:
                    raise ValueError("Python runtime checksum mismatch")
                runtime_zip = temp / "python.zip"
                runtime_zip.write_bytes(data)
                with zipfile.ZipFile(runtime_zip) as archive:
                    archive.extractall(stage / "runtime")
                # Embedded Python ignores environment paths. Explicitly include app modules.
                (stage / "runtime" / "python314._pth").write_text("python314.zip\n.\n..\n", encoding="utf-8")
                (stage / launcher).write_bytes((ROOT / launcher).read_text().replace("\n", "\r\n").encode())
            (stage / "BUILD.json").write_text(json.dumps({
                "version": version, "platform": platform, "revision": revision,
                "python": PYTHON_VERSION if platform == "windows" else "System Python 3.9+",
            }, indent=2) + "\n")
            archive_path = args.output / f"{name}.zip"
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for file in sorted(stage.rglob("*")):
                    if file.is_file():
                        archive.write(file, file.relative_to(temp))
            checksums.append(f"{hashlib.sha256(archive_path.read_bytes()).hexdigest()}  {archive_path.name}")
            print(archive_path)
    (args.output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")


if __name__ == "__main__":
    main()
