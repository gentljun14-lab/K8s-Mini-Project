#!/bin/bash
# =============================================
# Secret 변경사항 전체 적용 배포 스크립트
# PVC 삭제 방식으로 MongoDB 재초기화
# =============================================

set -e
NAMESPACE=miniproject
MANIFEST=k8s-manifests

echo "=== [1/6] 기존 MongoDB StatefulSet 및 PVC 삭제 ==="
kubectl delete statefulset mongo -n $NAMESPACE --ignore-not-found
kubectl delete pvc mongo-data-mongo-0 -n $NAMESPACE --ignore-not-found
echo "MongoDB PVC 삭제 완료"

echo ""
echo "=== [2/6] Secret 적용 ==="
kubectl apply -f $MANIFEST/secret.yaml

echo ""
echo "=== [3/6] ConfigMap 적용 ==="
kubectl apply -f $MANIFEST/configmap.yaml

echo ""
echo "=== [4/6] MongoDB 재배포 (PVC 새로 생성 + root 계정 자동 생성) ==="
kubectl apply -f $MANIFEST/mongo.yaml
echo "MongoDB Pod 기동 대기 중 (30초)..."
sleep 30
kubectl wait --for=condition=ready pod/mongo-0 -n $NAMESPACE --timeout=120s
echo "MongoDB 준비 완료"

echo ""
echo "=== [5/6] Redis 재배포 ==="
kubectl apply -f $MANIFEST/redis.yaml

echo ""
echo "=== [6/6] 나머지 서비스 재배포 ==="
kubectl apply -f $MANIFEST/command-deployment.yaml
kubectl apply -f $MANIFEST/query-deployment.yaml
kubectl apply -f $MANIFEST/frontend-deployment.yaml
kubectl apply -f $MANIFEST/ingress.yaml

echo ""
echo "=== 배포 완료 ==="
echo "상태 확인:"
kubectl get pods -n $NAMESPACE
