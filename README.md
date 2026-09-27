# TON Nexus / Task Forge

Telegram Mini App: задания + майнер-контур + рулетки + ручные выводы TON.

## Документы (источник правды)

| Файл | Содержание |
|------|------------|
| [docs/CONCEPT.md](docs/CONCEPT.md) | Продукт, MVP, монетизация, стек, фазы |
| [docs/PROMPTS.md](docs/PROMPTS.md) | Правила дизайна, эталоны промптов для ИИ |
| [docs/TODO.md](docs/TODO.md) | Ближайшие задачи |

Notion (если есть) — архив; **новые решения писать сюда**.

## Стек (план)

- **Backend:** FastAPI, SQLAlchemy 2 async, PostgreSQL  
- **Frontend:** React 19, Vite, TypeScript, Tailwind, Framer Motion  
- **Bot:** тонкий слой + WebApp button  

## Принципы

1. Продуктовый UI, не шаблоны miner/casino.  
2. Вывод TON — только manual.  
3. Экономика в `economy_settings`.  
4. 1 слот майнера на MVP.  
5. Усиление на экране «Майнер», не отдельный tab.  
