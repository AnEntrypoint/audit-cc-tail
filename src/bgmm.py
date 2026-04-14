import json, sys, numpy as np
from sklearn.mixture import BayesianGaussianMixture
from sklearn.preprocessing import StandardScaler

with open(sys.argv[1]) as f:
    data = json.load(f)

family = data["family"]
vectors = data["vectors"]
n = len(vectors)

if n < 6:
    print(json.dumps({"k": 1, "weights": [1.0], "labels": [0] * n, "pk": {"1": 1.0}, "means": [[0.0]]}))
    sys.exit(0)

X = np.array(vectors, dtype=float)
X = StandardScaler().fit_transform(X)

MAX_SAMPLES = 5000
if n > MAX_SAMPLES:
    rng = np.random.default_rng(42)
    idx = rng.choice(n, MAX_SAMPLES, replace=False)
    X = X[idx]
    n = MAX_SAMPLES

max_k = min(8, n // 20)
if max_k < 2:
    max_k = 2

ACTIVE_THRESHOLD = 0.05
N_SEEDS = 5
d = X.shape[1]

def fit_bgmm(k, seed):
    m = BayesianGaussianMixture(
        n_components=k,
        covariance_type="diag",
        weight_concentration_prior_type="dirichlet_process",
        weight_concentration_prior=1.0 / k,
        max_iter=300,
        n_init=1,
        random_state=seed,
    )
    m.fit(X)
    return m

def n_params_diag(active_k):
    return active_k * d + active_k * d + (active_k - 1)

def bic(model, active_k):
    return -2 * n * model.lower_bound_ + n_params_diag(active_k) * np.log(n)

# Fit all combinations; track per-seed best-k votes
all_runs = []
best_by_k = {}

for k in range(2, max_k + 1):
    for seed in range(N_SEEDS):
        try:
            m = fit_bgmm(k, seed * 17 + 3)
            active_k = int((m.weights_ > ACTIVE_THRESHOLD).sum())
            b = bic(m, active_k)
            all_runs.append({"k": k, "seed": seed, "model": m, "active_k": active_k, "bic": b, "elbo": m.lower_bound_})
            if k not in best_by_k or b < best_by_k[k]["bic"]:
                best_by_k[k] = {"model": m, "active_k": active_k, "bic": b, "elbo": m.lower_bound_}
        except Exception:
            continue

if not all_runs:
    print(json.dumps({"k": 1, "weights": [1.0], "labels": [0] * n, "pk": {"1": 1.0}, "means": [[0.0]]}))
    sys.exit(0)

# Per-seed: each seed votes for the best active_k it found across all k values
seed_votes = {}
for seed in range(N_SEEDS):
    seed_runs = [r for r in all_runs if r["seed"] == seed]
    if not seed_runs:
        continue
    best = min(seed_runs, key=lambda r: r["bic"])
    ak = best["active_k"]
    seed_votes[ak] = seed_votes.get(ak, 0) + 1

total_votes = sum(seed_votes.values())
pk = {k: round(v / total_votes, 4) for k, v in sorted(seed_votes.items()) if v / total_votes >= 0.01}

# Pick model: best BIC overall
best_run = min(all_runs, key=lambda r: r["bic"])
best_active_k = best_run["active_k"]
bgmm = best_run["model"]

weights = bgmm.weights_
active_mask = weights > ACTIVE_THRESHOLD
active_w = weights[active_mask]
active_w = (active_w / active_w.sum()).tolist()

raw_labels = bgmm.predict(X).tolist()
active_components = set(int(i) for i, keep in enumerate(active_mask) if keep)
label_map: dict = {}
new_label = 0
remapped = []
for l in raw_labels:
    if l not in label_map:
        label_map[l] = new_label if l in active_components else -1
        if l in active_components:
            new_label += 1
    remapped.append(label_map[l])

means = bgmm.means_[active_mask].tolist()

print(json.dumps({
    "k": best_active_k,
    "weights": active_w,
    "labels": remapped,
    "pk": {str(k): v for k, v in pk.items()},
    "means": means,
}))
