# Deployment of Wren AI to Kubernetes with Kustomization
1. Ensure you satisfy the dependencies required to deploy Wren AI.
2. Adjust the values and manifests accordingly to fit your Kubernetes environment.
3. Deploy Secrets separately.
4. Deploy the inflated kustomized app.
Note: Without authentication, once you publish this on the internet, anyone can access your app, see your data, and modify your settings!

## Dependencies used in this kustomization:
- nginx.ingress
- external-dns
- cert-manager
- kubectl kustomize
- helm (for minikube)

## Steps to deploy:

`Suggestion`: Before deploying, check out the manifests in the `deployment/kustomizations ` folder and modify them for your Kubernetes environment.
The `deployment/kustomizations` folder contains a `kustomization.yaml` file that will inflate the manifests into a `deployment/kustomizations/wrenai.kustomized.yaml` file used to deploy the app to your Kubernetes cluster.

```shell
# Clone the repository with the kustomization
git clone https://github.com/Canner/WrenAI.git
cd WrenAI

# Inflate the manifest with kustomization
kubectl kustomize deployment/kustomizations --enable-helm > deployment/kustomizations/wrenai.kustomized.yaml

# Create namespace
kubectl create namespace wren

# !!!!!!!!!!!!
# MODIFY secret-wren_example.yaml manifest file FIRST
# LLM_OPENAI_API_KEY and EMBEDDER_OPENAI_API_KEY are REQUIRED: without a valid key the wren-ai-service-deployment pod will not start
# You must update PG_URL, otherwise wren-ui will not work
#vi deployment/kustomizations/examples/secret-wren_example.yaml
kubectl apply -f deployment/kustomizations/examples/secret-wren_example.yaml -n wren

# Deploy the app:
kubectl apply -f deployment/kustomizations/wrenai.kustomized.yaml

kubectl get pods -n wren
```

### Notes on kustomization:
- `deployment/kustomizations/kustomization.yaml` is the main file responsible for versions of other apps such as Qdrant and PostgreSQL, version of your Wren AI app. It also combines resourses from the manifest such as ConfigMaps, Deployments, and Services. And example Ingress, Certificates and Secrets.
- `deployment/kustomizations/base` is the base folder that contains the core Wren AI manifests, its less likely you need to modify them, but check just in case
- `deployment/kustomizations/examples` is a place with examples of manifests must take a look and adjust to your k8s environment and your needs.
- `deployment/kustomizations/examples/secret-wren_example.yaml` is the file you would not normally include in the kustomization file as its not a best practice and especially not a good idea to include in your GitOps repo as it contains cleartext passwords. We recommend to deploy it separately. Thant's why its commented in the `kustomization.yaml` file.
- `deployment/kustomizations/examples/wrenai-ingress-example.yaml` is an example of how to deploy Ingress. You can use this as a template for your own Ingress. It contains dependancy of extarnal-dns to add your dns name to your DNS records automatically, otherwise you'll need to add it manually. Also it assumes you are using nginx.ingress, it increases timeouts, disables the owasp and modsecurity that might be enabled globaly and prevent your UI from working properly. Comment the TLS section if you do not wish to use `https` encryption. Note: without authentication, enyone can acess your app, see your data and modify your settings!
- `deployment/kustomizations/examples/certificate-wren_example.yaml` is an example of how to deploy certificates for your ingress for the Wren-UI. You can use this as a template for your own certificate. It contains dependancy of cert-manager to add your certificates automatically, otherwise you'll need to add it manually. The certificate will be used by your Ingress.
- `deployment/kustomizations/examples/certificate-qdrant_example.yaml` is an example of how to deploy certificates for your ingress for Qdrant. This is included just in case and is not required, usually you would not be publishing your Vector Database publically in internet. That's why it's commented in the `kustomization.yaml` file. You can use this as a template for your own certificate. It contains dependancy of cert-manager to add your certificates automatically, otherwise you'll need to add it manually.
- `deployment/kustomizations/patches` folder is empty, feel free to add your own patches & overlays there.

#### Wren-UI Database
Starting with wren-ui version 0.6.0 by default the postgres database is used for wren-ui in this kubernetes kustomization and will be installed in the same namespace as wren-ai.
- `postgres`: Database that will be installed in the same namespace as wren-ai. You *must* update `PG_URL` in the Secret manifest `deployment/kustomizations/examples/secret-wren_example.yaml`.

Example: `PG_URL: "postgres://postgres:postgres@wrenai-postgresql:5432/admin_ui"`
- `postgres://`        This is the protocol. It tells the system that you’re connecting to a PostgreSQL database.
- `postgres:postgres`  These are the username(first) and password(second) for the database respectively, separated by a colon. In this case, both the username and password are “postgres”.
- `@wren-postgresql`   This is the hostname of the database server. "wren-postgresql" means the database server is running in a Kubernetes cluster and it is named "wren-postgresql" in the *same* namespace. If you are using another namespace you must provide the full hostname, example: `wren-postgresql.wrenai.svc.cluster.local`, "wrenai" is the namespace name, "svc.cluster.local" is the default domain name for Kubernetes services no need to change it.
- `:5432`              This is the port number. PostgreSQL servers listen on port 5432 by default.
- `/admin_ui`          This is the name of the database you’re connecting to. In this case, the database name is `admin_ui`. It can be found in the helm values file in the auth.database parameter `deployment/kustomizations/helm-values_postgresql_15.yaml`

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
In the [patches](./patches) folder you can find usefull kustomization examples files if you wish to use existing official kustomization directly from this repo as a base kustomization layer and only customize some values. It can be usefull for you GitOps workflow and can be used in conjunction with FlexCD or ArgoCD.
