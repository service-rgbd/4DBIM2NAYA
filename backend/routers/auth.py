from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from core.db import db, clean
from core.schemas import LoginIn
from core.security import (create_access_token, create_refresh_token, decode_token, get_current_user, verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])
MAX_ATTEMPTS, LOCK_MINUTES = 5, 15


def _set_cookies(response: Response, user):
    response.set_cookie("access_token", create_access_token(user["id"], user["email"]), httponly=True, secure=True, samesite="none", max_age=900, path="/")
    response.set_cookie("refresh_token", create_refresh_token(user["id"]), httponly=True, secure=True, samesite="none", max_age=604800, path="/")


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    ident = f"{ip}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    now = datetime.now(timezone.utc)
    if att and att.get("locked_until") and datetime.fromisoformat(att["locked_until"]) > now:
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez dans 15 minutes.")
    user = await db.users.find_one({"email": email, "active": True})
    if not user or not verify_password(body.password, user["password_hash"]):
        count = (att or {}).get("count", 0) + 1
        upd = {"count": count}
        if count >= MAX_ATTEMPTS:
            upd = {"count": 0, "locked_until": (now + timedelta(minutes=LOCK_MINUTES)).isoformat()}
        await db.login_attempts.update_one({"identifier": ident}, {"$set": upd}, upsert=True)
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    await db.login_attempts.delete_many({"identifier": ident})
    _set_cookies(response, user)
    return clean(user)


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Session expirée")
    payload = decode_token(token, "refresh")
    user = await db.users.find_one({"id": payload["sub"], "active": True})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    _set_cookies(response, user)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", secure=True, samesite="none")
    response.delete_cookie("refresh_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user
