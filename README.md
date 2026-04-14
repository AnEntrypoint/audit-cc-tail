# audit-cc-tail

Detects how many distinct model variants Anthropic is serving behind each Claude family name (haiku / sonnet / opus) by clustering behavioral fingerprints extracted from your local Claude Code JSONL history.

Clusters both **text responses** (stylometric features) and **tool-call responses** (structural features) separately — giving two independent signals per family.

Grows more accurate over time as more responses accumulate.

## How it works

1. **Ingest** — reads `~/.claude/projects/**/*.jsonl` (parallel backfill + live watch), classifies each response as `text`, `tool_use`, or `mixed`, extracts feature vectors for both text and tool content
2. **Cluster** — runs `sklearn.BayesianGaussianMixture` (Dirichlet process prior) per family × mode (text + tools); active component count = estimated distinct model variants
3. **Dashboard** — 3-column TUI (one panel per family) with scrollable sections, token analytics, model version progression, daily sparklines, and both text and tool cluster views

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Python ≥ 3.10 with `scikit-learn` and `numpy`
- Claude Code installed (provides `~/.claude/projects/`)

## Setup

```sh
bun install
python -m pip install scikit-learn numpy
```

If Python is not at `C:/Python312/python.exe`, update `PYTHON` in `src/cluster.ts`.

## Usage

```sh
bun start
```

Migrates the DB, then spawns ingest + cluster (hourly) + dashboard as child processes. Auto-restarts crashed workers. `Ctrl+C` kills all.

Individual commands:

```sh
bun run src/index.ts migrate     # apply schema only
bun run src/index.ts ingest      # backfill + watch
bun run src/index.ts cluster     # cluster once
bun run src/index.ts cluster --watch  # cluster hourly
bun run src/index.ts dashboard   # TUI dashboard
```

Dashboard keys: `tab` — switch panel focus | `j/k` — scroll | `q` — quit

## Database

`audit.db` — libsql/SQLite local file.

| table | purpose |
|---|---|
| `responses` | one row per assistant message — model, tokens, timestamp, response_type |
| `features` | 8-dim text feature vector per response |
| `tool_features` | 8-dim tool-call feature vector per tool_use/mixed response |
| `clusters` | latest text BGMM result per family |
| `clusters_tool` | latest tool BGMM result per family |
| `cluster_assignments` | text cluster label per response |
| `cluster_history` | timestamped text k estimates |
| `cluster_history_tool` | timestamped tool k estimates |

## Feature vectors

**Text (8 dims):** `[log(output_tokens), log(chars), avg_word_len, punct_density, markdown_density, unique_word_ratio, log(sent_len_variance), stop_reason_code]`

**Tool (8 dims):** `[tool_count, unique_tool_ratio, bash_ratio, read_ratio, edit_ratio, write_ratio, other_ratio, log(avg_input_size)]`
