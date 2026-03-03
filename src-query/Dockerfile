# 1. Python 런타임을 지정합니다.
FROM python:3.12-slim

# 작업 디렉터리를 설정합니다.
WORKDIR /app

# .pyc 생성 방지 및 출력 버퍼링 비활성화
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# requirements.txt를 설치합니다.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 소스 코드를 컨테이너에 복사합니다.
COPY . .

# Query API가 8000 포트를 사용합니다.
EXPOSE 8000

# Query API 진입점 (현재 실행 파일: api/query-api.py)
CMD ["python", "api/query-api.py"]
