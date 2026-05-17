"""
main.py
-------
Main FastAPI application. Run with: python main.py

FIXES applied vs original:
  1. lifespan handler instead of deprecated @app.on_event("startup")
  2. JWT sub stored/read as string (int caused decode failures)
  3. WebSocket token passed as query param (headers don't work in WS)
  4. stripe-signature header alias fixed (hyphen not underscore)
  5. manager.disconnect() called with correct args
  6. connect_already_accepted() now exists in chat.py
  7. CORS wildcard acceptable for dev; swap for real domain in prod
"""

from contextlib import asynccontextmanager
from fastapi import (
    FastAPI, Depends, HTTPException, WebSocket,
    WebSocketDisconnect, Request, Header,
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import Optional
from jose import jwt, JWTError

from database import engine, get_db, Base
from models import User, ChatRoom, Message, Gift, Transaction
from schemas import (
    UserCreate, UserLogin, UserResponse, UserUpdate,
    GiftSend, Token, PaymentIntent,
)
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, SECRET_KEY, ALGORITHM,
)
from chat import manager, GIFT_COSTS
from payments import create_payment_intent, verify_webhook, COIN_PACKAGES


# ── Startup ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    db = next(get_db())
    try:
        default_rooms = [
            ("General Chat",  "general"),
            ("Gaming",        "gaming"),
            ("Music",         "music"),
            ("Movies & TV",   "entertainment"),
            ("Random Talk",   "random"),
        ]
        for name, topic in default_rooms:
            if not db.query(ChatRoom).filter(ChatRoom.name == name).first():
                db.add(ChatRoom(name=name, topic=topic))
        db.commit()
    finally:
        db.close()

    yield


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="ChillChat API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Replace "*" with your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helper ───────────────────────────────────────────────────────────────────

def get_user_from_token(token: str, db: Session) -> Optional[User]:
    """Decode JWT from WebSocket query param. Returns None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
        return db.query(User).filter(User.id == user_id).first()
    except (JWTError, ValueError, TypeError):
        return None


# ═════════════════════════════════════════════════════════════════════════════
# AUTH
# ═════════════════════════════════════════════════════════════════════════════

@app.post("/api/signup", response_model=Token)
def signup(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    db_user = User(
        username=user.username,
        email=user.email,
        password_hash=hash_password(user.password),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    db_user.is_online = True
    db.commit()

    token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.is_online = False
    db.commit()
    return {"message": "Logged out successfully"}


@app.get("/api/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.put("/api/me", response_model=UserResponse)
def update_me(
    update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if update.username is not None:
        existing = db.query(User).filter(
            User.username == update.username,
            User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = update.username

    if update.bio is not None:
        current_user.bio = update.bio

    if update.avatar_url is not None:
        current_user.avatar_url = update.avatar_url

    db.commit()
    db.refresh(current_user)
    return current_user


# ═════════════════════════════════════════════════════════════════════════════
# ROOMS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/rooms")
def get_rooms(db: Session = Depends(get_db)):
    rooms = db.query(ChatRoom).filter(ChatRoom.is_private == False).all()
    return [{"id": r.id, "name": r.name, "topic": r.topic} for r in rooms]


@app.post("/api/rooms")
def create_room(
    name: str,
    topic: str = "general",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="Room name cannot be empty")
    room = ChatRoom(name=name.strip(), topic=topic)
    db.add(room)
    db.commit()
    db.refresh(room)
    return {"id": room.id, "name": room.name, "topic": room.topic}


@app.get("/api/rooms/{room_id}/messages")
def get_room_messages(
    room_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    messages = (
        db.query(Message)
        .filter(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":              m.id,
            "content":         m.content,
            "sender_id":       m.sender_id,
            "sender_username": m.sender.username,
            "created_at":      m.created_at.isoformat(),
        }
        for m in reversed(messages)
    ]


# ═════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — ROOM CHAT
# ═════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/chat/{room_id}")
async def websocket_chat(
    websocket: WebSocket,
    room_id: int,
    token: str,
    db: Session = Depends(get_db),
):
    user = get_user_from_token(token, db)
    if not user:
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, room_id, user.id, user.username)

    await manager.send_personal(websocket, {
        "type":  "room_users",
        "users": manager.get_room_users(room_id),
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "message":
                content = data.get("content", "").strip()
                if not content:
                    continue

                message = Message(content=content, sender_id=user.id, room_id=room_id)
                db.add(message)
                db.commit()
                db.refresh(message)

                await manager.broadcast(room_id, {
                    "type":            "message",
                    "id":              message.id,
                    "content":         content,
                    "sender_id":       user.id,
                    "sender_username": user.username,
                    "created_at":      message.created_at.isoformat(),
                })

            elif msg_type == "typing":
                await manager.broadcast(room_id, {
                    "type":     "typing",
                    "username": user.username,
                }, exclude_user=user.id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        await manager.broadcast(room_id, {
            "type":     "user_left",
            "username": user.username,
            "user_id":  user.id,
        })


# ═════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — RANDOM CHAT
# ═════════════════════════════════════════════════════════════════════════════

waiting_users: list = []


@app.websocket("/ws/random")
async def random_chat(
    websocket: WebSocket,
    token: str,
    db: Session = Depends(get_db),
):
    user = get_user_from_token(token, db)
    if not user:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    if waiting_users:
        partner_ws, partner_user = waiting_users.pop(0)

        room = ChatRoom(name=f"Private-{user.id}-{partner_user.id}", is_private=True)
        db.add(room)
        db.commit()
        db.refresh(room)

        await websocket.send_json({
            "type":    "matched",
            "partner": {"id": partner_user.id, "username": partner_user.username},
            "room_id": room.id,
        })
        await partner_ws.send_json({
            "type":    "matched",
            "partner": {"id": user.id, "username": user.username},
            "room_id": room.id,
        })

        # Register both into the new room without calling accept() again
        await manager.connect_already_accepted(websocket,  room.id, user.id,         user.username)
        await manager.connect_already_accepted(partner_ws, room.id, partner_user.id, partner_user.username)

        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "message":
                    content = data.get("content", "").strip()
                    if not content:
                        continue

                    message = Message(content=content, sender_id=user.id, room_id=room.id)
                    db.add(message)
                    db.commit()
                    db.refresh(message)

                    await manager.broadcast(room.id, {
                        "type":            "message",
                        "id":              message.id,
                        "content":         content,
                        "sender_id":       user.id,
                        "sender_username": user.username,
                        "created_at":      message.created_at.isoformat(),
                    })

                elif data.get("type") == "typing":
                    await manager.broadcast(room.id, {
                        "type":     "typing",
                        "username": user.username,
                    }, exclude_user=user.id)

        except WebSocketDisconnect:
            manager.disconnect(websocket, room.id)
            await manager.broadcast(room.id, {
                "type":    "partner_left",
                "message": f"{user.username} has left the chat.",
            })

    else:
        waiting_users.append((websocket, user))
        await websocket.send_json({"type": "waiting"})

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            waiting_users[:] = [(ws, u) for ws, u in waiting_users if ws is not websocket]


# ═════════════════════════════════════════════════════════════════════════════
# GIFTS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/gifts/types")
def get_gift_types():
    return [
        {"type": "rose",    "cost": 10,  "emoji": "🌹"},
        {"type": "heart",   "cost": 25,  "emoji": "❤️"},
        {"type": "star",    "cost": 50,  "emoji": "⭐"},
        {"type": "diamond", "cost": 100, "emoji": "💎"},
        {"type": "crown",   "cost": 500, "emoji": "👑"},
    ]


@app.post("/api/gifts/send")
def send_gift(
    gift: GiftSend,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if gift.gift_type not in GIFT_COSTS:
        raise HTTPException(status_code=400, detail="Invalid gift type")

    cost = GIFT_COSTS[gift.gift_type]

    if current_user.coins < cost:
        raise HTTPException(status_code=400, detail="Not enough coins")

    if gift.receiver_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot gift yourself")

    receiver = db.query(User).filter(User.id == gift.receiver_id).first()
    if not receiver:
        raise HTTPException(status_code=404, detail="User not found")

    db.add(Gift(
        gift_type=gift.gift_type,
        cost=cost,
        sender_id=current_user.id,
        receiver_id=receiver.id,
    ))
    current_user.coins -= cost
    db.commit()

    return {"message": f"Sent {gift.gift_type} to {receiver.username}!", "remaining_coins": current_user.coins}


# ═════════════════════════════════════════════════════════════════════════════
# PAYMENTS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/store/packages")
def get_packages():
    return [
        {"id": "starter", "coins": 500,  "price": "$4.99",  "price_cents": 499,  "popular": False},
        {"id": "popular", "coins": 1200, "price": "$9.99",  "price_cents": 999,  "popular": True},
        {"id": "value",   "coins": 3000, "price": "$19.99", "price_cents": 1999, "popular": False},
        {"id": "mega",    "coins": 8000, "price": "$49.99", "price_cents": 4999, "popular": False},
    ]


@app.post("/api/payments/create-intent")
def create_intent(
    payment: PaymentIntent,
    current_user: User = Depends(get_current_user),
):
    return create_payment_intent(payment.package_id, current_user.id)


@app.post("/api/payments/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),  # FIX: hyphen alias
    db: Session = Depends(get_db),
):
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    payload = await request.body()
    event   = verify_webhook(payload, stripe_signature)

    if event["type"] == "payment_intent.succeeded":
        intent  = event["data"]["object"]
        user_id = int(intent["metadata"]["user_id"])
        coins   = int(intent["metadata"]["coins"])

        user = db.query(User).filter(User.id == user_id).first()
        if user:
            user.coins += coins
            db.add(Transaction(
                user_id=user_id,
                amount_paid=intent["amount"],
                coins_purchased=coins,
                stripe_payment_id=intent["id"],
                status="completed",
            ))
            db.commit()

    return {"status": "success"}


# ═════════════════════════════════════════════════════════════════════════════
# RUN
# ═════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
