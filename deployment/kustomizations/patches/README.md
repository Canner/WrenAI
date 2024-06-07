# Example of usefull Patches for Kustomization

Patches from this folder allows to utilize the official unmodified deployment/kustomization dirrectly from the repo as a base layer for your kustomization. And then add patches to update some values. This is usefull for your GitOps and can be combined with tools such as ArgoCD and FluxCD.

Patch ConfigMap, and Service if needed.
Remove Certificate and Ingress if not needed.