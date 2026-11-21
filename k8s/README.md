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
