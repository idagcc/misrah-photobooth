"""No physical printer is contacted by these device and persistence checks."""
import base64
import concurrent.futures
from datetime import datetime, timezone
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from booth_service import BoothService, CupsPrinter, DEFAULTS, photo_pdf, printer_summary


def image(width=1024, height=1536):
    # Only the metadata parser is under test here; browser checks use real images.
    data = b'\xff\xd8\xff\xc0' + struct.pack('>H B H H B', 17, 8, height, width, 3) + b'\x01\x11\x00\x02\x11\x00\x03\x11\x00\xff\xd9'
    return 'data:image/jpeg;base64,' + base64.b64encode(data).decode()


class Printer:
    def __init__(self):
        self.calls = 0
        self.state = 'queued'
        self.reason = 'none'
        self.timeout = False

    def printers(self):
        return [printer_summary({'printer-name': ['DNP_RX1HS'], 'printer-info': ['DNP RX1HS'], 'printer-state': [3],
                                 'printer-is-accepting-jobs': [True], 'printer-state-reasons': [self.reason]})]

    def media(self, printer):
        return [{'id': '6x4', 'name': '4 × 6'}]

    def submit(self, printer, media, pdf):
        self.calls += 1
        if self.timeout:
            raise RuntimeError('Print response timed out. Check the Mac queue before printing again.')
        assert b'/MediaBox [0 0 432 288]' in pdf
        return 123

    def job(self, printer, job_id):
        return self.state


class BoothTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.printer = Printer()
        self.service = BoothService(self.directory.name, self.printer)
        self.settings = {**DEFAULTS, 'printMode': 'native', 'printer': 'DNP_RX1HS', 'media': '6x4'}
        self.service.save_settings(self.settings)

    def tearDown(self):
        self.service.db.close()
        self.directory.cleanup()

    def test_local_settings_and_template_counts_survive_restart(self):
        key = str(uuid.uuid4())
        self.service.event(key, 'frontal-weaver', 'selection')
        self.service.event(key, 'frontal-weaver', 'selection')
        reopened = BoothService(self.directory.name, self.printer)
        self.assertEqual(reopened.config()['settings'], self.settings)
        self.assertEqual(reopened.stats()['totals']['selections'], 1)
        reopened.db.close()

    def test_import_and_toggle_keep_at_least_one_portrait(self):
        config = self.service.add_template('A new portrait', image(), image(200, 300))
        added = config['templates'][-1]
        self.assertTrue(added['src'].endswith('.jpg'))
        self.assertIn('-thumb.jpg', added['thumbnail'])
        self.service.set_active(added['id'], False)
        self.service.set_active('frontal-weaver', False)
        self.service.set_active('misrah-sailor', False)
        with self.assertRaisesRegex(ValueError, 'at least one'):
            self.service.set_active('frontal-pearl-trader', False)

    def test_import_rejects_landscape_or_malformed_image(self):
        for value in (image(1600, 1000), 'data:image/jpeg;base64,bm90LWEtanBlZw=='):
            with self.assertRaises(ValueError):
                self.service.add_template('Bad', value, image(200, 300))

    def test_unknown_printer_and_media_cannot_be_saved(self):
        for overrides in ({'printer': 'not-installed'}, {'media': 'A4'}, {'rate': 99}):
            with self.assertRaises(ValueError):
                self.service.save_settings({**self.settings, **overrides})

    def test_30_fps_profile_and_existing_lower_rates_persist(self):
        for rate in (5, 10, 30):
            value = {**self.settings, 'rate': rate}
            self.service.save_settings(value)
            reopened = BoothService(self.directory.name, self.printer)
            self.assertEqual(reopened.config()['settings']['rate'], rate)
            reopened.db.close()

    def test_same_request_is_never_submitted_twice_even_concurrently(self):
        key = str(uuid.uuid4())
        def send(_):
            return self.service.print_photo(key, 'frontal-weaver', image())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(send, range(4)))
        self.assertEqual(self.printer.calls, 1)
        self.assertTrue(all(r['job_id'] == 123 for r in results))
        self.assertEqual(self.service.stats()['totals']['requests'], 1)
        self.assertEqual(self.service.stats()['totals']['queued'], 1)

    def test_paper_out_blocks_submission_and_records_error(self):
        self.printer.reason = 'media-empty-error'
        result = self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.assertEqual(result['state'], 'failed')
        self.assertIn('Paper is empty', result['message'])
        self.assertEqual(self.printer.calls, 0)
        self.assertEqual(self.service.stats()['totals']['errors'], 1)

    def test_completion_and_cancellation_are_distinct_from_acceptance(self):
        self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.printer.state = 'completed'
        self.service.status()
        self.assertEqual(self.service.stats()['totals']['completed'], 1)
        self.service.print_photo(str(uuid.uuid4()), 'frontal-pearl-trader', image())
        self.printer.state = 'cancelled'
        self.service.status()
        stats = self.service.stats()['totals']
        self.assertEqual(stats['queued'], 2)
        self.assertEqual(stats['completed'], 1)

    def test_unknown_after_acceptance_does_not_lose_accepted_count(self):
        self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.printer.state = 'unknown'
        self.service.status()
        self.assertEqual(self.service.stats()['totals']['queued'], 1)

    def test_timeout_is_unknown_and_is_not_retried(self):
        self.printer.timeout = True
        key = str(uuid.uuid4())
        result = self.service.print_photo(key, 'frontal-weaver', image())
        self.assertEqual(result['state'], 'unknown')
        self.service.print_photo(key, 'frontal-weaver', image())
        self.assertEqual(self.printer.calls, 1)
        self.assertEqual(self.service.stats()['totals']['queued'], 0)

    def test_paper_ribbon_cover_and_offline_errors_are_separate(self):
        for reason, message in [('media-empty-error', 'Paper'), ('ribbon-empty', 'Ribbon'), ('door-open-error', 'cover'), ('offline', 'disconnected')]:
            self.printer.reason = reason
            value = self.printer.printers()[0]
            self.assertTrue(value['blocked'])
            self.assertIn(message, value['fault'])
            self.assertIsNone(value['mediaRemaining'])

    def test_dialogs_are_not_counted_as_printed_photos(self):
        self.service.event(str(uuid.uuid4()), 'frontal-weaver', 'dialog')
        stats = self.service.stats()['totals']
        self.assertEqual(stats['dialogs'], 1)
        self.assertEqual(stats['queued'], 0)
        self.assertEqual(stats['completed'], 0)

    def test_no_guest_images_are_persisted_by_printing(self):
        self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.assertEqual(list((Path(self.directory.name) / 'templates').iterdir()), [])
        self.assertEqual([p.name for p in Path(self.directory.name).iterdir() if p.is_file()], ['booth.sqlite3'])

    def test_print_pdf_is_one_4_by_6_page_with_no_photo_crop(self):
        jpeg = base64.b64decode(image().split(',')[1])
        pdf = photo_pdf(jpeg)
        self.assertIn(b'/MediaBox [0 0 288 432]', pdf)
        self.assertIn(b'/Count 1', pdf)
        self.assertIn(b'288.0000 0 0 432.0000 0.0000 0.0000 cm', pdf)

    def test_dnp_6_by_4_media_rotates_portrait_to_fill_page(self):
        jpeg = base64.b64decode(image().split(',')[1])
        pdf = photo_pdf(jpeg, landscape=True)
        self.assertIn(b'/MediaBox [0 0 432 288]', pdf)
        self.assertIn(b'0 288.0000 -432.0000 0 432.0000 0.0000 cm', pdf)

    def test_native_lp_receives_selected_media_and_temporary_pdf_is_removed(self):
        paths = []
        def submit(args, **kwargs):
            paths.append(Path(args[-1]))
            self.assertIn('media=6x4', args)
            self.assertEqual(args[args.index('-d') + 1], 'DNP_RX1HS')
            self.assertEqual(args[args.index('-n') + 1], '1')
            self.assertNotIn('shell', kwargs)
            self.assertTrue(paths[-1].read_bytes().startswith(b'%PDF-1.4'))
            return type('Result', (), {'returncode': 0, 'stdout': 'request id is DNP_RX1HS-123 (1 file(s))', 'stderr': ''})()
        with patch('booth_service.shutil.which', return_value='/usr/bin/lp'), patch('booth_service.subprocess.run', side_effect=submit):
            result = CupsPrinter().submit('DNP_RX1HS', '6x4', b'%PDF-1.4\nmock')
        self.assertEqual(result, 123)
        self.assertFalse(paths[0].exists())

    def test_week_folders_use_dubai_monday_boundary_and_iso_year(self):
        instants = [(datetime(2026, 10, 25, 19, 59, tzinfo=timezone.utc), '2026-W43'),
                    (datetime(2026, 10, 25, 20, 0, tzinfo=timezone.utc), '2026-W44'),
                    (datetime(2027, 1, 1, 10, 0, tzinfo=timezone.utc), '2026-W53')]
        for instant, expected in instants:
            with patch('booth_service.archive_now', return_value=instant):
                result = self.service.archive_photo(str(uuid.uuid4()), 'frontal-weaver', image())
            self.assertEqual(result['path'].split('/')[0], expected)
            self.assertTrue((self.service.photos_directory / result['path']).is_file())
        self.assertEqual(self.service.storage()['photos'], 3)

    def test_archive_retries_and_reprints_do_not_duplicate_photos(self):
        key = str(uuid.uuid4())
        def save(_):
            return self.service.archive_photo(key, 'frontal-weaver', image())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(save, range(4)))
        self.assertTrue(all(r['path'] == results[0]['path'] for r in results))
        self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.service.print_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.assertEqual(self.service.storage()['photos'], 1)
        self.assertEqual(len(list(self.service.photos_directory.rglob('*.jpg'))), 1)
        # A retake is a distinct capture.
        self.service.archive_photo(str(uuid.uuid4()), 'frontal-weaver', image())
        self.assertEqual(self.service.storage()['photos'], 2)

    def test_interrupted_save_recovers_in_original_week_after_restart(self):
        key = str(uuid.uuid4())
        with patch('booth_service.archive_now', return_value=datetime(2026, 10, 25, 19, 59, tzinfo=timezone.utc)):
            with patch('booth_service.os.replace', side_effect=OSError('Disk write failed')):
                with self.assertRaisesRegex(RuntimeError, 'Disk write failed'):
                    self.service.archive_photo(key, 'frontal-weaver', image())
        self.assertEqual(self.service.storage()['photos'], 0)
        self.assertEqual(self.service.storage()['unsaved'], 1)
        self.assertFalse(list(self.service.photos_directory.rglob('.saving-*')))
        reopened = BoothService(self.directory.name, self.printer)
        with patch('booth_service.archive_now', return_value=datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)):
            result = reopened.archive_photo(key, 'frontal-weaver', image())
        self.assertTrue(result['path'].startswith('2026-W43/'))
        self.assertEqual(reopened.storage()['photos'], 1)
        self.assertEqual(reopened.storage()['unsaved'], 0)
        reopened.db.close()

    def test_low_disk_space_fails_without_partial_photo_and_can_retry(self):
        key = str(uuid.uuid4())
        with patch('booth_service.shutil.disk_usage', return_value=SimpleNamespace(free=100, total=100000)):
            with self.assertRaisesRegex(RuntimeError, 'almost full'):
                self.service.archive_photo(key, 'frontal-weaver', image())
            self.assertTrue(self.service.storage()['lowSpace'])
        self.assertFalse(list(self.service.photos_directory.rglob('*.jpg')))
        self.service.archive_photo(key, 'frontal-weaver', image())
        self.assertEqual(self.service.storage()['photos'], 1)

    def test_archive_bytes_estimate_and_persisted_pause_setting(self):
        value = image()
        self.service.archive_photo(str(uuid.uuid4()), 'frontal-weaver', value)
        size = len(base64.b64decode(value.split(',')[1]))
        status = self.service.storage()
        self.assertEqual(status['bytes'], size)
        self.assertEqual(status['estimated30000Bytes'], size * 30000)
        self.service.set_archive_enabled(False)
        result = self.service.archive_photo(str(uuid.uuid4()), 'frontal-weaver', value)
        self.assertTrue(result['skipped'])
        reopened = BoothService(self.directory.name, self.printer)
        self.assertFalse(reopened.config()['settings']['archiveEnabled'])
        self.assertEqual(reopened.storage()['photos'], 1)
        reopened.db.close()

    def test_capture_id_cannot_replace_a_different_archived_photo(self):
        key = str(uuid.uuid4())
        self.service.archive_photo(key, 'frontal-weaver', image())
        with self.assertRaisesRegex(ValueError, 'different portrait'):
            self.service.archive_photo(key, 'frontal-weaver', image(1100, 1600))


if __name__ == '__main__':
    unittest.main()
