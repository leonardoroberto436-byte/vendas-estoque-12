"""Servidor falso da API de Assinaturas do Mercado Pago — só para testes.

Rode o backend com MP_API_BASE=http://127.0.0.1:<porta> e MP_ACCESS_TOKEN /
MP_WEBHOOK_SECRET de teste; os testes sobem este servidor nessa porta e
controlam o "estado" do MP pelas rotas /_test/*.
"""

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE: dict = {"preapprovals": {}, "payments": {}, "calls": []}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # keep test output clean
        pass

    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}") if length else {}

    def _auth_ok(self) -> bool:
        return self.headers.get("Authorization", "").startswith("Bearer ")

    def do_POST(self):  # noqa: N802
        body = self._body()
        STATE["calls"].append(("POST", self.path, body))
        if self.path == "/preapproval":
            if not self._auth_ok():
                return self._send(401, {"message": "unauthorized"})
            token = body.get("card_token_id") or ""
            if token.startswith("recusado"):
                return self._send(400, {"message": "cc_rejected_insufficient_amount", "status": 400})
            pid = uuid.uuid4().hex[:16]
            item = {
                **body,
                "id": pid,
                "status": "authorized" if token else "pending",
                "next_payment_date": "2030-01-01T00:00:00.000-03:00" if token else None,
                "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={pid}",
            }
            STATE["preapprovals"][pid] = item
            return self._send(201, item)
        if self.path.startswith("/_test/preapproval/"):
            pid = self.path.rsplit("/", 1)[-1]
            STATE["preapprovals"].setdefault(pid, {"id": pid}).update(body)
            return self._send(200, STATE["preapprovals"][pid])
        if self.path == "/_test/payment":
            STATE["payments"][str(body["id"])] = body
            return self._send(200, body)
        return self._send(404, {"message": "not found"})

    def do_PUT(self):  # noqa: N802
        body = self._body()
        STATE["calls"].append(("PUT", self.path, body))
        if self.path.startswith("/preapproval/"):
            pid = self.path.rsplit("/", 1)[-1]
            item = STATE["preapprovals"].get(pid)
            if not item:
                return self._send(404, {"message": "not found"})
            for key, value in body.items():
                if isinstance(value, dict) and isinstance(item.get(key), dict):
                    item[key].update(value)
                else:
                    item[key] = value
            return self._send(200, item)
        return self._send(404, {"message": "not found"})

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/preapproval/"):
            item = STATE["preapprovals"].get(self.path.rsplit("/", 1)[-1])
            return self._send(200, item) if item else self._send(404, {"message": "not found"})
        if self.path.startswith("/authorized_payments/"):
            item = STATE["payments"].get(self.path.rsplit("/", 1)[-1])
            return self._send(200, item) if item else self._send(404, {"message": "not found"})
        if self.path == "/_test/state":
            return self._send(200, STATE)
        return self._send(404, {"message": "not found"})


def start(port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
