import os
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from fastapi import HTTPException, Request
from core.db import db, clean

JWT_ALGORITHM = "HS256"

ALL_ACTIONS = {"read", "create", "update", "delete", "progress", "link", "publish", "export", "admin"}
ROLE_ACTIONS = {
    "chef_projet": ALL_ACTIONS,
    "bim_manager": {"read", "create", "update", "link", "publish", "export"},
    "conducteur_travaux": {"read", "create", "update", "progress", "export"},
    "sous_traitant": {"read", "progress"},
    "lecteur": {"read"},
}
ROLE_LABELS = {
    "chef_projet": "Chef de projet", "bim_manager": "BIM manager", "conducteur_travaux": "Conducteur de travaux",
    "sous_traitant": "Sous-traitant", "lecteur": "Lecteur / observateur",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "refresh", "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def _jwt_decode(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Session expirée") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail="Jeton invalide") from e


def decode_token(token: str, expected_type: str) -> dict:
    payload = _jwt_decode(token)
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="Type de jeton invalide")
    return payload


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Non authentifié")
    payload = decode_token(token, "access")
    user = await db.users.find_one({"id": payload["sub"], "active": True})
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable ou désactivé")
    return clean(user)


async def authorize(user: dict, project_id: str, action: str) -> dict:
    """Server-side permission check for every project-scoped request."""
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
    if not project:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    if user.get("role") == "admin_plateforme":
        role_actions = ALL_ACTIONS
    else:
        m = await db.project_members.find_one({"project_id": project_id, "user_id": user["id"]})
        if not m:
            raise HTTPException(status_code=404, detail="Projet introuvable")
        role_actions = ROLE_ACTIONS.get(m["role"], set())
    if action not in role_actions:
        raise HTTPException(status_code=403, detail=f"Permission « {action} » refusée pour votre rôle sur ce projet")
    if action != "read" and project["status"] == "archive" and user.get("role") != "admin_plateforme":
        raise HTTPException(status_code=409, detail="Projet archivé : modification impossible")
    return clean(project)


async def project_role(user: dict, project_id: str) -> str:
    if user.get("role") == "admin_plateforme":
        return "admin_plateforme"
    m = await db.project_members.find_one({"project_id": project_id, "user_id": user["id"]})
    return m["role"] if m else None
