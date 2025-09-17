# Deployment of Wren AI to Kubernetes with Helm Chart
1. Ensure you satisfy the dependencies required to deploy Wren AI.
2. Adjust the values accordingly to fit your Kubernetes environment.
3. Secrets vales can be deployed together or separately.
Note: Without authentication, once you publish this on the internet, anyone can access your app, see your data, and modify your settings!

## Dependencies used in this kustomization:
- nginx.ingress
- external-dns
- cert-manager
- kubectl
- helm 

## Steps to deploy:

`Suggestion`: Before deploying, check out the Helm values in the `deployment/helm ` file and modify them to suit your Kubernetes environment.

The `deployment/helm` folder contains a `values.yaml` file that will inflate the manifests into a `deployment/helm/template` files used to deploy the app to your Kubernetes cluster.

```shell
# Clone the repository with Helm chart
git clone https://github.com/Canner/WrenAI.git
cd WrenAI

# Create namespace
kubectl create namespace wren

# !!!!!!!!!!!!
# OPENAI_API_KEY or GEMINI_API_KEY is REQUIRED: without a valid key the wren-ai-service pod will not start
# You must update PG_URL, otherwise wren-ui will not work

# MODIFY/GENERATE values of secret and apply kubectl command to create secret (recommended for production)

# Generate secure passwords
OPENAI_API_KEY=<Paste OPENAI_API_KEY here>
PG_USERNAME=wrenai
PG_PASSWORD=$(openssl rand -base64 32)
PG_ADMIN_PASSWORD=$(openssl rand -base64 32)
PG_URL=postgres://wrenai-user:wrenai-pass@wren-postgresql:5432/wrenai
LANGFUSE_PUBLIC_KEY=<Paste LANGFUSE_PUBLIC_KEY here>
LANGFUSE_SECRET_KEY=<Paste LANGFUSE_SECRET_KEY here>
POSTHOG_API_KEY=<Paste POSTHOG_API_KEY here>
USER_UUID=$(openssl rand -base64 32)

kubectl create secret generic wren-secret \
  --from-literal=OPENAI_API_KEY=$OPENAI_API_KEY \
  --from-literal=PG_USERNAME=$PG_USERNAME \
  --from-literal=PG_PASSWORD=$PG_PASSWORD \
  --from-literal=PG_ADMIN_PASSWORD=$PG_ADMIN_PASSWORD \
  --from-literal=PG_URL=$PG_URL \
  --from-literal=LANGFUSE_PUBLIC_KEY=$LANGFUSE_PUBLIC_KEY \
  --from-literal=LANGFUSE_SECRET_KEY=$LANGFUSE_SECRET_KEY \
  --from-literal=POSTHOG_API_KEY=$POSTHOG_API_KEY \
  --from-literal=USER_UUID=$USER_UUID \
  -n wren


# Download Wren AI dependency charts like Qdrant or postgresql
helm dependency build ./deployment/helm

# Deploy Wren AI with Helm
helm upgrade --install wrenai ./deployment/helm \
  --namespace wren \
  -f deployment/helm/values.yaml \

kubectl get pods -n wren
```

### Notes on Helm:
- `deployment/helm/values.yaml` is the main file responsible for versions of other apps such as Qdrant and PostgreSQL, version of your Wren AI app. It also combines resourses from the manifest such as ConfigMaps, Deployments, and Services. And example Ingress and Secrets.
- `deployment/helm/template` is the manifests folder that contains the core Wren AI manifest templates, its less likely you need to modify them, but check just in case
- `deployment/helm/charts` is directory contains any dependent Helm charts (subcharts) required by Wren AI, such as PostgreSQL or Qdrant. These dependencies are either added manually or using `helm dependency add`, and they are used to deploy third-party services alongside Wren AI.
- `deployment/helm/Chart.yaml` This file defines the metadata for the Helm chart used to deploy Wren AI. It includes the chart name, version, application version, dependencies and a description. Helm uses this file to identify and manage the chart during installation and upgrades.

#### Wren-UI Database
Starting with wren-ui version 0.6.0 by default the postgres database is used for wren-ui in this helm chart and will be installed in the same namespace as wren-ai.
- `postgres`: Database that will be installed in the same namespace as wren-ai. You *must* update `PG_URL` in the Secret manifest.

Example: `PG_URL: "postgres://wrenai-user:wrenai-pass@wren-postgresql:5432/wrenai"`
- `postgres://`        This is the protocol. It tells the system that you’re connecting to a PostgreSQL database.
- `wrenai-user:wrenai-pass`  These are the username(first) and password(second) for the database respectively, separated by a colon. In this case, both the username and password are “postgres”.
- `@wren-postgresql`   This is the hostname of the database server. "wren-postgresql" means the database server is running in a Kubernetes cluster and it is named "wren-postgresql" in the *same* namespace. If you are using another namespace you must provide the full hostname, example: `wren-postgresql.wrenai.svc.cluster.local`, "wrenai" is the namespace name, "svc.cluster.local" is the default domain name for Kubernetes services no need to change it.
- `:5432`              This is the port number. PostgreSQL servers listen on port 5432 by default.
- `/wrenai`          This is the name of the database you’re connecting to. In this case, the database name is `wrenai`. It can be found in the helm values file in the auth.database parameter.

# Minikube
Prepare your k8s environment. Then use the `Steps to deploy` section to deploy Wren AI app into your k8s.
```shell
minikube start
minikube addons enable ingress
minikube addons enable metallb
minikube kubectl -- get nodes
minikube kubectl -- get pods -A

minikube update-context
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm install external-dns bitnami/external-dns
helm install \
  external-dns bitnami/external-dns \
  --namespace external-dns \
  --version 7.5.2 \
  --create-namespace \
  --set installCRDs=true
kubectl get pods -n external-dns

helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install \
  cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version v1.13.6 \
  --create-namespace \
  --set installCRDs=true
kubectl get pods -n cert-manager

##########
# Use the `Steps to deploy` section to continue as you would on a production k8s cluster.
```

# GitOps Patches
In the [patches](./patches) folder you can find usefull kustomization examples files if you wish to use existing official kustomization directly from this repo as a base kustomization layer and only customize some values. It can be usefull for you GitOps workflow and can be used in conjunction with FluxCD or ArgoCD.