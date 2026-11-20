import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import desktop_launch


class DesktopLaunchTests(unittest.TestCase):
    @patch.object(desktop_launch, 'allow_booth_camera')
    @patch.object(desktop_launch, 'os', SimpleNamespace(name='nt'))
    @patch.object(desktop_launch, 'find_windows_browser', return_value='/Programs/Microsoft Edge/msedge.exe')
    @patch.object(desktop_launch.subprocess, 'Popen')
    @patch.object(desktop_launch.webbrowser, 'open')
    def test_windows_opens_persistent_fullscreen_profile_without_a_shell(self, normal, launch, find, approve):
        with tempfile.TemporaryDirectory(prefix='Misrah test ') as temp:
            desktop_launch.open_booth('http://127.0.0.1:8765/landscape.html', temp)
            args, kwargs = launch.call_args
            self.assertEqual(args[0][:3], ['/Programs/Microsoft Edge/msedge.exe', '--app=http://127.0.0.1:8765/landscape.html', '--start-fullscreen'])
            self.assertNotIn('--kiosk', args[0])
            self.assertNotIn('--inprivate', args[0])
            self.assertIn('--user-data-dir=' + str(Path(temp).resolve() / 'browser-profile'), args[0])
            self.assertNotIn('shell', kwargs)
            approve.assert_called_once_with('/Programs/Microsoft Edge/msedge.exe', 'http://127.0.0.1:8765/landscape.html')
            normal.assert_not_called()

    def test_camera_approval_preserves_entries_and_is_idempotent(self):
        registry = MagicMock(HKEY_CURRENT_USER=1, KEY_READ=2, KEY_WRITE=4, REG_SZ=1)
        entries = [('1', 'https://existing.example', 1), ('3', 'https://another.example', 1)]
        registry.QueryInfoKey.side_effect = lambda key: (0, len(entries), 0)
        registry.EnumValue.side_effect = lambda key, index: entries[index]
        registry.SetValueEx.side_effect = lambda key, name, unused, kind, value: entries.append((name, value, kind))
        with patch.dict('sys.modules', winreg=registry):
            for browser, vendor in [('msedge.exe', r'Microsoft\Edge'), ('chrome.exe', r'Google\Chrome')]:
                entries[:] = entries[:2]
                registry.SetValueEx.reset_mock()
                desktop_launch.allow_booth_camera(browser, 'http://127.0.0.1:8765/landscape.html')
                desktop_launch.allow_booth_camera(browser, 'http://127.0.0.1:8765/landscape.html')
                registry.CreateKeyEx.assert_called_with(1, rf'Software\Policies\{vendor}\VideoCaptureAllowedUrls', 0, 6)
                registry.SetValueEx.assert_called_once()
                self.assertEqual(entries[-1], ('2', 'http://127.0.0.1:8765', 1))
                self.assertEqual(entries[0], ('1', 'https://existing.example', 1))

    def test_camera_approval_rejects_non_booth_origins(self):
        for url in ('http://example.com:8765/', 'http://127.0.0.1/', 'http://user@127.0.0.1:8765/'):
            with self.assertRaises(ValueError):
                desktop_launch.allow_booth_camera('msedge.exe', url)

    @patch.object(desktop_launch, 'allow_booth_camera', side_effect=PermissionError('managed computer'))
    @patch.object(desktop_launch, 'os', SimpleNamespace(name='nt'))
    @patch.object(desktop_launch, 'find_windows_browser', return_value='/Programs/msedge.exe')
    @patch.object(desktop_launch.subprocess, 'Popen')
    def test_camera_policy_failure_still_opens_booth(self, launch, find, approve):
        with tempfile.TemporaryDirectory() as temp:
            desktop_launch.open_booth('http://127.0.0.1:8765/landscape.html', temp)
        launch.assert_called_once()

    @patch.object(desktop_launch, 'os', SimpleNamespace(name='nt'))
    @patch.object(desktop_launch, 'find_windows_browser')
    @patch.object(desktop_launch.webbrowser, 'open')
    def test_windowed_option_keeps_operator_browser_available(self, normal, find):
        desktop_launch.open_booth('http://127.0.0.1:8765/landscape.html', '.', windowed=True)
        find.assert_not_called()
        normal.assert_called_once()

    @patch.object(desktop_launch, 'os', SimpleNamespace(name='nt'))
    @patch.object(desktop_launch, 'find_windows_browser', return_value=None)
    @patch.object(desktop_launch.webbrowser, 'open')
    def test_missing_browser_has_a_working_fallback(self, normal, find):
        desktop_launch.open_booth('http://127.0.0.1:8765/landscape.html', '.')
        normal.assert_called_once()
