# Nebula Helm Chart

Nebula Graph Helm chart for Kubernetes

### Requirements

* Kubernetes >= 1.14
* [CoreDNS][] >= 1.6.0
* [Helm][] >= 3.2.0

## Get Repo Info

```console
helm repo add nebula-graph https://vesoft-inc.github.io/nebula-docker-compose/charts
helm repo update
```

_See [helm repo](https://helm.sh/docs/helm/helm_repo/) for command documentation._

## Install Chart

```console
# Helm 3
# helm install [NAME] [CHART] [flags]
$ helm install nebula nebula-graph/nebula --version
```

_See [configuration](#configuration) below._

_See [helm install](https://helm.sh/docs/helm/helm_install/) for command documentation._

## Uninstall Chart

```console
# Helm 3
$ helm uninstall nebula
```

## Configuration

See [Customizing the Chart Before Installing](https://helm.sh/docs/intro/using_helm/#customizing-the-chart-before-installing). To see all configurable options with detailed comments, visit the chart's [values.yaml](https://github.com/vesoft-inc/nebula-docker-compose/blob/master/charts/nebula/values.yaml), or run these configuration commands:

```console
# Helm 3
$ helm show values nebula-graph/nebula
```


[helm]: https://helm.sh
[coredns]: https://github.com/coredns/coredns