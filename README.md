# TaskMaster

Суперапп-оболочка с мини-приложениями. Единый вход, главный экран с плитками.

## Мини-приложения

| Плитка | Путь | Статус |
|--------|------|--------|
| Менеджер задач | `/tasks` | live |
| Карта склада | `/stockmap` → `/stockmap-app/` | live |
| 3Д карта склада | `/floorplan-3d` → `/floorplan-3d-app/` | live |
| Справочник | `/reference` | live |
| Новости | `/news` | live |
| Заказы | `/apps/orders` | заглушка |

## Лист обновлений

Пользовательский changelog по дням: [`ОБНОВЛЕНИЯ.md`](ОБНОВЛЕНИЯ.md). Позже станет основой мини-приложения «Новости».

## Структура

```
task-manager/
├── backend/       Express + SQLite (задачи, auth)
├── frontend/      Vite + React + Tailwind (хаб + Task Manager)
├── stockmap/      Fastify + Konva (карта склада)
└── floorplan-3d/  Vite + Three.js (3Д план склада)
```

## Требования

- Node.js 22.5+

## Быстрый старт

### Backend (задачи)

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

http://localhost:3001

### Frontend (хаб)

```bash
cd frontend
npm install
npm run dev
```

http://localhost:5173 — проксирует `/api` → 3001 и `/stockmap-api` → 3002

### Карта склада

```bash
cd stockmap
npm install
npm run dev:server   # :3002
# отдельно при необходимости: npm run build && serve dist
```

### 3Д карта склада

```bash
cd floorplan-3d
npm install
npm run dev          # :5175, base `/floorplan-3d-app/`
```

Тестовый вход TaskMaster: `admin` / `admin123` (см. seed).

## Деплой

```bash
python deploy.py
```

Поднимает `task-manager-api` (3001), `stockmap-api` (3003), nginx отдаёт хаб, `/stockmap-app/` и `/floorplan-3d-app/`.
