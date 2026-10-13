# Auth testing
- Login: POST /api/v1/auth/login {"email":"admin@bim4d.fr","password":"Bim4D-Admin-2026"} → sets httpOnly cookies access_token/refresh_token (secure, samesite=none)
- GET /api/v1/auth/me with cookies → user; POST /api/v1/auth/refresh; POST /api/v1/auth/logout
- Bearer fallback: Authorization: Bearer <access_token cookie value>
- 5 failed attempts per ip+email → 429 for 15 min
- Read-only user: lecteur@bim4d.fr / Bim4D-Lecteur-2026 (role "lecteur" on DEMO-DUPLEX) → write calls must return 403
- No public registration endpoint (by design)
- mongosh: db.users.find({}, {email:1, role:1}) ; hashes start with $2b$
