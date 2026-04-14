import json, sys, numpy as np
from sklearn.mixture import BayesianGaussianMixture
from sklearn.preprocessing import StandardScaler

with open(sys.argv[1]) as f:
    data = json.load(f)

family = data["family"]
vectors = data["vectors"]
n = len(vectors)

if n < 6:
    print(json.dumps({"k": 1, "weights": [1.0], "labels": [0] * n, "pk": {"1": 1.0}}))
    sys.exit(0)

X = np.array(vectors, dtype=float)
X = StandardScaler().fit_transform(X)

max_k = min(8, n // 3)

bgmm = BayesianGaussianMixture(
    n_components=max_k,
    covariance_type="diag",
    weight_concentration_prior_type="dirichlet_process",
    weight_concentration_prior=1.0 / max_k,
    max_iter=500,
    n_init=3,
    random_state=42,
)
bgmm.fit(X)

weights = bgmm.weights_
threshold = 1.0 / (max_k * 10)
active_mask = weights > threshold
active_k = int(active_mask.sum())
active_w = weights[active_mask]
active_w = (active_w / active_w.sum()).tolist()

raw_labels = bgmm.predict(X).tolist()
label_map: dict = {}
new_label = 0
remapped = []
for l in raw_labels:
    if l not in label_map:
        label_map[l] = new_label
        new_label += 1
    remapped.append(label_map[l])

pk: dict = {active_k: 0.75}
if active_k > 1:
    pk[active_k - 1] = 0.15
pk[active_k + 1] = 0.10

means = bgmm.means_[active_mask].tolist()

print(json.dumps({
    "k": active_k,
    "weights": active_w,
    "labels": remapped,
    "pk": {str(k): v for k, v in pk.items()},
    "means": means,
}))
