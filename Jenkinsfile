pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
  }

  environment {
    HARBOR_REGISTRY = "10.0.2.111:80"
    HARBOR_PROJECT  = "k8s-mini"
    IMAGE_TAG       = "${env.BUILD_NUMBER}"
    HARBOR_CREDS    = "harbor-credentials"
    NAMESPACE       = "miniproject"
    HELM_RELEASE    = "mobility-app"
    HELM_CHART_PATH = "k8s-manifests/mobility-app"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Set image tag') {
      steps {
        script {
          def shortSha = sh(script: "git rev-parse --short=7 HEAD", returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${shortSha}"
        }
      }
    }

    stage('Docker Build & Push') {
      steps {
        withCredentials([usernamePassword(
          credentialsId: env.HARBOR_CREDS,
          usernameVariable: 'HARBOR_USER',
          passwordVariable: 'HARBOR_PASS'
        )]) {
          sh '''
            set -eu

            echo "${HARBOR_PASS}" | docker login ${HARBOR_REGISTRY} -u "${HARBOR_USER}" --password-stdin

            docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG} ./src-command/ingest
            docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG}

            docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG} ./src-command/consumer
            docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG}

            docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG} ./src-query/api
            docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG}

            docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG} ./src-query/consumer
            docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG}

            docker build -t ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG} ./frontend
            docker push ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG}
          '''
        }
      }
    }

    stage('Deploy to Kubernetes') {
      steps {
        withCredentials([file(credentialsId: 'mobility-secret-values', variable: 'SECRET_VALUES_FILE')]) {
          sh '''
            set -eu

            helm upgrade --install ${HELM_RELEASE} ${HELM_CHART_PATH} \
              -n ${NAMESPACE} --create-namespace \
              --wait --timeout 10m --atomic --cleanup-on-fail \
              -f ${SECRET_VALUES_FILE} \
              --set command.api.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-ingest-api:${IMAGE_TAG} \
              --set command.consumer.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/telemetry-mongo-consumer:${IMAGE_TAG} \
              --set query.api.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-api:${IMAGE_TAG} \
              --set query.consumer.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/mobility-query-consumer:${IMAGE_TAG} \
              --set frontend.image=${HARBOR_REGISTRY}/${HARBOR_PROJECT}/k8s-mini-frontend:${IMAGE_TAG}
          '''
        }
      }
    }
  }

  post {
    success {
      echo "Jenkins Deploy Success: ${env.JOB_NAME} #${env.BUILD_NUMBER} (${env.IMAGE_TAG})"
    }
    failure {
      echo "Jenkins Deploy Failed: ${env.JOB_NAME} #${env.BUILD_NUMBER} (${env.IMAGE_TAG})"
    }
    always {
      sh "docker logout ${HARBOR_REGISTRY} || true"
    }
  }
}
