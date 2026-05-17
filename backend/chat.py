"""
chat.py
-------
ConnectionManager handles all live WebSocket connections.

FIX: Added connect_already_accepted() method — the original code referenced it
in main.py's random chat endpoint but never defined it, causing an AttributeError.
"""

from fastapi import WebSocket
from typing import Dict, List, Tuple, Optional

# ── GIFT COSTS (coins) ────────────────────────────────────────────────────────

GIFT_COSTS = {
    "rose":    10,
    "heart":   25,
    "star":    50,
    "diamond": 100,
    "crown":   500,
}


# ── CONNECTION MANAGER ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        # room_id → list of (websocket, user_id, username)
        self.active_connections: Dict[int, List[Tuple]] = {}

    async def connect(
        self,
        websocket: WebSocket,
        room_id: int,
        user_id: int,
        username: str,
    ):
        """Accept the WebSocket and register it in the room."""
        await websocket.accept()
        self._register(websocket, room_id, user_id, username)
        await self.broadcast(
            room_id,
            {"type": "user_joined", "username": username, "user_id": user_id},
            exclude_user=user_id,
        )

    async def connect_already_accepted(
        self,
        websocket: WebSocket,
        room_id: int,
        user_id: int,
        username: str,
    ):
        """
        Register an already-accepted WebSocket into a room.
        Used by random chat, where websocket.accept() was called earlier.
        FIX: This method was missing in the original code — random chat crashed.
        """
        self._register(websocket, room_id, user_id, username)

    def _register(self, websocket: WebSocket, room_id: int, user_id: int, username: str):
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append((websocket, user_id, username))

    def disconnect(self, websocket: WebSocket, room_id: int, user_id: int = None, username: str = None):
        """Remove this connection from the room."""
        if room_id in self.active_connections:
            self.active_connections[room_id] = [
                conn for conn in self.active_connections[room_id]
                if conn[0] is not websocket
            ]
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast(
        self,
        room_id: int,
        message: dict,
        exclude_user: Optional[int] = None,
    ):
        """Send a message to everyone in the room (optionally skip one user)."""
        if room_id not in self.active_connections:
            return

        dead = []
        for ws, uid, uname in self.active_connections[room_id]:
            if exclude_user is not None and uid == exclude_user:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)

        if dead:
            self.active_connections[room_id] = [
                conn for conn in self.active_connections[room_id]
                if conn[0] not in dead
            ]

    async def send_personal(self, websocket: WebSocket, message: dict):
        """Send a message to one specific WebSocket."""
        await websocket.send_json(message)

    def get_room_users(self, room_id: int) -> List[dict]:
        """Return list of users currently in a room."""
        if room_id not in self.active_connections:
            return []
        return [
            {"user_id": uid, "username": uname}
            for _, uid, uname in self.active_connections[room_id]
        ]


# ── SINGLETON ─────────────────────────────────────────────────────────────────
manager = ConnectionManager()
