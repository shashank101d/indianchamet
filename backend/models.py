"""
models.py
---------
Database tables as Python classes. SQLAlchemy creates these automatically.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, index=True, nullable=False)
    email         = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url    = Column(String(500), default="https://api.dicebear.com/7.x/thumbs/svg?seed=default")
    bio           = Column(Text, default="")
    coins         = Column(Integer, default=100)  # 100 free coins on signup
    is_online     = Column(Boolean, default=False)
    created_at    = Column(DateTime, server_default=func.now())

    messages_sent  = relationship("Message",     back_populates="sender",   foreign_keys="Message.sender_id")
    gifts_sent     = relationship("Gift",        back_populates="sender",   foreign_keys="Gift.sender_id")
    gifts_received = relationship("Gift",        back_populates="receiver", foreign_keys="Gift.receiver_id")
    transactions   = relationship("Transaction", back_populates="user")


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), nullable=False)
    topic      = Column(String(50), default="general")
    is_private = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    messages = relationship("Message", back_populates="room")


class Message(Base):
    __tablename__ = "messages"

    id         = Column(Integer, primary_key=True, index=True)
    content    = Column(Text, nullable=False)
    sender_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    room_id    = Column(Integer, ForeignKey("chat_rooms.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    sender = relationship("User",     back_populates="messages_sent", foreign_keys=[sender_id])
    room   = relationship("ChatRoom", back_populates="messages")


class Gift(Base):
    __tablename__ = "gifts"

    id          = Column(Integer, primary_key=True, index=True)
    gift_type   = Column(String(50), nullable=False)
    cost        = Column(Integer, nullable=False)
    sender_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at  = Column(DateTime, server_default=func.now())

    sender   = relationship("User", back_populates="gifts_sent",     foreign_keys=[sender_id])
    receiver = relationship("User", back_populates="gifts_received", foreign_keys=[receiver_id])


class Transaction(Base):
    __tablename__ = "transactions"

    id                = Column(Integer, primary_key=True, index=True)
    user_id           = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount_paid       = Column(Integer, nullable=False)   # cents
    coins_purchased   = Column(Integer, nullable=False)
    stripe_payment_id = Column(String(255), unique=True)
    status            = Column(String(50), default="pending")
    created_at        = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="transactions")
