"""Open an isolated full-screen booth browser on Windows."""
import os
from pathlib import Path
import shutil
import subprocess
import webbrowser
from urllib.parse import urlsplit


def allow_booth_camera(browser, url):
    """Allow only this loopback origin in the current user's browser policy.

    Unlike temporary site permissions, this survives browser/profile restarts.
    Existing allow-list entries and Windows privacy settings are preserved.
    """
    origin = urlsplit(url)
    if (origin.scheme != "http" or origin.hostname != "127.0.0.1"
            or origin.username is not None or origin.password is not None
            or origin.port is None):
        raise ValueError("Camera approval requires the explicit local booth address")
    executable = Path(browser).name.lower()
    vendor = {"msedge.exe": r"Microsoft\Edge", "chrome.exe": r"Google\Chrome"}.get(executable)
    if vendor is None:
        raise ValueError("Camera approval requires Edge or Chrome")
    import winreg
    pattern = f"http://127.0.0.1:{origin.port}"
    path = rf"Software\Policies\{vendor}\VideoCaptureAllowedUrls"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, path, 0,
                            winreg.KEY_READ | winreg.KEY_WRITE) as key:
        entries = [winreg.EnumValue(key, i) for i in range(winreg.QueryInfoKey(key)[1])]
        if any(value == pattern and kind == winreg.REG_SZ for _, value, kind in entries):
            return
        occupied = {name for name, _, _ in entries}
        slot = 1
        while str(slot) in occupied:
            slot += 1
        winreg.SetValueEx(key, str(slot), 0, winreg.REG_SZ, pattern)


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
            try:
                allow_booth_camera(browser, url)
            except (OSError, ImportError, ValueError) as error:
                print(f"Could not save automatic camera approval: {error}. "
                      "Choose Always allow in the booth browser if prompted.", flush=True)
            profile = Path(data_directory).resolve() / "browser-profile"
            profile.mkdir(parents=True, exist_ok=True)
            # Edge kiosk mode is always InPrivate and rotates camera identities.
            command = [browser, f"--app={url}", "--start-fullscreen", "--no-first-run",
                       f"--user-data-dir={profile}"]
            try:
                subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except OSError as error:
                print(f"Could not start full-screen browser: {error}", flush=True)
        print("For automatic full-screen startup, install Microsoft Edge or Google Chrome. Opening the default browser; press F11 for full screen.", flush=True)
    webbrowser.open(url)
