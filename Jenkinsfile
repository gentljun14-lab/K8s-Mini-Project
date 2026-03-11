pipeline {
    agent any

    environment {
        HARBOR_REGISTRY = "10.0.2.111:80"
        HARBOR_PROJECT  = "k8s-mini"
        IMAGE_TAG       = "v${BUILD_NUMBER}"
        HARBOR_CREDS    = "harbor-credentials"   // Jenkins Credentials ID
        NAMESPACE       = "miniproject"
        HELM_RELEASE    = "mobility-release"
        HELM_CHART_PATH = "k8s-manifests/mobility-app"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Docker Build & Push') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: "${HARBOR_CREDS}",
                    usernameVariable: 'HARBOR_USER',
                    passwordVariable: 'HARBOR_PASS'
                )]) {
                    sh """
                        docker login ${HARBOR_REGISTRY} -u ${HARBOR_USER} -p ${HARBOR_PASS}

                        # ── Command API ──────────────────────────────────
                        docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG} ./src-command
                        docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG}

                        # ── Command Consumer ─────────────────────────────
                        docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG} ./src-command/consumer
                        docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG}

                        # ── Query API ────────────────────────────────────
                        docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG} ./src-query
                        docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG}

                        # ── Query Consumer ───────────────────────────────
                        docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG} ./src-query/consumer
                        docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG}

                        # ── Frontend ─────────────────────────────────────
                        docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG} ./frontend
                        docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG}
                    """
                }
            }
        }

        stage('Deploy to K8s') {
            steps {
                sh """
                    helm upgrade ${HELM_RELEASE} ${HELM_CHART_PATH} \
                        --namespace ${NAMESPACE} \
                        --set command.api.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG} \
                        --set command.consumer.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG} \
                        --set query.api.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG} \
                        --set query.consumer.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG} \
                        --set frontend.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG} \
                        --reuse-values
                """
            }
        }
    }

    post {
        success {
            echo "✅ 배포 성공! 이미지 태그: ${IMAGE_TAG}"
        }
        failure {
            echo "❌ 배포 실패. 로그를 확인하세요."
        }
    }
}
