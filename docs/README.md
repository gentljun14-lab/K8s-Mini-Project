# 📚 Docs

프로젝트 운영에 필요한 참고 문서 모음입니다.

## 파일 목록

| 파일 | 설명 |
| :--- | :--- |
| `secret-setup.md` | Kubernetes Secret 생성 및 Helm values 설정 가이드 |
| `deploy.sh` | 수동 재배포 스크립트 (CI/CD 우회 시 사용) |

---

## secret-setup.md 요약

`mobility-secret` Kubernetes Secret에 들어가는 값들과 설정 방법을 안내합니다.

### 관리 대상 Secret 목록

| 키 | 설명 |
| :--- | :--- |
| `MONGO_INITDB_ROOT_USERNAME` | MongoDB root 계정명 |
| `MONGO_INITDB_ROOT_PASSWORD` | MongoDB root 비밀번호 |
| `MONGO_URI` | 인증 포함 MongoDB 접속 URI |
| `REDIS_PASSWORD` | Redis requirepass 비밀번호 |
| `VWORLD_API_KEY` | VWorld 지도 API 키 |

### secret-values.yaml 작성 예시

```yaml
# secret-values.yaml  ← 절대 Git에 커밋 금지 (.gitignore에 등록됨)
secret:
  mongoRootUsername: "admin"
  mongoRootPassword: "your_password"
  mongoUri: "mongodb://admin:your_password@mongo-svc:27017/car_db?authSource=admin"
  redisPassword: "your_redis_password"
  vworldApiKey: "your_vworld_api_key"
```

### Helm 배포 시 적용 방법

```bash
helm upgrade --install mobility-app k8s-manifests/mobility-app \
  -n miniproject --create-namespace \
  --atomic --cleanup-on-fail \
  -f secret-values.yaml
```

> **주의:** `secret-values.yaml`은 `.gitignore`에 등록되어 있습니다.  
> 팀원 간 공유 시 Git 대신 안전한 별도 채널(Vault, 1Password 등)을 사용하세요.

---

## deploy.sh 요약

CI/CD 없이 수동으로 재배포해야 할 때 사용합니다.

```bash
# 사용 예시
bash docs/deploy.sh
```

스크립트 내부 동작:

1. Harbor Registry 로그인
2. 각 서비스 Docker 이미지 빌드 및 Push
3. `helm upgrade --install --atomic` 실행
