# 1. Base image: 용량이 매우 작은 slim 버전 사용 (약 40~50MB)
FROM python:3.11-slim

# 2. 파이썬 환경변수 설정 (경량화 및 로그 최적화)
# PYTHONDONTWRITEBYTECODE: .pyc 파일(캐시) 생성 방지 (용량 절약)
# PYTHONUNBUFFERED: 파이썬 출력을 버퍼링 없이 즉시 콘솔에 출력 (도커 로그 확인에 필수)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. 의존성 파일만 먼저 복사 (도커 레이어 캐싱 활용)
COPY requirements.txt .

# 5. 패키지 설치
# --no-cache-dir: pip 설치 후 찌꺼기 캐시 파일을 삭제하여 이미지 용량을 획기적으로 줄임
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 6. 실제 컨슈머 코드 복사
COPY consumer-mongodb.py .

# 7. (선택/권장) 보안을 위해 root가 아닌 일반 계정(appuser)으로 실행
RUN useradd -m appuser && chown -R appuser /app
USER appuser

# 8. 컨테이너 실행 시 기본 명령어
CMD ["python", "consumer-mongodb.py"]
