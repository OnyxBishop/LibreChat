# websearch-helper

Lightweight RU-native sidecar for LibreChat web search. The upstream pipeline
(`@librechat/agents`) relies on firecrawl.dev (scraper) and api.jina.ai
(reranker), both unreachable from RU. This service impersonates both so the
agents package runs unchanged — wiring is done purely via `.env`.

## Endpoints

- `POST /v2/scrape` — Firecrawl-compatible. Fetches the page server-side,
  extracts the main content with Readability and converts it to markdown.
  Returns `{ success, data: { markdown, html, metadata } }`.
- `POST /rerank` — Jina-compatible. Forwards `{ query, documents, top_n }` to
  AiTunnel's native rerank endpoint (`rerank-4-fast` by default) and returns its
  response, which already matches the Jina result shape.
- `GET /health` — liveness + config sanity.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `AITUNNEL_BASE_URL` | `https://api.aitunnel.ru/v1` | AiTunnel base URL |
| `AITUNNEL_API_KEY` | — | Key used to call AiTunnel rerank |
| `RERANK_MODEL` | `rerank-4-fast` | AiTunnel rerank model |
| `SCRAPE_TIMEOUT_MS` | `8000` | Per-page fetch timeout |
| `SCRAPE_CONCURRENCY` | `3` | Max simultaneous scrapes (small-box guard) |
| `MAX_HTML_BYTES` | `5000000` | Hard cap on downloaded HTML |
| `MAX_CONTENT_CHARS` | `100000` | Hard cap on returned markdown |

## LibreChat wiring (`.env` of the API container)

```
FIRECRAWL_API_URL=http://websearch-helper:8787
JINA_API_URL=http://websearch-helper:8787/rerank
```

`FIRECRAWL_API_KEY` and `JINA_API_KEY` must stay non-empty (any placeholder) —
the agents package skips the call entirely when its key is empty. SearXNG
remains the search provider.
