# 🗺️ Connected Car Dashboard (Frontend)

차량 실시간 위치 및 상태를 지도 위에 시각화하는 **React 웹 대시보드**입니다.

## 주요 기능

- VWorld 지도 위에 차량 위치 실시간 표시 (Leaflet 마커)
- 차량 클릭 시 상세 텔레메트리 정보 표시 (속도, SOC, 상태, 최근 이벤트 등)
- 차량 상태별 마커 색상 구분 (DRIVE / IDLE / PARK / CHARGE)
- 주기적 자동 갱신 (`GET /api/vehicles` 폴링)
- VWorld API 키 노출 없이 nginx proxy를 통해 지도 타일 요청

## 기술 스택

- React 19, TypeScript, Vite
- react-leaflet / Leaflet (지도 렌더링)
- nginx (정적 파일 서빙 + VWorld proxy_pass)

## 디렉토리 구조

```
frontend/
 ┣ src/
 ┃  ┣ App.tsx           # 루트 컴포넌트
 ┃  ┣ components/       # 지도, 마커, 패널 컴포넌트
 ┃  ┣ hooks/            # 데이터 페치 훅
 ┃  └ types/            # TypeScript 타입 정의
 ┣ nginx.conf           # nginx 설정 (VWorld proxy 포함)
 ┣ Dockerfile
 ┣ index.html
 ┣ vite.config.ts
 └ package.json
```

## 환경변수 (빌드 시)

| 변수 | 설명 |
| :--- | :--- |
| `VITE_QUERY_API_URL` | Query API 엔드포인트 (기본: `/api/vehicles`) |

> **VWorld API 키**는 브라우저에 노출되지 않습니다.  
> 브라우저는 `/api/map/tiles/{z}/{y}/{x}` 로 요청 → nginx가 `${VWORLD_API_KEY}` 를 주입해 VWorld로 proxy_pass 합니다.

## nginx VWorld Proxy 흐름

```
브라우저
  │  GET /api/map/tiles/{z}/{y}/{x}
  ▼
nginx (frontend Pod)
  │  proxy_pass → https://api.vworld.kr/req/wmts/1.0.0/{key}/Base/{z}/{y}/{x}.png
  │  (VWORLD_API_KEY 주입)
  ▼
VWorld 지도 타일 서버
```

## 로컬 개발

```bash
npm install
npm run dev          # http://localhost:5173
```

## 프로덕션 빌드

```bash
npm run build        # dist/ 생성
npm run preview      # 빌드 결과 미리보기
```

## Docker 빌드

```bash
docker build -t k8s-mini-frontend:local .
docker run \
  -e VWORLD_API_KEY=your_api_key \
  -p 3000:80 \
  k8s-mini-frontend:local
```

## K8s 리소스

| 리소스 | 값 |
| :--- | :--- |
| Deployment | `connected-car-frontend` |
| Service (NodePort) | `frontend-svc` → 30001 (직접 접근/테스트용) |
| Service (ClusterIP) | Ingress 경유 접근 (`/`) |
| VWORLD_API_KEY | `mobility-secret` Secret에서 nginx 환경변수로 주입 |
