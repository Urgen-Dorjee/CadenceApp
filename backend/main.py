import argparse
import re
import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from core import ytdlp_updates

# Before anything imports yt_dlp: use a newer yt-dlp from the data folder if there is one.
ytdlp_updates.activate(settings.data_dir)

from core.db import get_store
from core.websocket_manager import manager as ws_manager
from routers import jobs, library, system

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")
TOKEN_HEADER = "x-cadence-token"
_TOKEN_IN_TEXT = re.compile(r"(token=)[^\s\"'&]+")


class RedactTokenFilter(logging.Filter):
    """Keep the per-launch token out of log files (uvicorn logs WebSocket URLs with their query)."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "token=" in message:
            record.msg, record.args = _TOKEN_IN_TEXT.sub(r"\1[redacted]", message), ()
        return True


def install_log_redaction() -> None:
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactTokenFilter) for f in logger.filters):
            logger.addFilter(RedactTokenFilter())


install_log_redaction()


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.work_dir, exist_ok=True)
    get_store().recover_interrupted()
    print(f"[Backend] Starting on 127.0.0.1:{settings.backend_port}")
    # Pick up songs added, changed or deleted while the app was closed.
    scan_task = asyncio.create_task(library.scan_library())
    yield
    scan_task.cancel()
    print("[Backend] Shutting down...")


app = FastAPI(title="Cadence Backend", version="2.5.0", lifespan=lifespan)


def _token_ok(value: str | None) -> bool:
    return bool(value) and hmac.compare_digest(value, settings.cadence_token)


def _host_ok(host: str | None) -> bool:
    # Blocks DNS-rebinding: a malicious site can't reach us under its own hostname.
    allowed = {f"127.0.0.1:{settings.backend_port}", f"localhost:{settings.backend_port}"}
    return host in allowed


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    if not _host_ok(request.headers.get("host")):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    # <audio>/<img> can't send headers, so media URLs carry the token as a query parameter.
    token = request.headers.get(TOKEN_HEADER) or request.query_params.get("token")
    if not _token_ok(token):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


# Added after the auth middleware so it wraps it and answers CORS preflights first.
app.add_middleware(
    CORSMiddleware,
    # Electron's file:// pages send Origin "null" or "file://"; Vite dev runs on localhost.
    allow_origin_regex=r"^(null|file://.*|http://(localhost|127\.0\.0\.1):\d+)$",
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=[TOKEN_HEADER, "content-type"],
)

app.include_router(system.router, prefix="/api", tags=["system"])
app.include_router(jobs.router, prefix="/api", tags=["jobs"])
app.include_router(library.router, prefix="/api", tags=["library"])


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if not _host_ok(websocket.headers.get("host")) or not _token_ok(websocket.query_params.get("token")):
        await websocket.close(code=4401)
        return
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=settings.backend_port)
    args = parser.parse_args()
    settings.backend_port = args.port
    # No access log: request URLs carry the per-launch token, which must not end up in log files.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info", access_log=False)
