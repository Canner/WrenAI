# Deployment of WrenAI to k8s with kustomization
1. Make sure you sutisfy the dependancies we are using to deploy WrenAI.
2. Adjust the values and manifests accordingly to your k8s environment.
3. Deploy Secrets separetly.
4. Then deploy the inflated kustomized app.

Note: without authentication, once you publish this in the internet enyone can acess your app, see your data and modify your settings!
## Dependancies used in this kustomization:
- nginx.ingress
- external-dns
- cert-manager
- kubectl kustomize
- helm (for minikube)

## Steps to deploy:

- Before you deploy check out manifests in the `deployment/kustomizations` folder and modify them you your k8s environment.
The `deployment/kustomizations` folder contains a kustomization.yaml file that will inflate the manifests in to a `deployment/kustomizations/wrenai.kustimized.yaml` file used to deploy the app to your k8s.
```shell
# Clone the repository with the kustomization
git clone https://github.com/Canner/WrenAI.git
cd WrenAI

# Inflate the manifest with kustomization
kubectl kustomize deployment/kustomizations --enable-helm > deployment/kustomizations/wrenai.kustimized.yaml

# Create namespace
kubectl create namespace wren

# !!!!!!!!!!!!
# MODIFY secret-wren_example.yaml manifest file FIRST
# OPENAI_API_KEY is REQUIRED: without a valid key the wren-ai-service-deployment pod will not start
#vi deployment/kustomizations/examples/secret-wren_example.yaml
kubectl apply -f deployment/kustomizations/examples/secret-wren_example.yaml

# Deploy the app:
kubectl apply -f deployment/kustomizations/wrenai.kustimized.yaml

kubectl get pods -n wren
```

### Notes on kustomization:
- `deployment/kustomizations/kustomization.yaml` is the main file responsible for versions of other apps such as Qdrant and PostgreSQL, version of your WrenAI app. It also combines resourses from the manifest such as ConfigMaps, Deployments, and Services. And example Ingress, Certificates and Secrets.
- `deployment/kustomizations/base` is the base folder that contains the core WrenAI manifests, its less likely you need to modify them, but check just in case
- `deployment/kustomizations/examples` is a place with examples of manifests must take a look and adjust to your k8s environment and your needs.
- `deployment/kustomizations/examples/secret-wren_example.yaml` is the file you would not normally include in the kustomization file as its not a best practice and especially not a good idea to include in your GitOps repo as it contains cleartext passwords. We recommend to deploy it separately. Thant's why its commented in the `kustomization.yaml` file.
- `deployment/kustomizations/examples/wrenai-ingress-example.yaml` is an example of how to deploy Ingress. You can use this as a template for your own Ingress. It contains dependancy of extarnal-dns to add your dns name to your DNS records automatically, otherwise you'll need to add it manually. Also it assumes you are using nginx.ingress, it increases timeouts, disables the owasp and modsecurity that might be enabled globaly and prevent your UI from working properly. Comment the TLS section if you do not wish to use `https` encryption. Note: without authentication, enyone can acess your app, see your data and modify your settings!
- `deployment/kustomizations/examples/certificate-wren_example.yaml` is an example of how to deploy certificates for your ingress for the Wren-UI. You can use this as a template for your own certificate. It contains dependancy of cert-manager to add your certificates automatically, otherwise you'll need to add it manually. The certificate will be used by your Ingress.
- `deployment/kustomizations/examples/certificate-qdrant_example.yaml` is an example of how to deploy certificates for your ingress for Qdrant. This is included just in case and is not required, usually you would not be publishing your Vector Database publically in internet. That's why it's commented in the `kustomization.yaml` file. You can use this as a template for your own certificate. It contains dependancy of cert-manager to add your certificates automatically, otherwise you'll need to add it manually.
- `deployment/kustomizations/patches` folder is empty, feel free to add your own patches & overlays there.


# Minikube
Prepare your k8s environment. Then use the `Steps to deploy` section to deploy WrenAI app into your k8s.
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