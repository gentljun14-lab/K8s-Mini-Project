# 1단계 - 빌드
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐싱 활용)
COPY package*.json ./
RUN npm ci

# 소스 복사 및 빌드
COPY . .
RUN npm run build

# 2단계 - 배포 (nginx)
FROM nginx:alpine

# 빌드 결과물 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# 타일 캐시 디렉터리 준비
RUN mkdir -p /var/cache/nginx/tiles && chown -R nginx:nginx /var/cache/nginx

# nginx.conf를 템플릿으로 복사 (envsubst가 환경변수 치환해줌)
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
