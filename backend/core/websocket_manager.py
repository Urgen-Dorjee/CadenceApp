import json
import time
from typing import Any

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.connections:
            self.connections.remove(websocket)

    async def send_job(self, job: dict[str, Any]):
        """Push the latest snapshot of a job to every connected window."""
        payload = json.dumps({"type": "job", "timestamp": time.time(), "job": job})
        dead = []
        for ws in self.connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_job_deleted(self, job_id: str):
        payload = json.dumps({"type": "job_deleted", "timestamp": time.time(), "job_id": job_id})
        for ws in list(self.connections):
            try:
                await ws.send_text(payload)
            except Exception:
                self.disconnect(ws)


manager = WebSocketManager()
