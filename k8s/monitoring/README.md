# S12 — Monitoring (Prometheus/Grafana on k3s)

## Stack
[kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
via Helm — bundles Prometheus, Grafana, Alertmanager, kube-state-metrics, and
the Prometheus Operator with pre-built Kubernetes dashboards.

## Install

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.service.type=NodePort \
  --set grafana.service.nodePort=30300 \
  --set prometheus.service.type=NodePort \
  --set prometheus.service.nodePort=30900 \
  --set grafana.adminPassword=admin123
```

## node-exporter — disabled on WSL2

`node-exporter` mounts the host root filesystem to collect OS-level metrics
(disk, CPU, network at the host level). This fails on WSL2 specifically:
This is a WSL2 virtualization limitation, not a Kubernetes or Helm chart
issue — it works natively on a real Linux server (the planned production
target). Disabled here via:

```bash
kubectl delete daemonset -n monitoring monitoring-prometheus-node-exporter
```

**On a dedicated Ubuntu Server / EKS:** simply omit this delete step (or set
`prometheus-node-exporter.enabled=true`, the chart default) — no other
changes needed. Pod-level metrics (CPU/memory/network per pod, which is what
the self-healing demo and per-service dashboards rely on) come from
kube-state-metrics + cAdvisor (built into kubelet), unaffected by this.

## Access

Grafana: `grafana.local:30300` (admin / admin123 — change before any
production use)
Prometheus: `grafana.local:30900` *(verify correct hostname/port for direct
Prometheus UI access if needed — currently primary access is via Grafana)*

Hosts file entry (WSL2 IP changes on restart — see
`scripts/windows/update-wsl-hosts.ps1`, extend it to also cover
`grafana.local` for permanence):

```powershell
$wslIp = (wsl hostname -I).Trim().Split(" ")[0]
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "$wslIp grafana.local"
```

## Self-healing demo

Pre-built dashboards include "Kubernetes / Compute Resources / Namespace
(Pods)" — filter to the `biggshots` namespace to see live per-pod CPU,
memory, network, and storage metrics.

Demonstration (recorded 2026-06-20):

```bash
# Terminal 1 — watch
kubectl get pods -n biggshots -l app=auth-service -w

# Terminal 2 — kill a pod
kubectl delete pod -n biggshots auth-service-6f76b5cdcf-ggb98
```

Result: deleted pod → `Terminating` → new pod auto-created by the
ReplicaSet → `Pending` → `ContainerCreating` → `Running`, fully recovered
in **~13 seconds**, with zero manual intervention. The deployment
controller continued reconciling through a second cycle in the same test,
confirming continuous desired-state enforcement (not a one-off recreate).

This demonstrates the core Kubernetes self-healing guarantee: a Deployment's
ReplicaSet constantly works to match the live pod count to the declared
`replicas:` value.
