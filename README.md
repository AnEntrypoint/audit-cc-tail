# audit-cc-tail

Detects how many distinct model variants Anthropic is serving behind each Claude family name (haiku / sonnet / opus) by clustering behavioral fingerprints extracted from your local Claude Code JSONL history.

Grows more accurate over time as more responses accumulate.

## How it works

1. **Ingest** — reads `~/.claude/projects/**/*.jsonl` (historical backfill + live watch), extracts a 10-dimensional feature vector per assistant response (token counts, cache ratio, stylometrics, stop reason)
2. **Cluster** — runs `sklearn.BayesianGaussianMixture` (Dirichlet process prior) per family; the number of active components = estimated distinct model variants
3. **Dashboard** — ANSI terminal view showing P(k) confidence gauge and traffic distribution per cluster

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Python ≥ 3.10 with `scikit-learn` and `numpy`
- Claude Code installed (provides `~/.claude/projects/`)

## Setup

```sh
bun install
python -m pip install scikit-learn numpy
```

If Python is not on `PATH`, set the path in `src/cluster.ts` (`PYTHON` constant).

## Usage

```sh
# one-time: apply schema
bun run migrate

# backfill history + watch for new responses (keep running)
bun run ingest

# run BGMM clustering once and print results
bun run cluster

# recalibrate automatically every hour
bun run cluster:watch

# live terminal dashboard (refreshes every 5s)
bun run dashboard
```

## Output example

```
SONNET  731 responses
  Detected models: 5  [updated 17:08:43]
  Confidence: P(4)=15%  P(5)=75%  P(6)=10%
  Traffic distribution:
    Model-1  ██████████░░░░░░░░░░  50.8%
    Model-2  █████░░░░░░░░░░░░░░░  23.8%
    ...

OPUS  160 responses
  Detected models: 7  [updated 17:08:46]
  Confidence: P(6)=15%  P(7)=75%  P(8)=10%
```

## Database

`audit.db` — libsql/SQLite local file. Tables:

| table | purpose |
|---|---|
| `responses` | one row per assistant message (model, tokens, timestamp) |
| `features` | 10-dim feature vector per response |
| `clusters` | latest BGMM result per family |
| `cluster_assignments` | cluster label per response |
| `cluster_history` | timestamped k estimates for drift tracking |

## Feature vector (10 dims)

`[output_tokens, input_tokens, cache_hit_ratio, text_len, avg_word_len, punct_density, markdown_density, unique_word_ratio, sentence_len_variance, stop_reason_code]`
