# Kubernetes Secret 설정 가이드

## 개요

민감한 설정 정보(DB 비밀번호, 외부 API 키 등)를 Kubernetes Secret으로 관리하고,
VWorld 지도 API 키를 프론트엔드 번들에서 제거하여 nginx proxy_pass 방식으로 전환한 작업을 정리합니다.

---

## 변경 전 문제점

| 문제 | 설명 |
|------|------|
| Secret namespace 불일치 | `secret.yaml`이 `default` namespace였으나 모든 Pod는 `miniproject`에 배포 → Secret이 실제로 주입되지 않음 |
| MONGO_URI 평문 노출 | 인증 정보가 포함될 URI가 ConfigMap(평문)에 저장됨 |
| MongoDB 인증 비활성화 | `--auth` 없이 실행, Secret의 username/password가 StatefulSet에 주입되지 않음 |
| Redis 인증 비활성화 | `--requirepass` 없이 실행, 비밀번호 없이 누구나 접속 가능 |
| VWorld API 키 번들 포함 | Vite 빌드 시 `VITE_VWORLD_API_KEY`가 JS 번들에 포함되어 브라우저에 노출 |

---

## VWorld API 키 처리 방식

### 왜 nginx proxy_pass를 선택했는가

| 방식 | 설명 | 문제 |
|------|------|------|
| 프론트엔드 직접 호출 | 브라우저가 vworld API를 직접 호출 | API 키가 JS 번들 및 네트워크 탭에 노출 |
| query-api 프록시 | 브라우저 → query-api → vworld | 지도 타일 요청이 백엔드 Pod를 경유 → 레이턴시 누적, 백엔드 부하 |
| **nginx proxy_pass** (채택) | 브라우저 → frontend nginx → vworld | 백엔드 부하 없음, API 키 비노출 |

### 요청 흐름

```
브라우저 → GET /api/map/tiles/10/5/3
  → Ingress (/ → frontend-svc 매칭)
  → frontend Pod (nginx)
  → location /api/map/ 매칭
  → rewrite → /req/wmts/1.0.0/{KEY}/Base/10/5/3.png
  → proxy_pass https://api.vworld.kr
```

브라우저 네트워크 탭에는 `/api/map/tiles/...`만 보이며 API 키는 노출되지 않습니다.

### envsubst 치환 동작

`nginx:alpine` 이미지는 `/etc/nginx/templates/` 디렉터리의 파일을 시작 시 자동으로 `envsubst` 처리합니다.
`Dockerfile`이 이미 `nginx.conf`를 해당 경로에 복사하고 있어 별도 CMD 수정 없이 동작합니다.

```
Secret (VWORLD_API_KEY)
  ↓ env 주입
frontend Pod 시작
  ↓ nginx entrypoint가 envsubst 실행
nginx.conf 내 ${VWORLD_API_KEY} → 실제 키로 치환
  ↓
nginx 프로세스 시작
```

---

## 변경 파일 목록

```
k8s-manifests/
├── secret.yaml              # namespace 수정, MONGO_URI·VWORLD_API_KEY 추가
├── configmap.yaml           # MONGO_URI 제거 (Secret으로 이동)
├── mongo.yaml               # StatefulSet에 --auth 및 Secret 주입, CronJob에 MONGO_URI 주입
├── redis.yaml               # StatefulSet에 --requirepass 및 Secret 주입, CronJob에 REDISCLI_AUTH 주입
├── command-deployment.yaml  # command-consumer에 MONGO_URI Secret 주입
├── query-deployment.yaml    # query-api·query-consumer에 REDIS_PASSWORD Secret 주입
└── frontend-deployment.yaml # VWORLD_API_KEY Secret 주입 추가

frontend/
├── nginx.conf               # /api/map/ proxy_pass location 블록 추가
└── src/components/
    └── VehicleMap.tsx       # 직접 API 호출 → 프록시 경유로 변경
```

---

## 상세 변경 내용

### 1. `k8s-manifests/secret.yaml`

**변경 사항:**
- `namespace: default` → `namespace: miniproject`
- `MONGO_URI` 추가 (인증 정보 포함)
- `REDIS_PASSWORD` 실제 값 설정
- `VWORLD_API_KEY` 추가

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mobility-secret
  namespace: miniproject        # default → miniproject 수정
  labels:
    app: connected-car
type: Opaque
stringData:
  # MongoDB 인증 정보
  MONGO_INITDB_ROOT_USERNAME: "admin"
  MONGO_INITDB_ROOT_PASSWORD: "****"
  MONGO_URI: "mongodb://admin:****@mongo-svc:27017"

  # Redis 비밀번호
  REDIS_PASSWORD: "****"

  # VWorld 지도 API 키 (nginx proxy_pass 경유)
  VWORLD_API_KEY: "****"
```

> **주의:** `secret.yaml`을 git에 커밋하지 않도록 `.gitignore`에 추가하거나
> `kubectl create secret` 명령으로 직접 생성하는 것을 권장합니다.

---

### 2. `k8s-manifests/configmap.yaml`

**변경 사항:** `MONGO_URI` 제거 → Secret으로 이동

```yaml
# 변경 전
  # --- MongoDB ---
  MONGO_URI: "mongodb://mongo-svc:27017"   # 제거
  MONGO_DB: "car_db"

# 변경 후
  # --- MongoDB ---
  MONGO_DB: "car_db"
```

---

### 3. `k8s-manifests/mongo.yaml`

**변경 사항 1 - StatefulSet: 인증 활성화 및 Secret 주입**

```yaml
# 변경 전
containers:
- name: mongo
  image: mongo:7
  args: ["--wiredTigerCacheSizeGB", "0.25"]

# 변경 후
containers:
- name: mongo
  image: mongo:7
  args: ["--auth", "--wiredTigerCacheSizeGB", "0.25"]   # --auth 추가
  env:
    - name: MONGO_INITDB_ROOT_USERNAME
      valueFrom:
        secretKeyRef:
          name: mobility-secret
          key: MONGO_INITDB_ROOT_USERNAME
    - name: MONGO_INITDB_ROOT_PASSWORD
      valueFrom:
        secretKeyRef:
          name: mobility-secret
          key: MONGO_INITDB_ROOT_PASSWORD
```

**변경 사항 2 - CronJob: MONGO_URI Secret 주입**

```yaml
env:
  - name: MONGO_URI
    valueFrom:
      secretKeyRef:
        name: mobility-secret
        key: MONGO_URI
```

> **주의:** `--auth` 추가 후 기존 PVC에 데이터가 있다면 root 계정이 자동 생성되지 않습니다.
> 신규 배포 시에는 기존 PVC를 삭제 후 재배포해야 합니다.

---

### 4. `k8s-manifests/redis.yaml`

**변경 사항 1 - StatefulSet: 비밀번호 인증 활성화 및 Secret 주입**

`args`로는 환경변수를 참조할 수 없으므로 `command`로 변경하여 `$REDIS_PASSWORD`를 `--requirepass`에 주입합니다.

```yaml
# 변경 전
args:
  - "--save"
  - ""
  - "--appendonly"
  - "no"
  - "--maxmemory"
  - "256mb"
  - "--maxmemory-policy"
  - "allkeys-lru"

# 변경 후
command:
  - "sh"
  - "-c"
  - "redis-server --requirepass \"$REDIS_PASSWORD\" --save '' --appendonly no --maxmemory 256mb --maxmemory-policy allkeys-lru"
env:
  - name: REDIS_PASSWORD
    valueFrom:
      secretKeyRef:
        name: mobility-secret
        key: REDIS_PASSWORD
```

**변경 사항 2 - CronJob: REDISCLI_AUTH Secret 주입**

`REDISCLI_AUTH` 환경변수는 redis-cli가 자동으로 비밀번호로 사용합니다. 스크립트 수정 없이 인증이 적용됩니다.

```yaml
env:
  - name: REDIS_HOST
    value: "redis-svc"
  - name: REDIS_PORT
    value: "6379"
  - name: REDISCLI_AUTH          # 추가
    valueFrom:
      secretKeyRef:
        name: mobility-secret
        key: REDIS_PASSWORD
```

---

### 5. `k8s-manifests/command-deployment.yaml`

**변경 사항:** command-consumer의 `MONGO_URI`를 ConfigMap → Secret에서 주입

```yaml
env:
  - name: KAFKA_GROUP_ID
    valueFrom:
      configMapKeyRef:
        name: mobility-config
        key: KAFKA_GROUP_ID_COMMAND
  - name: MONGO_URI
    valueFrom:
      secretKeyRef:
        name: mobility-secret
        key: MONGO_URI
```

---

### 6. `k8s-manifests/query-deployment.yaml`

**변경 사항:** query-api와 query-consumer 모두 `REDIS_PASSWORD` Secret 주입

```yaml
# query-api 컨테이너 env에 추가
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: mobility-secret
      key: REDIS_PASSWORD

# query-consumer 컨테이너 env에 추가
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: mobility-secret
      key: REDIS_PASSWORD
```

---

### 7. `k8s-manifests/frontend-deployment.yaml`

**변경 사항:** `VWORLD_API_KEY` Secret 주입 추가 (nginx envsubst 치환에 사용)

```yaml
env:
  - name: VWORLD_API_KEY
    valueFrom:
      secretKeyRef:
        name: mobility-secret
        key: VWORLD_API_KEY
```

---

### 8. `frontend/nginx.conf`

**변경 사항:** `/api/map/` location 블록 추가

nginx는 더 구체적인 경로를 우선 매칭하므로 `/api/map/`이 `/api/` 보다 먼저 처리됩니다.

```nginx
# 추가 (location /api/ 보다 앞에 선언)
location /api/map/ {
    rewrite ^/api/map/tiles/(.*)$ /req/wmts/1.0.0/${VWORLD_API_KEY}/Base/$1.png break;
    proxy_pass https://api.vworld.kr;
    proxy_ssl_server_name on;
}

location /api/ {
    proxy_pass ${QUERY_API_URL}/api/;   # 기존 유지
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

### 9. `frontend/src/components/VehicleMap.tsx`

**변경 사항:** 브라우저 직접 호출 → nginx 프록시 경유로 변경

```typescript
// 변경 전
const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const VWORLD_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`

url={VWORLD_KEY ? VWORLD_URL : DEFAULT_TILE_URL}

// 변경 후
const TILE_URL = '/api/map/tiles/{z}/{y}/{x}'

url={TILE_URL}
```

---

## Secret 분류 기준

| 항목 | 분류 | 근거 |
|------|------|------|
| `MONGO_INITDB_ROOT_USERNAME/PASSWORD` | Secret | DB 인증 자격증명 |
| `MONGO_URI` | Secret | 비밀번호가 URI에 포함 |
| `REDIS_PASSWORD` | Secret | DB 인증 자격증명 |
| `VWORLD_API_KEY` | Secret | 외부 서비스 API 키 |
| Kafka 브로커 주소/토픽 | ConfigMap | 인증 없는 연결 정보 |
| Redis host/port | ConfigMap | 인증 정보 아님 |
| MongoDB DB명/컬렉션명 | ConfigMap | 민감 정보 아님 |

---

## 배포 순서

```bash
# 1. Secret 먼저 적용 (Pod가 참조하므로 선행 필요)
kubectl apply -f k8s-manifests/secret.yaml

# 2. ConfigMap 적용
kubectl apply -f k8s-manifests/configmap.yaml

# 3. DB 재배포
#    MongoDB: 기존 PVC가 있으면 삭제 후 재배포해야 root 계정 생성됨
#    Redis: 기존 PVC가 있어도 command 변경만으로 비밀번호 적용됨
kubectl apply -f k8s-manifests/mongo.yaml
kubectl apply -f k8s-manifests/redis.yaml

# 4. 나머지 배포
kubectl apply -f k8s-manifests/command-deployment.yaml
kubectl apply -f k8s-manifests/query-deployment.yaml
kubectl apply -f k8s-manifests/frontend-deployment.yaml
kubectl apply -f k8s-manifests/ingress.yaml
```
