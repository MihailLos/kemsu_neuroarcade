"""Локальный HTTP-сервер игры и файловое хранилище лучшего результата."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import tempfile
import threading

ROOT = Path(__file__).resolve().parent
PORT = 8767
RECORD_FILE = ROOT / 'data' / 'records.json'
lock = threading.Lock()
os.chdir(ROOT)


def read_best(record_file):
    if not record_file.exists():
        save_best(0, record_file)
        return 0
    # Редакторы Windows могут добавлять BOM в начало UTF-8-файла.
    data = json.loads(record_file.read_text(encoding='utf-8-sig'))
    score = data['bestScore']
    if type(score) is not int or not (0 <= score <= 1_000_000_000):
        raise ValueError('Некорректный рекорд')
    return score


def save_best(score, record_file):
    record_file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.record-', suffix='.tmp', dir=record_file.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump({'bestScore': score}, out, ensure_ascii=False, indent=2)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, record_file)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def survival_record_file():
    return RECORD_FILE.with_name('records_survival.json')


def record_file_for(path):
    route = urlsplit(path).path
    if route == '/api/record':
        return RECORD_FILE
    if route == '/api/record/survival':
        return survival_record_file()
    return None


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.task': 'application/octet-stream'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def reply_json(self, status, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        record_file = record_file_for(self.path)
        if record_file is not None:
            try:
                with lock:
                    best = read_best(record_file)
                return self.reply_json(200, {'bestScore': best})
            except Exception as exc:
                print('Ошибка чтения рекорда:', exc)
                return self.reply_json(500, {'error': 'Не удалось прочитать рекорд'})
        return super().do_GET()

    def do_POST(self):
        record_file = record_file_for(self.path)
        if record_file is None:
            return self.reply_json(404, {'error':'Не найдено'})
        origin = self.headers.get('Origin')
        if origin and origin not in (f'http://localhost:{PORT}', f'http://127.0.0.1:{PORT}'):
            return self.reply_json(403, {'error':'Недопустимый источник'})
        try:
            length = int(self.headers.get('Content-Length', '-1'))
            if not (0 < length <= 1024):
                return self.reply_json(400, {'error':'Некорректный размер запроса'})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                return self.reply_json(400, {'error':'Ожидается объект JSON'})
            score = data.get('score')
            if type(score) is not int or not (0 <= score <= 1_000_000_000):
                return self.reply_json(400, {'error':'Некорректный счёт'})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return self.reply_json(400, {'error':'Некорректные данные'})

        try:
            with lock:
                best = max(read_best(record_file), score)
                save_best(best, record_file)
            return self.reply_json(200, {'bestScore': best})
        except Exception as exc:
            print('Ошибка записи рекорда:', exc)
            return self.reply_json(500, {'error':'Не удалось сохранить рекорд'})


def create_server(host='127.0.0.1', port=PORT):
    httpd = ThreadingHTTPServer((host, port), Handler)
    try:
        with lock:
            read_best(survival_record_file())
    except Exception:
        httpd.server_close()
        raise
    return httpd


if __name__ == '__main__':
    httpd = create_server()
    print(f'Игра: http://127.0.0.1:{PORT} (завершить: Ctrl+C)', flush=True)
    httpd.serve_forever()
