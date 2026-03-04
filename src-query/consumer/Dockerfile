# 1. 베이스 이미지 설정
FROM python:3.12-slim

# 2. 작업 디렉터리 설정
WORKDIR /app

# 3. 환경 변수 설정 (파이썬 최적화 및 경로 설정)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# 4. 종속성 설치 (레이어 캐싱 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. 소스 코드 복사
# 현재 폴더(consumer)의 모든 파일을 컨테이너의 /app으로 복사
COPY . .

# 6. 실행 명령 (Consumer 진입점)
# API와 달리 포트를 개방(EXPOSE)할 필요가 없습니다.
CMD ["python", "query-consumer.py"]