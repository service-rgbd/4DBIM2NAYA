# Chantier4D — Coordination de chantier BIM 4D

## Stack réellement utilisée (environnement Emergent)
- Frontend : React 19 (CRA/craco, JavaScript), Tailwind, shadcn/ui, TanStack Query, React Hook Form + Zod, Recharts.
- 3D : Three.js 0.186 + web-ifc 0.0.78 (WASM mono-thread servi depuis `/wasm`, chargé à la demande).
- Gantt : moteur maison (`components/gantt/Gantt.jsx`) — glisser/redimensionner, dépendances FS/SS/FF/SF, chemin critique, référence.
- Backend : FastAPI (Python) — API REST versionnée `/api/v1`, OpenAPI sur `/api/docs`.
- Base : MongoDB (index uniques, suppression logique, verrou optimiste `version`). Fichiers IFC : GridFS (métadonnées séparées, SHA-256).
- Écart avec le cahier des charges : Node/TypeScript/PostgreSQL/Prisma/R2 ne sont pas disponibles dans cet environnement ;
  le stockage de fichiers est isolé dans `core/db.py` (`fs`) pour pouvoir être remplacé par un adaptateur S3.

## Architecture backend
- `core/` : connexion DB et index, sécurité (JWT cookies httpOnly, bcrypt, contrôle de permission par requête), audit, schémas Pydantic.
- `services/scheduling.py` : moteur CPM sur calendrier ouvré (contrainte « début au plus tôt », retards en jours ouvrés, marges, chemin critique, détection de cycles).
- `services/ifc_parser.py` : extracteur STEP pur Python (entités IfcElement, GlobalId, ID STEP, étages, Psets, quantités, matériaux, type, unités).
- `services/bim_worker.py` : file de traitement persistée en base (en_attente → traitement → prêt/échec), 3 tentatives, reprise après redémarrage, relance manuelle.
- `services/linking.py` : liaisons objet-activité (clé métier = GlobalId + maquette) et règles de liaison par propriétés.
- `routers/` : auth, projects (statuts à transitions contrôlées, calendrier, tableau de bord, audit), tasks (activités, avancement, dépendances, références), bim (maquettes, versions, éléments, liaisons, règles).

## Logique 4D (frontend `lib/sim4d.js`)
États calculés de façon déterministe depuis les données stockées. Prévu : dates CPM. Réel : dates réelles et statut, jamais extrapolé au-delà d'aujourd'hui. Écart : comparaison des rangs prévu/réel. La simulation n'écrit jamais en base.

## Permissions (vérifiées côté serveur)
chef_projet : tout · bim_manager : lecture, création, modification, liaison, publication · conducteur_travaux : lecture, création, modification, avancement · sous_traitant : lecture, avancement · lecteur : lecture. Un projet archivé est en lecture seule (sauf administrateur plateforme).

## Sauvegarde / restauration
- Sauvegarde : `mongodump --uri "$MONGO_URL" --db "$DB_NAME" --gzip --archive=backup-$(date +%F).gz` (inclut GridFS).
- Restauration : `mongorestore --uri "$MONGO_URL" --gzip --archive=backup-AAAA-MM-JJ.gz --nsInclude "$DB_NAME.*"`.

## Tests
`cd backend && python -m pytest tests -q` (moteur CPM, parseur STEP/IFC ; aucun accès base).

## Données de démonstration
Projet `DEMO-DUPLEX` marqué « DÉMO » : planning fictif + maquette publique « Duplex Apartment » (IFC2x3, buildingSMART/NIBS, via github.com/youshengCode/IfcSampleFiles).

## Non encore développé
Documents/plans 2D, rapports journaliers, réunions, coûts, invitations et gestion d'équipe, notifications temps réel, IFC-XML/IFCZIP, DWG/DXF, géométrie multi-modèles fédérée, antivirus.
Réserves (routers/issues.py) et rapport PDF 4D (services/report4d.py) sont disponibles depuis le 2026-10-14.
