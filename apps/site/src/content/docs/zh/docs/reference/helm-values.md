---
title: Helm values 参考
description: OpenRUM Helm Chart 的权威默认值。
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

本页逐字来源于 `deploy/helm/openrum/values.yaml`。请为环境创建独立 values 文件，并把凭据放进 `existingSecret` 指向的 Kubernetes Secret。

```yaml
imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

image:
  repository: ghcr.io/openrum/openrum
  tag: "0.1.0"
  pullPolicy: IfNotPresent

services:
  api:
    { replicas: 2, port: 8080, readyPath: /health/ready, livePath: /health/live,
      command: ["/app/api"], resources: { requests: { cpu: 200m, memory: 256Mi, ephemeral-storage: 64Mi }, limits: { memory: 512Mi, ephemeral-storage: 256Mi } } }
  ingest:
    { replicas: 3, port: 8081, readyPath: /health/ready, livePath: /health/live,
      command: ["/app/ingest"], resources: { requests: { cpu: 500m, memory: 512Mi, ephemeral-storage: 64Mi }, limits: { memory: 1Gi, ephemeral-storage: 256Mi } } }
  consumer:
    { replicas: 2, port: 8082, readyPath: /health/ready, livePath: /health/live,
      command: ["/app/consumer"], resources: { requests: { cpu: 500m, memory: 512Mi, ephemeral-storage: 64Mi }, limits: { memory: 1Gi, ephemeral-storage: 256Mi } } }
  worker:
    { replicas: 1, port: 8083, readyPath: /health/ready, livePath: /health/live,
      command: ["/app/worker"], resources: { requests: { cpu: 200m, memory: 256Mi, ephemeral-storage: 64Mi }, limits: { memory: 512Mi, ephemeral-storage: 256Mi } } }
  web:
    { replicas: 2, port: 8080, readyPath: /, livePath: /, command: ["/app/web"],
      resources: { requests: { cpu: 100m, memory: 128Mi, ephemeral-storage: 64Mi }, limits: { memory: 256Mi, ephemeral-storage: 256Mi } } }

config:
  appEnv: production
  publicBaseURL: https://rum.example.com
  kafkaBrokers: kafka.example.svc:9092
  kafkaEventTopic: rum-events-v1
  kafkaRetentionDuration: 168h
  redisAddress: redis.example.svc:6379
  storagePressure:
    guardEnabled: true
    warningFreeRatio: "0.15"
    criticalFreeRatio: "0.10"
    hardStopFreeRatio: "0.05"
    recoveryFreeRatio: "0.10"
    emergencySampleRate: "0.10"
    pollInterval: 30s
  ingestTrustedProxies: ""
  geoCountryHeader: ""
  geoTrustedProxies: ""
  objectStorage:
    provider: ""
    endpoint: ""
    bucket: ""
    region: ""
    forcePathStyle: ""
    endpointAllowlist: ""
  managedSecrets:
    enabled: false
    masterKeyID: v1
  existingSecret: openrum-runtime
  secretKeys:
    postgresDSN: POSTGRES_DSN
    clickhouseDSN: CLICKHOUSE_DSN
    bootstrapToken: BOOTSTRAP_TOKEN
    ossAccessKeyID: OSS_ACCESS_KEY_ID
    ossAccessKeySecret: OSS_ACCESS_KEY_SECRET
    awsAccessKeyID: AWS_ACCESS_KEY_ID
    awsSecretAccessKey: AWS_SECRET_ACCESS_KEY
    awsSessionToken: AWS_SESSION_TOKEN
    managedSecretsMasterKey: OPENRUM_MASTER_KEY

ingress:
  enabled: true
  className: nginx
  annotations: {}
  host: rum.example.com
  tls: []

autoscaling:
  enabled: true
  targets:
    api: { minReplicas: 2, maxReplicas: 8, cpu: 70 }
    ingest: { minReplicas: 3, maxReplicas: 20, cpu: 65 }
    web: { minReplicas: 2, maxReplicas: 6, cpu: 70 }

pdb: { enabled: true, minAvailable: 1 }
serviceMonitor: { enabled: false, interval: 30s, labels: {} }
prometheusRules: { enabled: false, labels: {} }

migration:
  enabled: true
  image: { repository: "", tag: "", pullPolicy: IfNotPresent }
  command: ["/app/migrate", "up", "all"]
  backoffLimit: 2
  activeDeadlineSeconds: 600

smokeTest: { image: busybox:1.37 }
termination:
  gracePeriodSeconds: 30
  preStopCommand: ["/bin/sh", "-c", "sleep 5"]

podAnnotations: {}
nodeSelector: {}
tolerations: []
affinity: {}
```

字段语义、Secret 前置条件和生产示例见 [Kubernetes 与 Helm](/zh/docs/self-hosting/kubernetes/)。
