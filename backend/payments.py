"""
payments.py
-----------
Stripe payment logic.

HOW IT WORKS:
1. User picks a coin package → frontend calls /api/payments/create-intent
2. We ask Stripe to create a PaymentIntent → return client_secret to frontend
3. Frontend uses Stripe.js to collect card + confirm payment
4. Stripe calls our webhook when payment succeeds → we add coins to account
"""

import os
import stripe
from fastapi import HTTPException
from dotenv import load_dotenv

load_dotenv()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# Prices in cents (USD): 499 = $4.99
COIN_PACKAGES = {
    "starter": {"coins": 500,  "price": 499,  "label": "$4.99"},
    "popular": {"coins": 1200, "price": 999,  "label": "$9.99"},
    "value":   {"coins": 3000, "price": 1999, "label": "$19.99"},
    "mega":    {"coins": 8000, "price": 4999, "label": "$49.99"},
}


def create_payment_intent(package_id: str, user_id: int) -> dict:
    if package_id not in COIN_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid package ID")

    package = COIN_PACKAGES[package_id]

    if not stripe.api_key or stripe.api_key.startswith("sk_test_your"):
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured. Add STRIPE_SECRET_KEY to .env"
        )

    try:
        intent = stripe.PaymentIntent.create(
            amount=package["price"],
            currency="usd",
            metadata={
                "user_id":    str(user_id),
                "package_id": package_id,
                "coins":      str(package["coins"]),
            },
        )
        return {
            "client_secret": intent.client_secret,
            "amount":        package["price"],
            "coins":         package["coins"],
        }
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message))


def verify_webhook(payload: bytes, sig_header: str):
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")

    if not webhook_secret or webhook_secret.startswith("whsec_your"):
        raise HTTPException(
            status_code=503,
            detail="Stripe webhook secret not configured"
        )

    try:
        return stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
