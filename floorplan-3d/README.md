# 3Д карта склада

Общая онлайн-карта на той же базе, что и 2Д stockmap (`/stockmap-api`).

- **Редактирование** — вид сверху (Konva): стены, окна, двери, стеллажи и др.
- **Просмотр 3Д** — Three.js сцена тех же объектов.

```bash
npm install
npm run dev   # :5175, base /floorplan-3d-app/
```

Нужны запущенные TaskMaster backend и stockmap-api (сессия cookie `session`).
