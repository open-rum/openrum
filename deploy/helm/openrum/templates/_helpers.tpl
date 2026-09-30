{{- define "openrum.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "openrum.fullname" -}}
{{- if .Values.fullnameOverride }}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}{{ else }}{{ printf "%s-%s" .Release.Name (include "openrum.name" .) | trunc 63 | trimSuffix "-" }}{{ end }}
{{- end }}
{{- define "openrum.labels" -}}
app.kubernetes.io/name: {{ include "openrum.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}
{{- define "openrum.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openrum.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{- define "openrum.redisAddress" -}}
{{- if hasKey .Values.config "redisAddress" }}
{{- fail "config.redisAddress has moved: set redis.mode to \"external\" and redis.external.address to your Redis host:port, or remove it to use the bundled Redis." }}
{{- end }}
{{- if eq .Values.redis.mode "bundled" }}
{{- printf "%s-redis:6379" (include "openrum.fullname" .) }}
{{- else if eq .Values.redis.mode "external" }}
{{- required "redis.external.address is required when redis.mode is \"external\"" .Values.redis.external.address }}
{{- else }}
{{- fail (printf "redis.mode must be \"bundled\" or \"external\", got %q" .Values.redis.mode) }}
{{- end }}
{{- end }}
