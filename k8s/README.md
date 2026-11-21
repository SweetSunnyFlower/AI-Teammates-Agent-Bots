# Dotty on Kubernetes

This is the first local Kubernetes deployment. It targets a Minikube cluster
with one control-plane node and at least two worker nodes.

## Images

Build the application image on Docker Desktop, then load it into Minikube:

```bash
docker build \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  -t dotty-app:dev .

minikube image load dotty-app:dev
minikube image load postgres:16-alpine
minikube image load searxng/searxng:latest
```

## Local secret

Copy the example and fill in real values:

```bash
cp k8s/10-secret.example.yaml k8s/10-secret.yaml
```

`k8s/10-secret.yaml` is ignored by Git. Keep `SMTP_USER` and `EMAIL_FROM`
identical. The POSTGRES password must not contain unescaped URL characters.

## Apply in order

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-secret.yaml
kubectl apply -f k8s/20-configmap.yaml
kubectl apply -f k8s/30-postgres.yaml
kubectl wait -n dotty --for=condition=ready pod/dotty-postgres-0 --timeout=180s
kubectl apply -f k8s/40-searxng.yaml
kubectl apply -f k8s/50-migrate-job.yaml
kubectl wait -n dotty --for=condition=complete job/dotty-migrate --timeout=300s
kubectl apply -f k8s/60-web.yaml
kubectl apply -f k8s/70-worker.yaml
kubectl get pods -n dotty -o wide
```

## Access

```bash
kubectl port-forward -n dotty svc/dotty-web 3000:3000
```

Open <http://localhost:3000>.

## Debugging

```bash
kubectl get pods -n dotty -o wide
kubectl get pvc -n dotty
kubectl logs -n dotty deploy/dotty-web
kubectl logs -n dotty deploy/dotty-worker
kubectl logs -n dotty job/dotty-migrate
```

Code sandboxes are disabled in this first deployment. Set
`SANDBOX_ENABLED=false` in the ConfigMap until the sandbox is implemented as a
Kubernetes Job.

## Monitoring and logs

The application exposes Prometheus metrics at `/api/metrics`. The monitoring
stack runs with the official Docker images inside Minikube because the Docker
Desktop host cannot reach Minikube Pod IPs directly.

Create the local Grafana admin secret:

```bash
kubectl create secret generic dotty-grafana -n dotty \
  --from-literal=admin-password='change-me'
```

Apply the monitoring resources:

```bash
kubectl apply -f k8s/80-prometheus.yaml
kubectl apply -f k8s/81-loki.yaml
kubectl apply -f k8s/82-promtail.yaml
kubectl apply -f k8s/83-grafana.yaml
```

Open Grafana:

```bash
kubectl port-forward -n dotty svc/dotty-grafana 3001:3000
```

The provisioned `Dotty Overview` dashboard includes request rate, 5xx rate,
p95 latency, Web memory, Web CPU, and application logs. Prometheus is also
available with:

```bash
kubectl port-forward -n dotty svc/dotty-prometheus 9090:9090
```

Promtail tails `/var/log/pods/dotty_*/*/*.log` on every node, so it does not
depend on Kubernetes service discovery. Metrics and logs use `emptyDir` in this
first version; restarting the monitoring Pods loses retention history. Add PVCs
or an external store before treating this as a production monitoring setup.
