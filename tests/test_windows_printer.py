import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from windows_printer import WindowsPrinter
from booth_service import BoothService, DEFAULTS
from test_booth_service import image


class WindowsPrinterTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Requires the Windows PowerShell print bridge')
    def test_real_job_classifier_distinguishes_queue_removal_from_failures(self):
        for job, expected in [
            (None, 'unlisted'), ({}, 'queued'),
            ({'IsPrinting': True}, 'processing'),
            ({'IsPrinted': True}, 'completed'),
            ({'IsCompleted': True, 'IsDeleting': True}, 'completed'),
            ({'IsPrinted': True, 'IsDeleted': True}, 'completed'),
            ({'IsDeleted': True}, 'unlisted'),
            ({'IsDeleting': True}, 'unlisted'),
            ({'IsInError': True, 'IsDeleted': True}, 'stopped'),
            ({'IsPaused': True, 'IsDeleting': True}, 'held'),
        ]:
            with self.subTest(job=job):
                self.assertEqual(WindowsPrinter().request('test-job-state', job=job), expected)

    @unittest.skipUnless(sys.platform == 'win32', 'Requires the Windows PowerShell/.NET print bridge')
    def test_real_bridge_accepts_dnp_bleed_but_rejects_other_sizes_and_multi_layouts(self):
        for name, width, height, dnp, expected in [
            ('4x6', 400, 600, False, True),
            ('(6x4)', 615, 413, True, True),
            ('PR (4x6)', 413, 615, True, True),
            ('(6x4)', 615, 413, False, False),
            ('(6x4) x 2', 615, 413, True, False),
            ('6x4x2', 615, 413, True, False),
            ('6x2', 600, 200, True, False),
            ('6x8', 615, 812, True, False),
            ('A4', 827, 1169, True, False),
        ]:
            with self.subTest(name=name, dnp=dnp):
                self.assertEqual(WindowsPrinter().request('test-media', name=name, width=width, height=height, dnp=dnp), expected)

    @patch('windows_printer.subprocess.run')
    def test_names_are_data_and_jpeg_is_passed_without_a_temporary_photo(self, run):
        run.return_value = SimpleNamespace(returncode=0, stdout='{"result":123}', stderr='')
        printer = 'Event "Printer"; $(not-a-command)'
        self.assertEqual(WindowsPrinter().submit_photo(printer, '42', b'JPEG'), 123)
        args, kwargs = run.call_args
        self.assertNotIn(printer, args[0])
        self.assertNotIn('shell', kwargs)
        request = json.loads(kwargs['input'])
        self.assertEqual(request['printer'], printer)
        self.assertEqual(base64.b64decode(request['image']), b'JPEG')

    @patch('windows_printer.subprocess.run')
    def test_driver_errors_and_uncertain_timeouts_are_preserved(self, run):
        run.return_value = SimpleNamespace(returncode=1, stdout='{"error":"Paper empty"}', stderr='')
        with self.assertRaisesRegex(RuntimeError, 'Paper empty'):
            WindowsPrinter().printers()
        run.side_effect = subprocess.TimeoutExpired('powershell', 25)
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            WindowsPrinter().submit_photo('DNP', '42', b'JPEG')
        self.assertEqual(run.call_count, 2)

    @patch.object(WindowsPrinter, 'request')
    def test_service_submits_jpeg_once_and_preserves_unknown_jobs(self, request):
        state = {'timeout': False, 'submissions': 0}
        def respond(action, **values):
            if action == 'printers':
                return [{'id':'DNP', 'blocked':False, 'fault':''}]
            if action == 'media':
                return [{'id':'42', 'name':'4 x 6'}]
            if action == 'job':
                return 'unknown'
            if action == 'submit':
                state['submissions'] += 1
                self.assertTrue(base64.b64decode(values['image']).startswith(b'\xff\xd8'))
                if state['timeout']:
                    raise RuntimeError('Windows print response timed out. Check the queue.')
                return 123
        request.side_effect = respond
        with tempfile.TemporaryDirectory() as temp:
            service = BoothService(temp, WindowsPrinter())
            try:
                service.save_settings({**DEFAULTS, 'printMode':'native', 'printer':'DNP', 'media':'42'})
                key = str(uuid.uuid4())
                self.assertEqual(service.print_photo(key, 'frontal-weaver', image())['job_id'], 123)
                service.print_photo(key, 'frontal-weaver', image())
                self.assertEqual(state['submissions'], 1)
                service.status()
                self.assertEqual(service.stats()['totals']['completed'], 0)
                state['timeout'] = True
                key = str(uuid.uuid4())
                self.assertEqual(service.print_photo(key, 'frontal-weaver', image())['state'], 'unknown')
                service.print_photo(key, 'frontal-weaver', image())
                self.assertEqual(state['submissions'], 2)
            finally:
                service.db.close()
