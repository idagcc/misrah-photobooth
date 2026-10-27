import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import desktop_launch


class DesktopLaunchTests(unittest.TestCase):
    @patch.object(desktop_launch, 'os', SimpleNamespace(name='nt'))
    @patch.object(desktop_launch, 'find_windows_browser', return_value='/Programs/Microsoft Edge/msedge.exe')
    @patch.object(desktop_launch.subprocess, 'Popen')
    @patch.object(desktop_launch.webbrowser, 'open')
    def test_windows_opens_isolated_edge_kiosk_without_a_shell(self, normal, launch, find):
        with tempfile.TemporaryDirectory(prefix='Misrah test ') as temp:
            desktop_launch.open_booth('http://127.0.0.1:8765/landscape.html', temp)
            args, kwargs = launch.call_args
            self.assertEqual(args[0][:3], ['/Programs/Microsoft Edge/msedge.exe', '--kiosk', 'http://127.0.0.1:8765/landscape.html'])
            self.assertIn('--edge-kiosk-type=fullscreen', args[0])
            self.assertIn('--user-data-dir=' + str(Path(temp).resolve() / 'browser-profile'), args[0])
            self.assertNotIn('shell', kwargs)
            normal.assert_not_called()

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
