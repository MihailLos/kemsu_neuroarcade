"""Проверки реального HTTP-сервера с отдельным временным хранилищем."""
import concurrent.futures
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import server
server.RECORD_FILE = Path(sys.argv[2]) / 'data' / 'records.json'
httpd = server.create_server(port=0)
server.PORT = httpd.server_port
print(server.PORT, flush=True)
httpd.serve_forever()
"""


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.record = Path(self.temp.name) / 'data' / 'records.json'
        self.start_server()
        self.addCleanup(self.stop_server)

    def start_server(self):
        self.process = subprocess.Popen(
            [sys.executable, '-u', '-c', RUNNER, str(ROOT), self.temp.name],
            cwd=self.temp.name, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True,
        )
        self.port = int(self.process.stdout.readline())

    def stop_server(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdout.close()

    def request(self, method='GET', path='/api/record', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read(), dict(response.getheaders())
        finally:
            connection.close()

    def post(self, score):
        status, body, _ = self.request('POST', body=json.dumps({'score': score}),
                                       headers={'Content-Type': 'application/json'})
        return status, json.loads(body)

    def test_static_files(self):
        for name in ('index.html', 'app.js', 'style.css'):
            with self.subTest(name=name):
                status, body, headers = self.request(path='/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(body, (ROOT / name).read_bytes())
                self.assertIn('no-store', headers['Cache-Control'])

    def test_first_run_without_data_directory(self):
        self.assertEqual(json.loads(self.record.read_text()), {'bestScore': 0})
        status, body, _ = self.request()
        self.assertEqual((status, json.loads(body)), (200, {'bestScore': 0}))
        self.assertEqual(json.loads(self.record.read_text()), {'bestScore': 0})
        self.assertEqual(self.post(650), (200, {'bestScore': 650}))
        self.assertEqual(json.loads(self.record.read_text()), {'bestScore': 650})
        self.assertEqual(list(self.record.parent.glob('.record-*.tmp')), [])

    def test_restart_keeps_record(self):
        self.assertEqual(self.post(650), (200, {'bestScore': 650}))
        self.stop_server()
        self.start_server()
        status, body, _ = self.request()
        self.assertEqual((status, json.loads(body)), (200, {'bestScore': 650}))
        self.assertEqual(self.post(10), (200, {'bestScore': 650}))
        self.assertEqual(self.post(700), (200, {'bestScore': 700}))

    def test_invalid_requests_leave_record_unchanged(self):
        self.post(650)
        original = self.record.read_bytes()
        for payload in ('[]', 'null', '1', '"text"', '{}', '{', '',
                        '{"score": -1}', '{"score": true}', '{"score": 1.5}',
                        '{"score": "5"}', '{"score": 1000000001}', ' ' * 1025):
            with self.subTest(payload=payload[:50]):
                self.assertEqual(self.request('POST', body=payload)[0], 400)
                self.assertEqual(self.record.read_bytes(), original)

    def test_origin_and_unknown_route(self):
        payload = '{"score": 10}'
        self.assertEqual(self.request('POST', body=payload,
                         headers={'Origin': 'https://example.invalid'})[0], 403)
        self.assertEqual(self.request('POST', '/api/unknown', body=payload)[0], 404)
        for host in ('localhost', '127.0.0.1'):
            self.assertEqual(self.request('POST', body=payload,
                             headers={'Origin': f'http://{host}:{self.port}'})[0], 200)

    def test_concurrent_scores_keep_maximum(self):
        scores = [30, 650, 90, 700, 10, 200]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(self.post, scores))
        self.assertTrue(all(status == 200 for status, _ in responses))
        self.assertEqual(json.loads(self.record.read_text()), {'bestScore': 700})

    def test_manual_edit_is_read_without_restart(self):
        self.post(950)
        self.record.write_text('{"bestScore": 100}', encoding='utf-8')
        status, body, _ = self.request()
        self.assertEqual((status, json.loads(body)), (200, {'bestScore': 100}))
        self.assertEqual(self.post(50), (200, {'bestScore': 100}))
        self.stop_server()
        self.start_server()
        self.assertEqual(json.loads(self.request()[1]), {'bestScore': 100})

    def test_windows_utf8_bom(self):
        self.record.write_text('{"bestScore": 120}', encoding='utf-8-sig')
        self.assertEqual(json.loads(self.request()[1]), {'bestScore': 120})
        self.assertEqual(self.post(130), (200, {'bestScore': 130}))

    def test_deleted_record_is_recreated(self):
        self.post(950)
        self.record.unlink()
        self.assertEqual(json.loads(self.request()[1]), {'bestScore': 0})
        self.assertEqual(json.loads(self.record.read_text()), {'bestScore': 0})

    def test_corrupt_record_is_not_overwritten(self):
        self.record.parent.mkdir(exist_ok=True)
        for content in ('{', '{"bestScore": -1}', '{"bestScore": true}', '{"bestScore": 1000000001}', '{}'):
            with self.subTest(content=content):
                self.record.write_text(content, encoding='utf-8')
                self.assertEqual(self.request()[0], 500)
                self.assertEqual(self.post(100)[0], 500)
                self.assertEqual(self.record.read_text(), content)


if __name__ == '__main__':
    unittest.main()
