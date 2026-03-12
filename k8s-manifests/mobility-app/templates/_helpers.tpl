{{/*
Generate a checksum for secret-related chart values.
Used to force workload rollout when secrets are changed.
*/}}
{{- define "mobility-app.mobilitySecretChecksum" -}}
{{- toYaml .Values.secrets | sha256sum -}}
{{- end -}}
