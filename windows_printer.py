"""Windows spooler bridge using the system PowerShell/.NET installation."""
import json
from pathlib import Path
import subprocess


class WindowsPrinter:
    def request(self, action, **values):
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                 "-File", str(Path(__file__).with_name("windows-print.ps1"))],
                input=json.dumps({"action": action, **values}), encoding="utf-8",
                capture_output=True, timeout=25, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            raise RuntimeError("Windows print response timed out. Check the print queue before printing again.") from None
        try:
            value = json.loads(result.stdout.lstrip("\ufeff"))
        except ValueError:
            raise RuntimeError("The Windows print service did not confirm the request.") from None
        if "error" in value:
            raise RuntimeError(value["error"][:240])
        if result.returncode:
            raise RuntimeError("The Windows print service did not confirm the request.")
        return value["result"]

    def printers(self):
        return self.request("printers")

    def media(self, printer):
        return self.request("media", printer=printer)

    def submit_photo(self, printer, media, jpeg):
        import base64
        return self.request("submit", printer=printer, media=media, image=base64.b64encode(jpeg).decode("ascii"))

    def job(self, printer, job_id):
        return self.request("job", printer=printer, jobId=job_id)
