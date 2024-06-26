{{/*
Expand the name of the chart.
*/}}
{{- define "nebula.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "nebula.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "nebula.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "nebula.labels" -}}
helm.sh/chart: {{ include "nebula.chart" . }}
{{ include "nebula.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "nebula.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nebula.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "nebula.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "nebula.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Compute the maximum number of unavailable replicas for the PodDisruptionBudget.
*/}}
{{- define "nebula.pdb.maxUnavailable" -}}
{{- if eq (int .Values.replication.metad.replicas) 1 }}
{{- 0 }}
{{- else if .Values.disruptionBudget.maxUnavailable }}
{{- .Values.disruptionBudget.maxUnavailable }}
{{- else }}
{{- if eq (int .Values.replication.metad.replicas) 3 }}
{{- 1 }}
{{- else }}
{{- sub (div (int .Values.replication.metad.replicas) 2) 1 }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Generate dns address based endpoints for metad.
*/}}
{{- define "nebula.metad.endpoints" -}}
{{- $endpoints := list -}}
{{- $namesapce := .Release.Namespace -}}
{{- $thriftPort := .Values.port.metad.thriftPort | toString -}}
{{- $replicas := .Values.replication.metad.replicas | int -}}
{{- if .Values.hostNetwork }}
{{- join "," .Values.metadEndpoints }}
{{- else }}
{{- $name := print "nebula-metad" -}}
{{- range $i, $e := until $replicas }}
{{- $endpoints = printf "%s-%d.nebula-metad.%s.svc.cluster.local:%s" $name $i $namesapce $thriftPort | append $endpoints }}
{{- end }}
{{- join "," $endpoints }}
{{- end }}
{{- end }}

{{/*
Generate container command for metad.
*/}}
{{- define "nebula.metad.args" -}}
{{- $args := .Values.commandArgs.metad | first -}}
{{- $newArgs := list -}}
{{- $namesapce := .Release.Namespace -}}
{{- if .Values.hostNetwork }}
{{- $args = printf "%s --local_ip=$(hostname -i)" $args }}
{{- $newArgs = $args | quote | append $newArgs }}
{{- $newArgs }}
{{- else }}
{{- $args = printf "%s --local_ip=$(hostname).nebula-metad.%s.svc.cluster.local" $args $namesapce }}
{{- $newArgs = $args | quote | append $newArgs }}
{{- $newArgs }}
{{- end }}
{{- end }}

{{/*
Generate container command for storaged.
*/}}
{{- define "nebula.storaged.args" -}}
{{- $args := .Values.commandArgs.storaged | first -}}
{{- $newArgs := list -}}
{{- $namesapce := .Release.Namespace -}}
{{- if .Values.hostNetwork }}
{{- $args = printf "%s --local_ip=$(hostname -i)" $args }}
{{- $newArgs = $args | quote | append $newArgs }}
{{- $newArgs }}
{{- else }}
{{- $args = printf "%s --local_ip=$(hostname).nebula-storaged.%s.svc.cluster.local" $args $namesapce }}
{{- $newArgs = $args | quote | append $newArgs }}
{{- $newArgs }}
{{- end }}
{{- end }}
