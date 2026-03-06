# ☁️ K8s Mini Project

**현대오토에버 모빌리티스쿨 클라우드트랙 3기** 쿠버네티스 미니프로젝트 작업 공간입니다.

## 🗓️ 프로젝트 개요
- **진행 기간:** 2026.02.24 ~ 2026.03.13 (약 3주)
- **팀 구성:** 성윤, 중훈, 현준, 준태
- **핵심 목표:** 애플리케이션에 CQRS 패턴을 적용하고, K8s 클러스터 환경에 안정적으로 배포 및 운영하기.

<br>

## 🛠️ Tech Stack
- **Infrastructure:** Kubernetes, Docker, Docker Hub
- **Backend:** (Python, Fast API)
- **Database:** (MongoDB, Redis)
- **Collaboration:** GitHub, Notion, JIRA / Slack

<br>

## 🎯 핵심 구현 요구사항
- [x] **CQRS 패턴 적용:** Command(명령)와 Query(조회)의 책임 분리 및 아키텍처 설계
- [x] **Dockerizing:** 애플리케이션 이미지 빌드 및 Docker Hub 업로드
- [x] **K8s 배포 (Deployment):** 작성한 이미지를 기반으로 파드(Pod) 배포
- [x] **외부 통신 (Service):** LoadBalancer를 활용한 외부 포트 노출
- [x] **데이터 영속성 (Volume):** HostPath 등을 활용한 DB 데이터 볼륨 마운트 (경로 확보)
- [x] **설정 관리 (Config):** ConfigMap, Secret, Downward API 등을 활용한 유연한 환경 설정

<br>

## 🌐 포트 및 인프라 컨벤션 (규칙)
K8s 클러스터 내부 및 외부 통신을 위해 아래와 같이 네트워크와 포트를 구성했습니다. 보안과 운영 효율성을 위해 **Ingress를 활용한 단일 외부 진입점(API Gateway)** 패턴을 적용하였으며, 내부 서비스는 ClusterIP를 통해 안전하게 통신합니다.

| Service Name | Port (Type) | Description | 담당자 |
| :--- | :--- | :--- | :--- |
| **Ingress Controller** | `30080` (NodePort) | 외부 접속 통합 게이트웨이 (웹 및 `/api` 라우팅) | (이름 작성) |
| **Frontend** | `30001` (NodePort) | 커넥티드 카 관제 웹 인터페이스 (직접 접속/테스트용) | (이름 작성) |
| **Command API** | `80` (ClusterIP) | 데이터 수집(CUD) 및 차량 텔레메트리 이벤트 발행 | (이름 작성) |
| **Query API** | `80` (ClusterIP) | 데이터 조회(R) 및 차량 최신 상태 제공 처리 | (이름 작성) |
| **MongoDB** | `27017` (ClusterIP) | Command 서비스용 DB (텔레메트리 원본 데이터 영구 저장) | (이름 작성) |
| **Redis** | `6379` (ClusterIP) | Query 서비스용 DB (차량 최신 위치 인메모리 캐시) | (이름 작성) |
| **Kafka** | `9092` (ClusterIP) | Command-Query 간 데이터 동기화용 메시지 브로커 | (이름 작성) |

> 💡 **DB Volume Mount Path (컨테이너 내부 기준):** > - **MongoDB:** `/data/db` (차량 주행 이력 보관)
> - **Redis:** `/data` (실시간 차량 스냅샷 보관)
> *(호스트 노드의 실제 마운트 경로는 NFS 또는 HostPath PV 설정에 따름)*
<br>

## 📁 디렉토리 구조
```text
📦 K8s-Mini-Project
 ┣ 📂 k8s-manifests     # Kubernetes 배포를 위한 YAML 파일 모음 (Deployment, Service, ConfigMap 등)
 ┣ 📂 src-command       # Command API 소스 코드
 ┣ 📂 src-query         # Query API 소스 코드
 ┣ 📂 dummy-data
 ┣ 📂 frontend
 ┗ 📜 README.md
