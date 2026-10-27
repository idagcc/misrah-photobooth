"""Open an isolated full-screen booth browser on Windows."""
import os
from pathlib import Path
import shutil
import subprocess
import webbrowser


def find_windows_browser():
    for executable in ("msedge.exe", "chrome.exe"):
        candidates = []
        try:
            import winreg
            for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
                    try:
                        with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{executable}", 0,
                                            winreg.KEY_READ | view) as key:
                            candidates.append(winreg.QueryValueEx(key, None)[0].strip('"'))
                    except OSError:
                        pass
        except ImportError:
            pass
        relative = ("Microsoft/Edge/Application/msedge.exe" if executable == "msedge.exe"
                    else "Google/Chrome/Application/chrome.exe")
        for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            if os.environ.get(variable):
                candidates.append(str(Path(os.environ[variable]) / relative))
        installed = shutil.which(executable)
        if installed:
            candidates.append(installed)
        for candidate in candidates:
            if Path(candidate).is_file():
                return candidate
    return None


def open_booth(url, data_directory, windowed=False):
    if os.name == "nt" and not windowed:
        browser = find_windows_browser()
        if browser:
            profile = Path(data_directory).resolve() / "browser-profile"
            profile.mkdir(parents=True, exist_ok=True)
            command = [browser, "--kiosk", url, "--no-first-run", f"--user-data-dir={profile}"]
            if Path(browser).name.lower() == "msedge.exe":
                command.append("--edge-kiosk-type=fullscreen")
            try:
                subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except OSError as error:
                print(f"Could not start full-screen browser: {error}", flush=True)
        print("For automatic full-screen startup, install Microsoft Edge or Google Chrome. Opening the default browser; press F11 for full screen.", flush=True)
    webbrowser.open(url)
