---
title: Helm values reference
description: Generated source-of-truth values for the OpenRUM Helm chart.
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

**Applies to:** Alpha / main. Generated verbatim from `deploy/helm/openrum/values.yaml`; do not edit by hand.

Use a separate values file for your environment and keep credentials in the configured existing Kubernetes Secret.

```yaml
imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

image:
  repository: ghcr.io/example/openrum
  tag: "0.1.0"
  pullPolicy: IfNotPresent

services:
  api: { replicas: 2, port: 8080, readyPath: /health/ready, livePath: /health/live, command: ["/app/api"], resources: { requests: { cpu: 200m, memory: 256Mi }, limits: { memory: 512Mi } } }
  ingest: { replicas: 3, port: 8081, readyPath: /health/ready, livePath: /health/live, command: ["/app/ingest"], resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { memory: 1Gi } } }
  consumer: { replicas: 2, port: 8082, readyPath: /health/ready, livePath: /health/live, command: ["/app/consumer"], resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { memory: 1Gi } } }
  worker: { replicas: 1, port: 8083, readyPath: /health/ready, livePath: /health/live, command: ["/app/worker"], resources: { requests: { cpu: 200m, memory: 256Mi }, limits: { memory: 512Mi } } }
  web: { replicas: 2, port: 8080, readyPath: /, livePath: /, command: ["/app/web"], resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { memory: 256Mi } } }

config:
  appEnv: production
  publicBaseURL: https://rum.example.com
  kafkaBrokers: kafka.example.svc:9092
  kafkaEventTopic: rum-events-v1
  redisAddress: redis.example.svc:6379
  objectStorage:
    # Optional: "oss" for Alibaba OSS native API or "s3" for Amazon S3 and compatible providers.
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

pdb:
  enabled: true
  minAvailable: 1

serviceMonitor:
  enabled: false
  interval: 30s
  labels: {}

prometheusRules:
  enabled: false
  labels: {}

migration:
  enabled: true
  image:
    # Empty values inherit the application image repository and tag.
    repository: ""
    tag: ""
    pullPolicy: IfNotPresent
  command: ["/app/migrate", "up", "all"]
  backoffLimit: 2
  activeDeadlineSeconds: 600

smokeTest:
  image: busybox:1.37

termination:
  gracePeriodSeconds: 30
  # Keep the process alive briefly while kube-proxy removes the terminating endpoint.
  preStopCommand: ["/bin/sh", "-c", "sleep 5"]

podAnnotations: {}
nodeSelector: {}
tolerations: []
affinity: {}
```
