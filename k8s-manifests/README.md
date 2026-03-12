# ☸️ K8s Manifests

Helm Chart 및 Kubernetes 리소스 정의 파일 모음입니다.  
`mobility-app` Helm Chart를 통해 전체 애플리케이션을 단일 명령으로 배포합니다.

## 디렉토리 구조

```
k8s-manifests/
 ┣ mobility-app/                        # Helm Chart (배포 핵심)
 ┃  ┣ templates/
 ┃  ┃  ┣ command-deployment.yaml        # Ingest API + MongoDB Consumer
 ┃  ┃  ┣ query-deployment.yaml          # Query API + Redis Consumer
 ┃  ┃  ┣ frontend-deployment.yaml       # React 프론트엔드 (nginx)
 ┃  ┃  ┣ mongo.yaml                     # MongoDB StatefulSet + CronJob (TTL 정리)
 ┃  ┃  ┣ redis.yaml                     # Redis StatefulSet + CronJob (고아 키 정리)
 ┃  ┃  ┣ kafka.yaml                     # Kafka StatefulSet (KRaft 모드)
 ┃  ┃  ┣ ingress.yaml                   # Ingress 라우팅 규칙
 ┃  ┃  ┣ hpa.yaml                       # HorizontalPodAutoscaler
 ┃  ┃  ┣ secret.yaml                    # Secret 템플릿 (값은 외부 주입)
 ┃  ┃  └ configmap.yaml                 # 비민감 설정값
 ┃  ┣ values.yaml                       # 기본값 (이미지 태그 등)
 ┃  └ Chart.yaml
 ┣ nfs-storage.yaml                     # PersistentVolume (NFS)
 ┣ mobility-alert-rules.yaml            # PrometheusRule (알림 규칙)
 ┣ miniproject-servicemonitor.yaml      # ServiceMonitor
 ┣ miniproject-podmonitor.yaml          # PodMonitor
 ┣ monitoring-values.yaml               # kube-prometheus-stack Helm values
 └ mobility-monitoring-ingress.yaml     # Grafana / Prometheus / Alertmanager Ingress
```

## Helm 배포

### 최초 설치

```bash
helm install mobility-app k8s-manifests/mobility-app \
  -n miniproject --create-namespace \
  --wait --timeout 10m \
  -f secret-values.yaml
```

### 업데이트

```bash
helm upgrade mobility-app k8s-manifests/mobility-app \
  -n miniproject \
  --atomic --cleanup-on-fail \
  -f secret-values.yaml
```

### 상태 확인

```bash
helm status mobility-app -n miniproject
kubectl get pods -n miniproject
```

### 롤백

```bash
helm rollback mobility-app -n miniproject
```

> `secret-values.yaml`은 민감 정보가 포함되므로 **절대 Git에 커밋하지 마세요**.  
> 설정 방법은 `docs/secret-setup.md`를 참고하세요.

## 네트워크 구성

| 서비스 | 타입 | 포트 | 설명 |
| :--- | :--- | :--- | :--- |
| Ingress Controller | LoadBalancer | 80 / 443 | 외부 단일 진입점 |
| frontend-svc | NodePort | 30001 | 직접 접근 / 테스트용 |
| command-svc | ClusterIP | 80 | Ingest API |
| query-svc | ClusterIP | 80 | Query API |
| mongo-svc | ClusterIP | 27017 | MongoDB |
| redis-svc | ClusterIP | 6379 | Redis |
| kafka-svc | ClusterIP | 9092 | Kafka |

### Ingress 라우팅 규칙

| 경로 | 백엔드 |
| :--- | :--- |
| `/api/map/` | frontend-svc (VWorld proxy_pass) |
| `/api/query/telemetry` | command-svc |
| `/api/vehicles`, `/health`, `/api/health` | query-svc |
| `/` | frontend-svc |

## 스토리지 (NFS PersistentVolume)

`nfs-storage.yaml`에 NFS 볼륨이 정의되어 있습니다.

| DB | 컨테이너 경로 | NFS 경로 |
| :--- | :--- | :--- |
| MongoDB | `/data/db` | `/srv/nfs/mongo` |
| Redis | `/data` | `/srv/nfs/redis` |
| Kafka | `/tmp/kraft-combined-logs` | `/srv/nfs/kafka` |

NFS 서버: `10.0.2.100`

## HPA 설정

| 대상 | 기준 | min | max |
| :--- | :--- | :--- | :--- |
| Command API | CPU 50% | 2 | 10 |
| Query API | CPU 50% | 2 | 10 |

## CronJob

| 이름 | 주기 | 역할 |
| :--- | :--- | :--- |
| MongoDB TTL 정리 | 매 15분 | `telemetry_history`에서 7일 이전 데이터 삭제 |
| Redis 고아 키 정리 | 매 10분 | TTL 없는 `vehicle:*:latest` 키 삭제 |

## 모니터링

kube-prometheus-stack을 Helm으로 설치하고 `monitoring-values.yaml`을 적용합니다.

```bash
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f k8s-manifests/monitoring-values.yaml
```

알림 규칙은 `mobility-alert-rules.yaml`에 정의되어 있으며, 조건 충족 시 **Discord 웹훅**으로 전송됩니다.
