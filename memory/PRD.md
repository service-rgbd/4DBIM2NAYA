# PRD — Chantier4D (SaaS de coordination de chantier BIM 4D)

## Original problem statement
MISSION : construire un véritable SaaS professionnel de gestion de chantier avec BIM 4D (cahier des charges complet en 24 sections : projets, rôles, documents, viewer IFC, BIM 4D relié au planning, Gantt professionnel, tâches/avancement, entreprises, réserves, rapports, réunions, coûts, notifications, audit, sécurité, tests, déploiement). Consigne finale de l'utilisateur : « Tout doit être basé sur la 4D BIM et pas autres… les inscriptions et autres peuvent attendre ».

## User choices
Stack disponible React + FastAPI + MongoDB ; connexion JWT avec admin pré-créé (pas d'inscription) ; web-ifc + Three.js ; IFC public d'exemple + projet DÉMO identifié ; périmètre : projets + Gantt (dépendances, chemin critique) + import IFC + viewer 3D + liaisons objet-activité (manuelle/règle) + simulation 4D prévu/réel.

## Architecture
- Backend FastAPI `/api/v1` : core (db, sécurité/permissions, audit, schémas), services (CPM scheduling, parseur IFC STEP pur Python, file de traitement IFC persistée, liaisons, seed), routers (auth, projects, tasks, bim). Fichiers IFC en GridFS + SHA-256.
- Frontend React : AppShell (sidebar/topbar/fil d'Ariane), pages Login, Projets, Vue d'ensemble, Planning Gantt, Maquettes BIM, Espace BIM 4D, Calendrier, Audit. Moteur Gantt maison, IfcEngine (Three + web-ifc IIFE/WASM depuis /wasm), logique 4D documentée `lib/sim4d.js`.

## User personas
Chef de projet, BIM manager, conducteur de travaux, sous-traitant (avancement), lecteur.

## Core requirements (static)
Données réelles persistées, permissions serveur, traçabilité, pas de faux traitement BIM, 4D réellement relié au planning.

## Implemented (2026-10-13)
- Auth JWT cookies httpOnly + refresh, anti-bruteforce, admin + lecteur seedés
- Projets : création, référence unique, statuts à transitions contrôlées, archivage en lecture seule, verrou optimiste
- Planning : CPM (FS/SS/FF/SF + décalage), calendrier ouvré + exceptions, marges, chemin critique, cycles refusés, prévisualisation d'impact avant déplacement, glisser/redimensionner, duplication, suppression logique, références (baselines), historique
- Avancement : relevés datés (pourcentage saisi), dates réelles, clôture < 100 % uniquement par exception tracée, courbe en S
- BIM : import IFC asynchrone (file persistée, 3 tentatives, reprise, relance), extraction GlobalId/étages/Psets/quantités/matériaux, versions, viewer 3D (orbite, cadrage, isolation, coupe, plein écran, arbre, catégories, propriétés)
- Liaisons : manuelles (sélection → activité), par règle avec prévisualisation, non liés, suppression de règle
- 4D : curseur temps, lecture/pause, pas jour/semaine/mois, modes Prévu/Réel/Écart, légende avec comptages, filtres lot/entreprise/zone, synchro Gantt ↔ modèle
- Audit paginé ; tests : 8 unitaires + 31 API (39/39) + Playwright E2E

## Code-review pass (2026-10-13)
- ifc_parser refactor (classe IfcIndex, parse_args découpé) — sortie identique vérifiée sur les 218 objets
- compute_schedule découpé (passe avant / arrière), update_task : helper de clôture, annotations de type
- Frontend : hooks Gantt (useGanttDrag, refs pour callbacks), IfcViewer (useIfcEngine/useEngineSync), ModelTree (StoreyNode/TypeNode), useMemo SidePanel/TaskSheet, suppression des eslint-disable
- 39/39 tests backend OK après refactor
- 2e passe : kpis/s_curve/dashboard extraits (dashboard_data), topo_order/compute_schedule découpés, décodage JWT et CPM sans variable ambiguë, contexte auth mémoïsé, Gantt (DependencyLayer, BaselineLayer), SidePanel (LinkActions), TaskSheet (SheetActions, TaskTabs), Bim4D (buildColorMap), correction réelle : tableaux `tasks`/`elements` recréés à chaque rendu

## Prioritized backlog
- P0 : invitations & gestion d'équipe/rôles par projet (UI), export PDF du planning/4D
- P1 : documents & plans 2D versionnés, réserves liées aux objets BIM, rapports journaliers, coordination entreprises/coactivité
- P1 : stockage S3/R2 via adaptateur, fédération multi-maquettes
- P2 : réunions, coûts (Decimal), notifications temps réel, IFCZIP/IFC-XML, DWG

## Next tasks
Réserves liées aux objets BIM ; export PDF/vidéo de la simulation 4D.
