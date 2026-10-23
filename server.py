from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os

PORT = 8767
os.chdir(Path(__file__).resolve().parent)

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm',
                      '.task': 'application/octet-stream'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

print(f'Локальный адрес: http://127.0.0.1:{PORT}  (остановить: Ctrl+C)')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
