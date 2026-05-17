"""
schemas.py
----------
Pydantic models: validate data IN and shape data OUT.
"""

from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime


# ── USER ─────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        if len(v) > 50:
            raise ValueError("Username must be 50 characters or less")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    avatar_url: str
    bio: str
    coins: int
    is_online: bool
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    username: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        if v is not None:
            v = v.strip()
            if len(v) < 3:
                raise ValueError("Username must be at least 3 characters")
            if len(v) > 50:
                raise ValueError("Username too long")
        return v


# ── MESSAGE ──────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    content: str
    room_id: int


class MessageResponse(BaseModel):
    id: int
    content: str
    sender_id: int
    sender_username: str
    room_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── GIFT ──────────────────────────────────────────────────────────────────────

class GiftSend(BaseModel):
    gift_type: str
    receiver_id: int


class GiftResponse(BaseModel):
    id: int
    gift_type: str
    cost: int
    sender_id: int
    receiver_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── PAYMENT ───────────────────────────────────────────────────────────────────

class PaymentIntent(BaseModel):
    package_id: str


# ── TOKEN ─────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
